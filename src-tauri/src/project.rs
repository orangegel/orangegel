use crate::pathguard::PathGuard;
use crate::settings::atomic_write_bytes;
use crate::ssg::{get_adapter, SsgId};
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const MAX_EDITOR_FILE_BYTES: u64 = 8 * 1024 * 1024; // 8 MiB cap

const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    ".next",
    ".astro",
    ".svelte-kit",
    "public",
    "_site",
    ".orangegel",
    ".orangegel-legacy",
    ".nuxt",
    ".output",
    ".cache",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub rel_path: String,
    pub name: String,
    pub is_dir: bool,
    pub category: String, // "content" | "code" | "config" | "static"
    pub children: Vec<FileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    pub rel_path: String,
    pub name: String,
    pub lang: String,
    pub is_doc: bool,
    pub format: String, // "yaml" | "toml" | "json" | "none"
    pub fields: serde_json::Map<String, serde_json::Value>,
    pub body: String,
    pub preview_route: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteGraphNode {
    pub id: String,
    pub label: String,
    pub kind: String, // "page" | "draft" | "section" | "taxonomy" | "broken"
    pub rel_path: Option<String>,
    pub route: Option<String>,
    pub link_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteGraphEdge {
    pub source: String,
    pub target: String,
    pub kind: String, // "section" | "link" | "taxonomy"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteGraphData {
    pub nodes: Vec<SiteGraphNode>,
    pub edges: Vec<SiteGraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub root_path: String,
    pub name: String,
    pub active_ssg: SsgId,
    pub active_ssg_name: String,
    pub detection_reason: String,
    pub ssg_binary: Option<String>,
    pub ssg_error: Option<String>,
    pub has_tailwind: bool,
    pub tree: Vec<FileEntry>,
}

pub fn detect_has_tailwind(root: &Path) -> bool {
    for marker in [
        "tailwind.config.js",
        "tailwind.config.ts",
        "tailwind.config.mjs",
        "tailwind.config.cjs",
        "postcss.config.js",
        "postcss.config.mjs",
    ] {
        if root.join(marker).exists() {
            return true;
        }
    }
    if let Ok(pkg) = fs::read_to_string(root.join("package.json")) {
        if pkg.contains("\"tailwindcss\"") || pkg.contains("\"@tailwindcss/") {
            return true;
        }
    }
    false
}

/// Resilient directory scanner that skips unreadable directories rather than aborting.
pub fn scan_project_tree(root: &Path, ssg: SsgId) -> Vec<FileEntry> {
    let adapter = get_adapter(ssg);
    let content_prefixes: Vec<String> = adapter
        .default_content_dirs()
        .into_iter()
        .map(|s| s.trim_matches('/').to_string())
        .collect();
    let config_markers: HashSet<String> = adapter
        .config_markers()
        .into_iter()
        .map(|s| s.to_string())
        .collect();

    scan_dir_recursive(root, root, &content_prefixes, &config_markers)
}

fn scan_dir_recursive(
    root: &Path,
    dir: &Path,
    content_prefixes: &[String],
    config_markers: &HashSet<String>,
) -> Vec<FileEntry> {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut entries: Vec<FileEntry> = Vec::new();
    for item in read_dir.flatten() {
        let path = item.path();
        let Some(file_name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else {
            continue;
        };

        if file_name == ".DS_Store" || file_name.starts_with("._") {
            continue;
        }

        let Ok(file_type) = item.file_type() else {
            continue;
        };

        // Skip symlinks pointing outside root
        let Ok(rel_path) = PathGuard::rel(root, &path) else {
            continue;
        };

        if file_type.is_dir() {
            if IGNORED_DIRS.contains(&file_name.as_str()) {
                continue;
            }
            let children = scan_dir_recursive(root, &path, content_prefixes, config_markers);
            let category = classify_path(&rel_path, &file_name, true, content_prefixes, config_markers);
            entries.push(FileEntry {
                rel_path,
                name: file_name,
                is_dir: true,
                category,
                children,
            });
        } else if file_type.is_file() {
            let category = classify_path(&rel_path, &file_name, false, content_prefixes, config_markers);
            entries.push(FileEntry {
                rel_path,
                name: file_name,
                is_dir: false,
                category,
                children: Vec::new(),
            });
        }
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    entries
}

fn classify_path(
    rel_path: &str,
    file_name: &str,
    _is_dir: bool,
    content_prefixes: &[String],
    config_markers: &HashSet<String>,
) -> String {
    if config_markers.contains(rel_path)
        || config_markers.contains(file_name)
        || file_name == "package.json"
        || file_name == "firebase.json"
        || file_name == "hugo.toml"
        || file_name == "config.toml"
        || file_name == "_config.yml"
        || file_name.starts_with("tailwind.config.")
    {
        return "config".to_string();
    }

    for prefix in content_prefixes {
        if rel_path == prefix || rel_path.starts_with(&format!("{prefix}/")) {
            return "content".to_string();
        }
    }

    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".mdx") || lower.ends_with(".markdown") {
        return "content".to_string();
    }

    if rel_path.starts_with("static/") || rel_path == "static" || rel_path.starts_with("assets/images") {
        return "static".to_string();
    }

    "code".to_string()
}

pub fn infer_language(rel_path: &str) -> String {
    let lower = rel_path.to_ascii_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".mdx") || lower.ends_with(".markdown") {
        "markdown".to_string()
    } else if lower.ends_with(".toml") {
        "toml".to_string()
    } else if lower.ends_with(".yaml") || lower.ends_with(".yml") {
        "yaml".to_string()
    } else if lower.ends_with(".json") {
        "json".to_string()
    } else if lower.ends_with(".html")
        || lower.ends_with(".htm")
        || lower.ends_with(".astro")
        || lower.ends_with(".svelte")
        || lower.ends_with(".vue")
        || lower.ends_with(".njk")
        || lower.ends_with(".liquid")
    {
        "html".to_string()
    } else if lower.ends_with(".css") {
        "css".to_string()
    } else if lower.ends_with(".scss") {
        "scss".to_string()
    } else if lower.ends_with(".ts") || lower.ends_with(".tsx") || lower.ends_with(".mts") {
        "typescript".to_string()
    } else if lower.ends_with(".js") || lower.ends_with(".jsx") || lower.ends_with(".mjs") || lower.ends_with(".cjs") {
        "javascript".to_string()
    } else if lower.ends_with(".go") {
        "go".to_string()
    } else if lower.ends_with(".rb") || lower == "gemfile" {
        "ruby".to_string()
    } else if lower.ends_with(".py") {
        "python".to_string()
    } else if lower.ends_with(".rs") {
        "rust".to_string()
    } else if lower.ends_with(".xml") || lower.ends_with(".svg") {
        "xml".to_string()
    } else {
        "plaintext".to_string()
    }
}

pub fn is_content_document(rel_path: &str) -> bool {
    let lower = rel_path.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".mdx") || lower.ends_with(".markdown")
}

