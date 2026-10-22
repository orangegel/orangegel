use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const MAX_AI_INPUT_CHARS: usize = 12_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRevisionResponse {
    pub mode: String,
    pub model: String,
    pub original_text: String,
    pub revised_text: String,
    pub truncated_at_paragraph: bool,
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    temperature: f32,
    messages: Vec<ChatMessage>,
}

#[derive(Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

/// Splits `text` at a paragraph boundary (`\n\n`) at or before `max_chars` characters so local
/// models with modest context windows are never handed half a sentence and never truncate a page.
pub fn split_at_paragraph_cap<'a>(text: &'a str, max_chars: usize) -> (&'a str, &'a str) {
    let char_count = text.chars().count();
    if char_count <= max_chars {
        return (text, "");
    }

    // Find byte index corresponding to `max_chars`
    let cap_byte_idx = text
        .char_indices()
        .nth(max_chars)
        .map(|(idx, _)| idx)
        .unwrap_or(text.len());

    let window = &text[..cap_byte_idx];
    if let Some(para_idx) = window.rfind("\n\n") {
        if para_idx > 0 {
            return (&text[..para_idx], &text[para_idx..]);
        }
    }
    if let Some(line_idx) = window.rfind('\n') {
        if line_idx > 0 {
            return (&text[..line_idx], &text[line_idx..]);
        }
    }
    (&text[..cap_byte_idx], &text[cap_byte_idx..])
}

/// Strips `<think>...</think>` reasoning blocks, conversational preambles ("Sure! Here's..."),
/// and an outer markdown fence if and only if it wraps the entire response (preserving internal code fences).
pub fn clean_response(raw: &str) -> String {
    let mut s = raw.trim().to_string();

    // 1. Strip all `<think>...</think>` blocks
    while let Some(start) = s.find("<think>") {
        if let Some(end_rel) = s[start..].find("</think>") {
            let end = start + end_rel + "</think>".len();
            s = format!("{}{}", &s[..start], &s[end..]).trim().to_string();
        } else {
            break;
        }
    }

    // 2. Strip common single-line conversational preambles before the actual text
    let preamble_prefixes = [
        "sure! here is",
        "sure, here is",
        "sure! here's",
        "sure, here's",
        "here is the revised",
        "here is the proofread",
        "here is the corrected",
        "here's the revised",
        "here's the proofread",
        "here's the corrected",
        "certainly! here",
    ];
    if let Some((first_line, rest)) = s.split_once('\n') {
        let lower = first_line.trim().to_ascii_lowercase();
        if lower.ends_with(':')
            && preamble_prefixes
                .iter()
                .any(|prefix| lower.starts_with(prefix))
        {
            s = rest.trim().to_string();
        }
    }

    // 3. Strip outer markdown code fence ONLY if there are no other closing fences inside
    if s.starts_with("```") && s.ends_with("```") {
        if let Some(first_nl) = s.find('\n') {
            let inner = &s[first_nl + 1..s.len() - 3];
            // If `inner` does not contain another standalone ``` fence line, the fence is purely outer
            let has_internal_fence = inner
                .lines()
                .any(|l| l.trim_start().starts_with("```"));
            if !has_internal_fence {
                s = inner.trim().to_string();
            }
        }
    }

    s
}

fn system_prompt_for_mode(mode: &str) -> String {
    let shared_rules = "ABSOLUTE RULES:\n\
1. Preserve all Markdown formatting, headings, lists, fenced code blocks (```...```), inline code (`...`), Hugo shortcodes ({{< ... >}}, {{% ... %}}), Go template actions ({{ ... }}), MDX/JSX components, HTML tags, URLs, and LaTeX math ($...$) verbatim.\n\
2. Preserve the author's choice of American or British English spelling.\n\
3. Output ONLY the revised Markdown text with no preamble, no explanation, and no outer wrapper fence.";

    match mode.trim().to_ascii_lowercase().as_str() {
        "tighten" => format!(
            "You are a concise technical editor. Tighten the prose by removing needless filler words and redundancies while keeping the author's voice and meaning intact.\n\n{shared_rules}"
        ),
        "clarity" => format!(
            "You are a technical editor focused on clarity. Untangle awkward or ambiguous sentences so they read clearly on the first pass while preserving the author's tone.\n\n{shared_rules}"
        ),
        _ => format!(
            "You are a meticulous proofreader. Fix only objective spelling, grammar, punctuation, and typo errors. Do not rewrite stylistic choices.\n\n{shared_rules}"
        ),
    }
}

pub async fn revise_prose(
    endpoint: &str,
    model: &str,
    mode: &str,
    text: &str,
) -> Result<AiRevisionResponse, String> {
    if text.trim().is_empty() {
        return Err("Document body is empty".to_string());
    }

    let (head, tail) = split_at_paragraph_cap(text, MAX_AI_INPUT_CHARS);
    let truncated_at_paragraph = !tail.is_empty();

    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));
    let req_body = ChatCompletionRequest {
        model: model.to_string(),
        temperature: 0.0,
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt_for_mode(mode),
            },
            ChatMessage {
                role: "user".to_string(),
                content: head.to_string(),
            },
        ],
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .post(&url)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| {
            format!(
                "Could not reach local LLM server at '{url}': {e}. Ensure Ollama, LM Studio, or llama.cpp is running."
            )
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_err = resp.text().await.unwrap_or_default();
        return Err(format!(
            "LLM server returned HTTP {status}: {body_err}"
        ));
    }

    let parsed: ChatCompletionResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid JSON response from LLM server: {e}"))?;

    let raw_content = parsed
        .choices
        .first()
        .map(|c| c.message.content.as_str())
        .ok_or_else(|| "LLM server returned an empty choices array".to_string())?;

    let cleaned_head = clean_response(raw_content);
    let revised_text = if tail.is_empty() {
        cleaned_head
    } else {
        format!("{cleaned_head}{tail}")
    };

    Ok(AiRevisionResponse {
        mode: mode.to_string(),
        model: model.to_string(),
        original_text: text.to_string(),
        revised_text,
        truncated_at_paragraph,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_at_paragraph_cap_preserves_tail_at_paragraph_boundary() {
        let p1 = "A".repeat(5_000);
        let p2 = "B".repeat(5_000);
        let p3 = "C".repeat(5_000);
        let full = format!("{p1}\n\n{p2}\n\n{p3}");

        let (head, tail) = split_at_paragraph_cap(&full, 12_000);
        assert_eq!(head.len(), 10_002); // p1 + "\n\n" + p2
        assert!(tail.starts_with("\n\nC"));
        assert_eq!(format!("{head}{tail}"), full);
    }

    #[test]
    fn test_clean_response_strips_think_preamble_and_outer_fence_only() {
        let noisy = "<think>\nLet me check the grammar.\n</think>\nSure! Here's the corrected text:\n```markdown\n# Hello World\n\nThis is clean prose.\n```";
        assert_eq!(
            clean_response(noisy),
            "# Hello World\n\nThis is clean prose."
        );

        // Internal code fence must NOT be stripped
        let with_internal_code = "# Post\n\n```rust\nfn main() {}\n```\n\nConclusion.";
        assert_eq!(clean_response(with_internal_code), with_internal_code);
    }
}
