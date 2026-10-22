use crate::ssg::augmented_path_env;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    pub path: String,
    pub status: String, // "M" | "A" | "D" | "??" | "R"
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSummary {
    pub is_repo: bool,
    pub branch: String,
    pub remote_name: Option<String>,
    pub remote_url: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<GitFileChange>,
}

async fn run_git(root: &Path, args: &[&str]) -> Result<(i32, String, String), String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("PATH", augmented_path_env(Some(root)))
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to execute git {}: {e}", args.join(" ")))?;

    let code = out.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    Ok((code, stdout, stderr))
}

pub async fn git_status(root: &Path) -> Result<GitStatusSummary, String> {
    let (code, stdout, _stderr) =
        run_git(root, &["status", "--porcelain=v1", "--branch"]).await?;
    if code != 0 {
        return Ok(GitStatusSummary {
            is_repo: false,
            branch: String::new(),
            remote_name: None,
            remote_url: None,
            ahead: 0,
            behind: 0,
            changes: Vec::new(),
        });
    }

    let mut branch = "main".to_string();
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut changes = Vec::new();

    for (idx, line) in stdout.lines().enumerate() {
        if idx == 0 && line.starts_with("## ") {
            let header = &line[3..];
            let branch_part = header.split("...").next().unwrap_or(header).trim();
            if !branch_part.is_empty() {
                branch = branch_part.to_string();
            }
            if let Some(bracket_start) = header.find('[') {
                if let Some(bracket_end) = header[bracket_start..].find(']') {
                    let meta = &header[bracket_start + 1..bracket_start + bracket_end];
                    for part in meta.split(',') {
                        let p = part.trim();
                        if let Some(n) = p.strip_prefix("ahead ") {
                            ahead = n.trim().parse().unwrap_or(0);
                        } else if let Some(n) = p.strip_prefix("behind ") {
                            behind = n.trim().parse().unwrap_or(0);
                        }
                    }
                }
            }
            continue;
        }

        if line.len() < 4 {
            continue;
        }
        let xy = &line[0..2];
        let path = line[3..].trim().to_string();
        let x = xy.chars().next().unwrap_or(' ');
        let y = xy.chars().nth(1).unwrap_or(' ');
        let staged = x != ' ' && x != '?';
        let status = if xy == "??" {
            "??".to_string()
        } else if x != ' ' {
            x.to_string()
        } else {
            y.to_string()
        };
        changes.push(GitFileChange {
            path,
            status,
            staged,
        });
    }

    let (remote_name, remote_url) = resolve_default_remote(root).await;

    Ok(GitStatusSummary {
        is_repo: true,
        branch,
        remote_name,
        remote_url,
        ahead,
        behind,
        changes,
    })
}

async fn resolve_default_remote(root: &Path) -> (Option<String>, Option<String>) {
    let Ok((code, stdout, _)) = run_git(root, &["remote"]).await else {
        return (None, None);
    };
    if code != 0 {
        return (None, None);
    }
    let remotes: Vec<&str> = stdout.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    if remotes.is_empty() {
        return (None, None);
    }
    let chosen = if remotes.contains(&"origin") {
        "origin".to_string()
    } else {
        remotes[0].to_string()
    };
    let url = match run_git(root, &["remote", "get-url", &chosen]).await {
        Ok((0, u, _)) => Some(u.trim().to_string()),
        _ => None,
    };
    (Some(chosen), url)
}

pub async fn git_diff(root: &Path, rel_path: Option<&str>) -> Result<String, String> {
    let args: Vec<&str> = match rel_path {
        Some(p) if !p.trim().is_empty() => vec!["diff", "HEAD", "--", p.trim()],
        _ => vec!["diff", "HEAD"],
    };
    let (code, stdout, stderr) = run_git(root, &args).await?;
    if code != 0 && stdout.is_empty() {
        // Fallback if HEAD does not exist yet (initial commit)
        let fallback_args: Vec<&str> = match rel_path {
            Some(p) if !p.trim().is_empty() => vec!["diff", "--", p.trim()],
            _ => vec!["diff"],
        };
        let (c2, out2, err2) = run_git(root, &fallback_args).await?;
        if c2 != 0 {
            return Err(format!("git diff failed: {err2}{stderr}"));
        }
        return Ok(out2);
    }
    Ok(stdout)
}

pub async fn git_commit(root: &Path, message: &str, paths: &[String]) -> Result<String, String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }

    if paths.is_empty() {
        let (code, _, stderr) = run_git(root, &["add", "-A"]).await?;
        if code != 0 {
            return Err(format!("git add -A failed: {stderr}"));
        }
    } else {
        let mut add_args = vec!["add", "--"];
        for p in paths {
            add_args.push(p.as_str());
        }
        let (code, _, stderr) = run_git(root, &add_args).await?;
        if code != 0 {
            return Err(format!("git add failed: {stderr}"));
        }
    }

    let (code, stdout, stderr) = run_git(root, &["commit", "-m", msg]).await?;
    if code != 0 {
        return Err(format!("git commit failed: {stderr}\n{stdout}"));
    }
    Ok(format!("{stdout}{stderr}").trim().to_string())
}

pub async fn git_push(root: &Path) -> Result<String, String> {
    let (code, stdout, stderr) = run_git(root, &["push"]).await?;
    if code != 0 {
        return Err(format!("git push failed: {stderr}\n{stdout}"));
    }
    let combined = format!("{stdout}\n{stderr}").trim().to_string();
    if combined.is_empty() {
        Ok("Everything up-to-date".to_string())
    } else {
        Ok(combined)
    }
}