/// Parses YAML (`---`), TOML (`+++`), or JSON (`{...}`) front matter cleanly without altering
/// the markdown body formatting.
pub fn parse_front_matter(
    raw: &str,
) -> (
    String,
    serde_json::Map<String, serde_json::Value>,
    String,
) {
    let normalized = raw.strip_prefix('\u{feff}').unwrap_or(raw);

    // 1. YAML: ---\n...\n---\n
    if let Some(after_open) = strip_fence_open(normalized, "---") {
        if let Some((fm_str, body)) = split_at_closing_fence(after_open, "---") {
            if let Ok(serde_yaml::Value::Mapping(map)) = serde_yaml::from_str::<serde_yaml::Value>(fm_str) {
                if let Ok(serde_json::Value::Object(json_map)) = serde_json::to_value(map) {
                    return ("yaml".to_string(), json_map, body.to_string());
                }
            }
        }
    }

    // 2. TOML: +++\n...\n+++\n
    if let Some(after_open) = strip_fence_open(normalized, "+++") {
        if let Some((fm_str, body)) = split_at_closing_fence(after_open, "+++") {
            if let Ok(table) = toml::from_str::<toml::Table>(fm_str) {
                if let Ok(serde_json::Value::Object(json_map)) = serde_json::to_value(table) {
                    return ("toml".to_string(), json_map, body.to_string());
                }
            }
        }
    }

    // 3. JSON: {\n...\n}\n
    if normalized.starts_with("{\n") || normalized.starts_with("{\r\n") {
        if let Some(close_idx) = normalized.find("\n}\n").or_else(|| normalized.find("\r\n}\r\n")) {
            let end_brace = if normalized[close_idx..].starts_with("\r\n") {
                close_idx + 3
            } else {
                close_idx + 2
            };
            let fm_candidate = &normalized[..end_brace];
            let rest = &normalized[end_brace..];
            let body = rest
                .strip_prefix("\r\n")
                .or_else(|| rest.strip_prefix('\n'))
                .unwrap_or(rest);
            if let Ok(serde_json::Value::Object(json_map)) =
                serde_json::from_str::<serde_json::Value>(fm_candidate)
            {
                return ("json".to_string(), json_map, body.to_string());
            }
        }
    }

    ("none".to_string(), serde_json::Map::new(), raw.to_string())
}

fn strip_fence_open<'a>(input: &'a str, marker: &str) -> Option<&'a str> {
    let rest = input.strip_prefix(marker)?;
    if let Some(r) = rest.strip_prefix("\r\n") {
        Some(r)
    } else {
        rest.strip_prefix('\n')
    }
}

fn split_at_closing_fence<'a>(input: &'a str, marker: &str) -> Option<(&'a str, &'a str)> {
    let mut offset = 0;
    for line in input.split_inclusive('\n') {
        let trimmed_line = line.trim_end_matches(&['\r', '\n'][..]);
        if trimmed_line == marker {
            let fm = &input[..offset];
            let body = &input[offset + line.len()..];
            return Some((fm, body));
        }
        offset += line.len();
    }
    None
}

/// Serializes front matter (`yaml`, `toml`, `json`, or `none`) and combines it with `body`.
pub fn serialize_document(
    format: &str,
    fields: &serde_json::Map<String, serde_json::Value>,
    body: &str,
) -> Result<String, String> {
    match format.trim().to_ascii_lowercase().as_str() {
        "none" | "" => Ok(body.to_string()),
        "yaml" => {
            let yaml_str = serde_yaml::to_string(fields)
                .map_err(|e| format!("Failed to serialize YAML front matter: {e}"))?;
            let clean_yaml = yaml_str
                .strip_prefix("---\n")
                .unwrap_or(&yaml_str)
                .trim_end();
            if clean_yaml == "{}" || clean_yaml.is_empty() {
                Ok(format!("---\n---\n{body}"))
            } else {
                Ok(format!("---\n{clean_yaml}\n---\n{body}"))
            }
        }
        "toml" => {
            // Convert serde_json::Map into BTreeMap for deterministic TOML output
            let mut clean_map: BTreeMap<String, serde_json::Value> = BTreeMap::new();
            for (k, v) in fields {
                if !v.is_null() {
                    clean_map.insert(k.clone(), v.clone());
                }
            }
            let toml_str = toml::to_string_pretty(&clean_map)
                .map_err(|e| format!("Failed to serialize TOML front matter: {e}"))?;
            let clean_toml = toml_str.trim_end();
            if clean_toml.is_empty() {
                Ok(format!("+++\n+++\n{body}"))
            } else {
                Ok(format!("+++\n{clean_toml}\n+++\n{body}"))
            }
        }
        "json" => {
            let json_str = serde_json::to_string_pretty(fields)
                .map_err(|e| format!("Failed to serialize JSON front matter: {e}"))?;
            Ok(format!("{json_str}\n{body}"))
        }
        other => Err(format!("Unsupported front-matter format '{other}'")),
    }
}

pub fn read_document_from_disk(
    root: &Path,
    user_rel: &str,
    ssg: SsgId,
) -> Result<DocumentPayload, String> {
    let abs = PathGuard::abs(root, user_rel)?;
    let rel_path = PathGuard::rel(root, &abs)?;
    let meta = fs::metadata(&abs)
        .map_err(|e| format!("Failed to read metadata for '{rel_path}': {e}"))?;
    if !meta.is_file() {
        return Err(format!("'{rel_path}' is not a regular file"));
    }
    if meta.len() > MAX_EDITOR_FILE_BYTES {
        return Err(format!(
            "File '{rel_path}' ({} bytes) exceeds the 8 MiB editor size limit",
            meta.len()
        ));
    }

    let bytes = fs::read(&abs).map_err(|e| format!("Failed to read '{rel_path}': {e}"))?;
    let raw = String::from_utf8(bytes)
        .map_err(|_| format!("File '{rel_path}' is not valid UTF-8 text"))?;

    let name = abs
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| rel_path.clone());
    let lang = infer_language(&rel_path);
    let is_doc = is_content_document(&rel_path);
    let adapter = get_adapter(ssg);
    let preview_route = adapter.preview_url_path(&rel_path);

    if is_doc {
        let (format, fields, body) = parse_front_matter(&raw);
        Ok(DocumentPayload {
            rel_path,
            name,
            lang,
            is_doc: true,
            format,
            fields,
            body,
            preview_route,
        })
    } else {
        Ok(DocumentPayload {
            rel_path,
            name,
            lang,
            is_doc: false,
            format: "none".to_string(),
            fields: serde_json::Map::new(),
            body: raw,
            preview_route,
        })
    }
}

pub fn save_document_to_disk(
    root: &Path,
    user_rel: &str,
    format: &str,
    fields: &serde_json::Map<String, serde_json::Value>,
    body: &str,
    ssg: SsgId,
) -> Result<DocumentPayload, String> {
    let abs = PathGuard::abs(root, user_rel)?;
    let serialized = if is_content_document(user_rel) && format != "none" {
        serialize_document(format, fields, body)?
    } else {
        body.to_string()
    };

    atomic_write_bytes(&abs, serialized.as_bytes())?;
    read_document_from_disk(root, user_rel, ssg)
}

pub fn default_front_matter_template(title: &str, format: &str) -> String {
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    if format == "toml" {
        format!(
            "+++\ntitle = {:?}\ndate = {:?}\ndraft = true\n+++\n\n# {}\n\nWrite your content here.\n",
            title, now, title
        )
    } else {
        format!(
            "---\ntitle: {:?}\ndate: {:?}\ndraft: true\n---\n\n# {}\n\nWrite your content here.\n",
            title, now, title
        )
    }
}

/// Builds the 3D Site Topology Graph (`SiteGraphData`) by walking the project's content files,
/// extracting sections, draft status, taxonomies (`tags`/`categories`), and internal markdown links.
pub fn build_site_graph(root: &Path, ssg: SsgId) -> SiteGraphData {
    let adapter = get_adapter(ssg);
    let mut nodes: Vec<SiteGraphNode> = Vec::new();
    let mut edges: Vec<SiteGraphEdge> = Vec::new();
    let mut node_ids: HashSet<String> = HashSet::new();
    let mut route_to_id: HashMap<String, String> = HashMap::new();

    // Root hub node
    let root_id = "section:/".to_string();
    node_ids.insert(root_id.clone());
    nodes.push(SiteGraphNode {
        id: root_id.clone(),
        label: "Site Root (/)".to_string(),
        kind: "section".to_string(),
        rel_path: None,
        route: Some("/".to_string()),
        link_count: 0,
    });

    let mut content_files: Vec<PathBuf> = Vec::new();
    collect_markdown_files(root, root, &mut content_files);

    let link_re = Regex::new(r"\[[^\]]+\]\((/[^)#\s]+)\)").unwrap();
    let mut pending_links: Vec<(String, String)> = Vec::new();

    for file_path in content_files {
        let Ok(rel_path) = PathGuard::rel(root, &file_path) else {
            continue;
        };
        let Ok(raw) = fs::read_to_string(&file_path) else {
            continue;
        };
        let (_fmt, fields, body) = parse_front_matter(&raw);
        let route = adapter.preview_url_path(&rel_path);
        let title = fields
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                file_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| rel_path.clone())
            });
        let is_draft = fields
            .get("draft")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let page_id = format!("page:{rel_path}");
        node_ids.insert(page_id.clone());
        route_to_id.insert(route.trim_end_matches('/').to_string(), page_id.clone());
        route_to_id.insert(route.clone(), page_id.clone());

        // Determine section from route
        let trimmed_route = route.trim_matches('/');
        let parent_section_id = if let Some((first_seg, _)) = trimmed_route.split_once('/') {
            let sec_id = format!("section:/{first_seg}/");
            if !node_ids.contains(&sec_id) {
                node_ids.insert(sec_id.clone());
                nodes.push(SiteGraphNode {
                    id: sec_id.clone(),
                    label: format!("/{first_seg}/"),
                    kind: "section".to_string(),
                    rel_path: None,
                    route: Some(format!("/{first_seg}/")),
                    link_count: 1,
                });
                edges.push(SiteGraphEdge {
                    source: root_id.clone(),
                    target: sec_id.clone(),
                    kind: "section".to_string(),
                });
            }
            sec_id
        } else {
            root_id.clone()
        };

        edges.push(SiteGraphEdge {
            source: parent_section_id,
            target: page_id.clone(),
            kind: "section".to_string(),
        });

        // Taxonomies (tags / categories)
        for tax_key in ["tags", "categories"] {
            if let Some(arr) = fields.get(tax_key).and_then(|v| v.as_array()) {
                for tag_val in arr {
                    if let Some(tag_str) = tag_val.as_str() {
                        let tax_id = format!("tax:{tax_key}:{tag_str}");
                        if !node_ids.contains(&tax_id) {
                            node_ids.insert(tax_id.clone());
                            nodes.push(SiteGraphNode {
                                id: tax_id.clone(),
                                label: format!("#{tag_str}"),
                                kind: "taxonomy".to_string(),
                                rel_path: None,
                                route: Some(format!("/{tax_key}/{tag_str}/")),
                                link_count: 1,
                            });
                        }
                        edges.push(SiteGraphEdge {
                            source: page_id.clone(),
                            target: tax_id,
                            kind: "taxonomy".to_string(),
                        });
                    }
                }
            }
        }

        // Internal markdown links [label](/some/route)
        let mut out_links = 0usize;
        for cap in link_re.captures_iter(&body) {
            if let Some(m) = cap.get(1) {
                out_links += 1;
                pending_links.push((page_id.clone(), m.as_str().to_string()));
            }
        }

        nodes.push(SiteGraphNode {
            id: page_id,
            label: title,
            kind: if is_draft {
                "draft".to_string()
            } else {
                "page".to_string()
            },
            rel_path: Some(rel_path),
            route: Some(route),
            link_count: out_links,
        });
    }

    for (source_id, target_href) in pending_links {
        let normalized_href = target_href.trim_end_matches('/');
        if let Some(target_id) = route_to_id
            .get(normalized_href)
            .or_else(|| route_to_id.get(&target_href))
        {
            edges.push(SiteGraphEdge {
                source: source_id,
                target: target_id.clone(),
                kind: "link".to_string(),
            });
        } else {
            let broken_id = format!("broken:{target_href}");
            if !node_ids.contains(&broken_id) {
                node_ids.insert(broken_id.clone());
                nodes.push(SiteGraphNode {
                    id: broken_id.clone(),
                    label: format!("404: {target_href}"),
                    kind: "broken".to_string(),
                    rel_path: None,
                    route: Some(target_href),
                    link_count: 1,
                });
            }
            edges.push(SiteGraphEdge {
                source: source_id,
                target: broken_id,
                kind: "link".to_string(),
            });
        }
    }

    SiteGraphData { nodes, edges }
}

fn collect_markdown_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for item in rd.flatten() {
        let path = item.path();
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else {
            continue;
        };
        if IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }
        let Ok(ft) = item.file_type() else {
            continue;
        };
        if PathGuard::rel(root, &path).is_err() {
            continue;
        }
        if ft.is_dir() {
            collect_markdown_files(root, &path, out);
        } else if ft.is_file() && is_content_document(&name) {
            out.push(path);
        }
    }
}

/// Reads `<root>/.orangegel/dictionary.txt`, with backward-compatible fallback read from
/// `<root>/.orangegel-legacy/dictionary.txt`.
pub fn read_dictionary(root: &Path) -> Vec<String> {
    let primary = root.join(".orangegel/dictionary.txt");
    let legacy = root.join(".orangegel-legacy/dictionary.txt");
    let raw = fs::read_to_string(&primary)
        .or_else(|_| fs::read_to_string(&legacy))
        .unwrap_or_default();

    let mut set: BTreeSet<String> = BTreeSet::new();
    for line in raw.lines() {
        let w = line.trim();
        if !w.is_empty() && !w.starts_with('#') {
            set.insert(w.to_string());
        }
    }
    set.into_iter().collect()
}

/// Appends a word to `<root>/.orangegel/dictionary.txt` using atomic write-then-rename.
pub fn add_dictionary_word(root: &Path, word: &str) -> Result<Vec<String>, String> {
    let cleaned = word.trim();
    if cleaned.is_empty() {
        return Err("Dictionary word cannot be empty".to_string());
    }
    let mut words: BTreeSet<String> = read_dictionary(root).into_iter().collect();
    words.insert(cleaned.to_string());
    let sorted: Vec<String> = words.into_iter().collect();
    let payload = format!("{}\n", sorted.join("\n"));
    let target = root.join(".orangegel/dictionary.txt");
    atomic_write_bytes(&target, payload.as_bytes())?;
    Ok(sorted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_yaml_toml_json_front_matter_roundtrip() {
        let yaml_doc = "---\ntitle: Hello OrangeGel\ndraft: true\n---\n# Heading\n\nBody text.\n";
        let (fmt, fields, body) = parse_front_matter(yaml_doc);
        assert_eq!(fmt, "yaml");
        assert_eq!(fields.get("title").unwrap().as_str().unwrap(), "Hello OrangeGel");
        assert_eq!(body, "# Heading\n\nBody text.\n");

        let reserialized = serialize_document(&fmt, &fields, &body).unwrap();
        let (fmt2, fields2, body2) = parse_front_matter(&reserialized);
        assert_eq!(fmt2, "yaml");
        assert_eq!(fields2.get("title"), fields.get("title"));
        assert_eq!(body2, body);

        let toml_doc = "+++\ntitle = \"Hugo Site\"\ndraft = false\n+++\nParagraph here.\n";
        let (tfmt, tfields, tbody) = parse_front_matter(toml_doc);
        assert_eq!(tfmt, "toml");
        assert_eq!(tfields.get("title").unwrap().as_str().unwrap(), "Hugo Site");
        assert_eq!(tbody, "Paragraph here.\n");
    }

    #[test]
    fn test_dictionary_fallback_and_atomic_save() {
        let tmp = TempDir::new().unwrap();
        let legacy_dir = tmp.path().join(".orangegel-legacy");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::write(legacy_dir.join("dictionary.txt"), "OrangeGelCore\nWails\n").unwrap();

        let initial = read_dictionary(tmp.path());
        assert_eq!(initial, vec!["OrangeGelCore", "Wails"]);

        let updated = add_dictionary_word(tmp.path(), "OrangeGel").unwrap();
        assert_eq!(updated, vec!["OrangeGelCore", "OrangeGel", "Wails"]);
        assert!(tmp.path().join(".orangegel/dictionary.txt").exists());
    }

    #[test]
    fn test_site_graph_and_tree_scanner() {
        let tmp = TempDir::new().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let posts_dir = root.join("content/posts");
        fs::create_dir_all(&posts_dir).unwrap();

        fs::write(
            posts_dir.join("first.md"),
            "---\ntitle: First Post\ntags:\n  - rust\n---\nLink to [Second](/posts/second/) and [Missing](/posts/missing-page/).\n",
        )
        .unwrap();
        fs::write(
            posts_dir.join("second.md"),
            "---\ntitle: Second Post\ndraft: true\n---\nHello world.\n",
        )
        .unwrap();

        let tree = scan_project_tree(&root, SsgId::Hugo);
        assert!(!tree.is_empty());

        let graph = build_site_graph(&root, SsgId::Hugo);
        assert!(graph.nodes.iter().any(|n| n.id == "section:/" && n.kind == "section"));
        assert!(graph.nodes.iter().any(|n| n.kind == "section" && n.label == "/posts/"));
        assert!(graph.nodes.iter().any(|n| n.kind == "taxonomy" && n.label == "#rust"));
        assert!(graph.nodes.iter().any(|n| n.kind == "draft" && n.label == "Second Post"));
        assert!(graph.nodes.iter().any(|n| n.kind == "broken" && n.label.contains("/posts/missing-page/")));
    }
}
