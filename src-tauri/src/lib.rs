pub mod ai;
pub mod deploy;
pub mod events;
pub mod pathguard;
pub mod project;
pub mod settings;
pub mod ssg;
pub mod state;
pub mod supervisor;
pub mod vcs;

use crate::ai::AiRevisionResponse;
use crate::deploy::{DeployConfig, DeployPlan, DeployRunResult};
use crate::events::EVENT_PROJECT_CHANGED;
use crate::pathguard::PathGuard;
use crate::project::{
    add_dictionary_word, build_site_graph, default_front_matter_template, detect_has_tailwind,
    read_dictionary, read_document_from_disk, save_document_to_disk, scan_project_tree,
    DocumentPayload, FileEntry, ProjectSummary, SiteGraphData,
};
use crate::settings::{atomic_write_bytes, AppSettings};
use crate::ssg::{
    augmented_path_env, build_catalog, detect_project_ssg, get_adapter, BuildOptions, DevOptions,
    ProjectSsgConfig, ScaffoldStrategy, SsgCatalogEntry, SsgId,
};
use crate::state::{ActiveProject, AppState};
use crate::supervisor::{
    free_port, run_command_spec, CommandOutputResult, ServerLogLine, ServerStatusPayload,
};
use crate::vcs::GitStatusSummary;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tokio::process::Command;

fn build_project_summary(state: &AppState, proj: &ActiveProject) -> ProjectSummary {
    let adapter = get_adapter(proj.active_ssg);
    let override_bin = state
        .settings
        .read()
        .ok()
        .and_then(|s| s.binary_overrides.get(proj.active_ssg.as_str()).cloned());

    let (ssg_binary, ssg_error) = match adapter.resolve_binary(&proj.root, override_bin.as_deref()) {
        Ok(resolved) => (Some(resolved.binary_path), None),
        Err(err) => (None, Some(err)),
    };

    let name = proj
        .root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| proj.root.to_string_lossy().into_owned());

    let tree = scan_project_tree(&proj.root, proj.active_ssg);
    let has_tailwind = detect_has_tailwind(&proj.root);

    ProjectSummary {
        root_path: proj.root.to_string_lossy().into_owned(),
        name,
        active_ssg: proj.active_ssg,
        active_ssg_name: adapter.display_name().to_string(),
        detection_reason: proj.detection_reason.clone(),
        ssg_binary,
        ssg_error,
        has_tailwind,
        tree,
    }
}

#[tauri::command]
async fn get_ssg_catalog(state: State<'_, AppState>) -> Result<Vec<SsgCatalogEntry>, String> {
    let root_opt = state
        .project
        .read()
        .ok()
        .and_then(|g| g.as_ref().map(|p| p.root.clone()));
    let overrides = state
        .settings
        .read()
        .map(|s| s.binary_overrides.clone())
        .unwrap_or_default();

    Ok(build_catalog(root_opt.as_deref(), &overrides))
}

#[tauri::command]
async fn open_project(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProjectSummary, String> {
    let raw_path = PathBuf::from(path.trim());
    if !raw_path.exists() || !raw_path.is_dir() {
        return Err(format!("Directory '{}' does not exist", path.trim()));
    }
    let canon_root = fs::canonicalize(&raw_path)
        .map_err(|e| format!("Failed to canonicalize project directory: {e}"))?;

    // Stop any running dev server from the previous project
    state.supervisor.stop(Some(&app)).await;

    let preferred = state
        .settings
        .read()
        .map(|s| s.preferred_ssg)
        .unwrap_or(SsgId::Hugo);
    let detected = detect_project_ssg(&canon_root, preferred);

    let active = ActiveProject {
        root: canon_root.clone(),
        active_ssg: detected.ssg,
        detection_reason: detected.reason,
    };

    if let Ok(mut guard) = state.project.write() {
        *guard = Some(active.clone());
    }

    if let Ok(mut s) = state.settings.write() {
        s.record_recent_project(&canon_root.to_string_lossy());
        let _ = s.save_to(&state.settings_path);
    }

    let summary = build_project_summary(&state, &active);
    let _ = app.emit(EVENT_PROJECT_CHANGED, summary.clone());
    Ok(summary)
}

#[tauri::command]
async fn choose_project(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<ProjectSummary>, String> {
    #[cfg(target_os = "macos")]
    {
        let out = Command::new("osascript")
            .args([
                "-e",
                "POSIX path of (choose folder with prompt \"Select Static Site Project Folder:\")",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to launch native folder picker: {e}"))?;

        if !out.status.success() {
            // Cancelled dialog is not an error
            return Ok(None);
        }
        let chosen = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if chosen.is_empty() {
            return Ok(None);
        }
        let summary = open_project(chosen, app, state).await?;
        Ok(Some(summary))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state);
        Ok(None)
    }
}

#[tauri::command]
async fn create_new_site(
    parent_dir: String,
    site_name: String,
    ssg: Option<SsgId>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProjectSummary, String> {
    let clean_name = site_name.trim();
    if clean_name.is_empty() || clean_name.contains('/') || clean_name.contains("..") {
        return Err("Invalid site directory name".to_string());
    }

    let target_ssg = ssg.unwrap_or(SsgId::Hugo);
    let parent = PathBuf::from(parent_dir.trim());
    fs::create_dir_all(&parent)
        .map_err(|e| format!("Failed to create parent directory '{}': {e}", parent.display()))?;
    let site_root = parent.join(clean_name);
    fs::create_dir_all(&site_root)
        .map_err(|e| format!("Failed to create site directory '{}': {e}", site_root.display()))?;

    scaffold_starter_site(&site_root, clean_name, target_ssg, &state).await?;

    // Save explicit .orangegel/project.json so the generator choice is persisted
    let cfg = ProjectSsgConfig {
        ssg: Some(target_ssg),
    };
    if let Ok(json) = serde_json::to_string_pretty(&cfg) {
        let _ = atomic_write_bytes(&site_root.join(".orangegel/project.json"), json.as_bytes());
    }

    open_project(site_root.to_string_lossy().into_owned(), app, state).await
}

async fn scaffold_starter_site(
    site_root: &Path,
    site_name: &str,
    ssg: SsgId,
    state: &AppState,
) -> Result<(), String> {
    if ssg == SsgId::Hugo {
        let adapter = get_adapter(SsgId::Hugo);
        let override_bin = state
            .settings
            .read()
            .ok()
            .and_then(|s| s.binary_overrides.get("hugo").cloned());
        if let Ok(resolved) = adapter.resolve_binary(site_root, override_bin.as_deref()) {
            let _ = Command::new(&resolved.binary_path)
                .args([
                    "new",
                    "site",
                    &site_root.to_string_lossy(),
                    "--format",
                    "toml",
                    "--force",
                ])
                .env("PATH", augmented_path_env(Some(site_root)))
                .output()
                .await;
        }

        if !site_root.join("hugo.toml").exists() {
            let hugo_toml = format!(
                "baseURL = 'http://example.org/'\nlanguageCode = 'en-us'\ntitle = {:?}\n",
                site_name
            );
            atomic_write_bytes(&site_root.join("hugo.toml"), hugo_toml.as_bytes())?;
        }
        fs::create_dir_all(site_root.join("content/posts")).ok();
        fs::create_dir_all(site_root.join("layouts/_default")).ok();
        let index_html = "<!DOCTYPE html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><title>{{ .Title }}</title></head>\n<body><main>{{ .Content }}</main></body>\n</html>\n";
        if !site_root.join("layouts/_default/single.html").exists() {
            let _ = atomic_write_bytes(
                &site_root.join("layouts/_default/single.html"),
                index_html.as_bytes(),
            );
            let _ = atomic_write_bytes(
                &site_root.join("layouts/_default/list.html"),
                index_html.as_bytes(),
            );
        }
        let welcome_md = default_front_matter_template("Welcome to OrangeGel", "toml");
        atomic_write_bytes(
            &site_root.join("content/posts/welcome.md"),
            welcome_md.as_bytes(),
        )?;
        return Ok(());
    }

    let adapter = get_adapter(ssg);
    if let Some(first_marker) = adapter.config_markers().first() {
        let marker_path = site_root.join(first_marker);
        if !marker_path.exists() {
            let stub = if first_marker.ends_with(".json") {
                "{}\n"
            } else if first_marker.ends_with(".toml") {
                "title = \"OrangeGel Site\"\n"
            } else if first_marker.ends_with(".yml") || first_marker.ends_with(".yaml") {
                "title: OrangeGel Site\n"
            } else {
                "// OrangeGel Starter Config\nexport default {};\n"
            };
            let _ = atomic_write_bytes(&marker_path, stub.as_bytes());
        }
    }
    let content_dir = adapter
        .default_content_dirs()
        .first()
        .copied()
        .unwrap_or("content");
    let welcome = default_front_matter_template("Welcome to OrangeGel", "yaml");
    atomic_write_bytes(
        &site_root.join(content_dir).join("welcome.md"),
        welcome.as_bytes(),
    )?;
    Ok(())
}

#[tauri::command]
async fn switch_project_ssg(
    ssg: SsgId,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProjectSummary, String> {
    let mut proj = state.require_project()?;
    state.supervisor.stop(Some(&app)).await;

    proj.active_ssg = ssg;
    proj.detection_reason = format!("Switched to {} in OrangeGel", ssg.as_str());

    let cfg = ProjectSsgConfig { ssg: Some(ssg) };
    let json = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Failed to serialize .orangegel/project.json: {e}"))?;
    atomic_write_bytes(&proj.root.join(".orangegel/project.json"), json.as_bytes())?;

    if let Ok(mut guard) = state.project.write() {
        *guard = Some(proj.clone());
    }

    let summary = build_project_summary(&state, &proj);
    let _ = app.emit(EVENT_PROJECT_CHANGED, summary.clone());
    Ok(summary)
}

#[tauri::command]
async fn refresh_project_tree(state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    let proj = state.require_project()?;
    Ok(scan_project_tree(&proj.root, proj.active_ssg))
}

#[tauri::command]
async fn read_document(
    rel_path: String,
    state: State<'_, AppState>,
) -> Result<DocumentPayload, String> {
    let proj = state.require_project()?;
    read_document_from_disk(&proj.root, &rel_path, proj.active_ssg)
}

#[tauri::command]
async fn save_document(
    rel_path: String,
    format: String,
    fields: serde_json::Map<String, serde_json::Value>,
    body: String,
    state: State<'_, AppState>,
) -> Result<DocumentPayload, String> {
    let proj = state.require_project()?;
    save_document_to_disk(
        &proj.root,
        &rel_path,
        &format,
        &fields,
        &body,
        proj.active_ssg,
    )
}

#[tauri::command]
async fn create_content(
    rel_path: String,
    title: Option<String>,
    state: State<'_, AppState>,
) -> Result<DocumentPayload, String> {
    let proj = state.require_project()?;
    let adapter = get_adapter(proj.active_ssg);

    // Ensure path has a markdown/content extension if none was supplied
    let normalized_rel = if rel_path.contains('.') {
        rel_path.trim().to_string()
    } else {
        format!("{}.md", rel_path.trim())
    };

    let abs = PathGuard::abs(&proj.root, &normalized_rel)?;
    if abs.exists() {
        return Err(format!("File '{normalized_rel}' already exists"));
    }

    let override_bin = state
        .settings
        .read()
        .ok()
        .and_then(|s| s.binary_overrides.get(proj.active_ssg.as_str()).cloned());
    let resolved_bin = adapter
        .resolve_binary(&proj.root, override_bin.as_deref())
        .ok()
        .map(|r| r.binary_path);

    let strategy = adapter.new_content(&proj.root, &normalized_rel, resolved_bin.as_deref());
    let mut created_via_cli = false;

    if let ScaffoldStrategy::Cli(spec) = strategy {
        if resolved_bin.is_some() {
            let res = run_command_spec(&spec).await;
            if res.ok && abs.exists() {
                created_via_cli = true;
            }
        }
    }

    if !created_via_cli {
        let inferred_title = title.unwrap_or_else(|| {
            abs.file_stem()
                .map(|s| s.to_string_lossy().replace(['-', '_'], " "))
                .unwrap_or_else(|| "New Post".to_string())
        });
        let fmt = if proj.active_ssg == SsgId::Hugo || proj.active_ssg == SsgId::Zola {
            "toml"
        } else {
            "yaml"
        };
        let content = default_front_matter_template(&inferred_title, fmt);
        atomic_write_bytes(&abs, content.as_bytes())?;
    }

    read_document_from_disk(&proj.root, &normalized_rel, proj.active_ssg)
}

#[tauri::command]
async fn delete_file(rel_path: String, state: State<'_, AppState>) -> Result<bool, String> {
    let proj = state.require_project()?;
    let abs = PathGuard::abs(&proj.root, &rel_path)?;
    let meta = fs::metadata(&abs).map_err(|e| format!("Failed to stat '{rel_path}': {e}"))?;
    if meta.is_dir() {
        return Err("Refusing to delete a directory via delete_file".to_string());
    }
    fs::remove_file(&abs).map_err(|e| format!("Failed to delete '{rel_path}': {e}"))?;
    Ok(true)
}

#[tauri::command]
async fn get_site_graph(state: State<'_, AppState>) -> Result<SiteGraphData, String> {
    let proj = state.require_project()?;
    Ok(build_site_graph(&proj.root, proj.active_ssg))
}

#[tauri::command]
async fn start_dev_server(
    build_drafts: Option<bool>,
    disable_fast_render: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ServerStatusPayload, String> {
    let proj = state.require_project()?;
    let (adapter, resolved) = state.require_ssg(&proj)?;

    let (default_drafts, default_no_fast) = state
        .settings
        .read()
        .map(|s| (s.build_drafts, s.disable_fast_render))
        .unwrap_or((true, false));

    let opts = DevOptions {
        build_drafts: build_drafts.unwrap_or(default_drafts),
        disable_fast_render: disable_fast_render.unwrap_or(default_no_fast),
    };

    let port = free_port()?;
    let spec = adapter.dev_command(&proj.root, port, &opts, Some(&resolved.binary_path));
    state
        .supervisor
        .start(spec, proj.active_ssg, port, Some(app))
        .await
}

#[tauri::command]
async fn stop_dev_server(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ServerStatusPayload, String> {
    Ok(state.supervisor.stop(Some(&app)).await)
}

#[tauri::command]
async fn get_server_status(state: State<'_, AppState>) -> Result<ServerStatusPayload, String> {
    Ok(state.supervisor.get_status())
}

#[tauri::command]
async fn get_server_logs(state: State<'_, AppState>) -> Result<Vec<ServerLogLine>, String> {
    Ok(state.supervisor.get_logs())
}

#[tauri::command]
async fn run_production_build(
    minify: Option<bool>,
    build_drafts: Option<bool>,
    state: State<'_, AppState>,
) -> Result<CommandOutputResult, String> {
    let proj = state.require_project()?;
    let (adapter, resolved) = state.require_ssg(&proj)?;

    let default_minify = state
        .settings
        .read()
        .map(|s| s.minify_build)
        .unwrap_or(true);
    let opts = BuildOptions {
        minify: minify.unwrap_or(default_minify),
        build_drafts: build_drafts.unwrap_or(false),
    };

    let spec = adapter.build_command(&proj.root, &opts, Some(&resolved.binary_path));
    Ok(run_command_spec(&spec).await)
}

#[tauri::command]
async fn open_in_system_browser(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("Only http:// and https:// URLs can be opened in the system browser".to_string());
    }

    #[cfg(target_os = "macos")]
    let prog = "open";
    #[cfg(target_os = "linux")]
    let prog = "xdg-open";
    #[cfg(target_os = "windows")]
    let prog = "explorer";

    Command::new(prog)
        .arg(trimmed)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to open browser: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn read_project_dictionary(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let proj = state.require_project()?;
    Ok(read_dictionary(&proj.root))
}

#[tauri::command]
async fn add_project_dictionary_word(
    word: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let proj = state.require_project()?;
    add_dictionary_word(&proj.root, &word)
}

#[tauri::command]
async fn ai_revise(
    mode: String,
    text: String,
    endpoint: Option<String>,
    model: Option<String>,
    state: State<'_, AppState>,
) -> Result<AiRevisionResponse, String> {
    let (default_ep, default_model) = state
        .settings
        .read()
        .map(|s| (s.llm_endpoint.clone(), s.llm_model.clone()))
        .unwrap_or_else(|_| {
            (
                "http://localhost:11434/v1".to_string(),
                "qwen2.5:7b".to_string(),
            )
        });

    let ep = endpoint
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(default_ep);
    let mdl = model
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(default_model);

    ai::revise_prose(&ep, &mdl, &mode, &text).await
}

#[tauri::command]
async fn git_status(state: State<'_, AppState>) -> Result<GitStatusSummary, String> {
    let proj = state.require_project()?;
    vcs::git_status(&proj.root).await
}

#[tauri::command]
async fn git_diff(
    rel_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let proj = state.require_project()?;
    vcs::git_diff(&proj.root, rel_path.as_deref()).await
}

#[tauri::command]
async fn git_commit(
    message: String,
    paths: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let proj = state.require_project()?;
    vcs::git_commit(&proj.root, &message, &paths.unwrap_or_default()).await
}

#[tauri::command]
async fn git_push(state: State<'_, AppState>) -> Result<String, String> {
    let proj = state.require_project()?;
    vcs::git_push(&proj.root).await
}

#[tauri::command]
async fn get_deploy_config(state: State<'_, AppState>) -> Result<DeployConfig, String> {
    let proj = state.require_project()?;
    Ok(deploy::load_deploy_config(&proj.root))
}

#[tauri::command]
async fn save_deploy_config(
    config: DeployConfig,
    state: State<'_, AppState>,
) -> Result<DeployConfig, String> {
    let proj = state.require_project()?;
    deploy::save_deploy_config(&proj.root, &config)
}

#[tauri::command]
async fn plan_deploy(
    config: Option<DeployConfig>,
    state: State<'_, AppState>,
) -> Result<DeployPlan, String> {
    let proj = state.require_project()?;
    let cfg = config.unwrap_or_else(|| deploy::load_deploy_config(&proj.root));
    let (minify, overrides) = state
        .settings
        .read()
        .map(|s| (s.minify_build, s.binary_overrides.clone()))
        .unwrap_or((true, std::collections::HashMap::new()));
    let build_opts = BuildOptions {
        minify,
        build_drafts: false,
    };
    deploy::plan_deploy(&proj.root, proj.active_ssg, &cfg, &build_opts, &overrides)
}

#[tauri::command]
async fn run_deploy(
    config: Option<DeployConfig>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DeployRunResult, String> {
    let proj = state.require_project()?;
    let cfg = config.unwrap_or_else(|| deploy::load_deploy_config(&proj.root));
    let (minify, overrides) = state
        .settings
        .read()
        .map(|s| (s.minify_build, s.binary_overrides.clone()))
        .unwrap_or((true, std::collections::HashMap::new()));
    let build_opts = BuildOptions {
        minify,
        build_drafts: false,
    };
    deploy::run_deploy(
        &proj.root,
        proj.active_ssg,
        &cfg,
        &build_opts,
        &overrides,
        Some(app),
    )
    .await
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let guard = state
        .settings
        .read()
        .map_err(|_| "Failed to acquire settings lock".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
async fn save_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    settings.save_to(&state.settings_path)?;
    if let Ok(mut guard) = state.settings.write() {
        *guard = settings.clone();
    }
    Ok(settings)
}

#[tauri::command]
fn get_startup_project(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let guard = state
        .startup_project
        .lock()
        .map_err(|_| "Failed to acquire startup_project lock".to_string())?;
    Ok(guard.clone())
}

pub const CLI_LAUNCHER_SCRIPT: &str = r#"#!/usr/bin/env bash
set -euo pipefail

VERSION="0.1.0"

show_help() {
  cat <<'EOF'
OrangeGel — Native Static Site Studio (Tauri v2 + Angular)

Usage:
  orangegel [directory-or-file]
  orangegel .
  orangegel --help | -h
  orangegel --version | -v

Examples:
  orangegel .                       Open the current directory in OrangeGel
  orangegel ~/Sites/my-hugo-blog    Open a specific static site project
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

if [[ "${1:-}" == "--version" || "${1:-}" == "-v" ]]; then
  echo "orangegel ${VERSION}"
  exit 0
fi

RAW_TARGET="${1:-.}"
if [[ -d "$RAW_TARGET" ]]; then
  TARGET_DIR="$(cd "$RAW_TARGET" 2>/dev/null && pwd || pwd)"
elif [[ -f "$RAW_TARGET" ]]; then
  TARGET_DIR="$(cd "$(dirname "$RAW_TARGET")" 2>/dev/null && pwd || pwd)"
else
  TARGET_DIR="$(cd "$RAW_TARGET" 2>/dev/null && pwd || pwd)"
fi

export ORANGEGEL_OPEN_DIR="$TARGET_DIR"

APP_CANDIDATES=(
  "/Applications/OrangeGel.app/Contents/MacOS/orangegel"
  "$HOME/Applications/OrangeGel.app/Contents/MacOS/orangegel"
  "/Users/jaysmith/Projects/OpenSource/MyExternal/OrangeGel/src-tauri/target/release/bundle/macos/OrangeGel.app/Contents/MacOS/orangegel"
  "/Users/jaysmith/Projects/OpenSource/MyExternal/OrangeGel/src-tauri/target/release/orangegel"
)

for BIN in "${APP_CANDIDATES[@]}"; do
  if [[ -x "$BIN" ]]; then
    nohup "$BIN" "$TARGET_DIR" >/dev/null 2>&1 &
    disown || true
    exit 0
  fi
done

echo "Error: Could not find OrangeGel.app binary. Build or move OrangeGel.app to /Applications." >&2
exit 1
"#;

#[tauri::command]
async fn install_cli_launcher() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME environment variable not set".to_string())?;
    let local_bin_dir = PathBuf::from(&home).join(".local/bin");
    fs::create_dir_all(&local_bin_dir)
        .map_err(|e| format!("Failed to create {}: {e}", local_bin_dir.display()))?;

    let mut installed_paths: Vec<String> = Vec::new();
    let targets = [
        PathBuf::from("/opt/homebrew/bin/orangegel"),
        PathBuf::from("/usr/local/bin/orangegel"),
        local_bin_dir.join("orangegel"),
    ];

    for target in &targets {
        if let Some(parent) = target.parent() {
            if parent.exists() && atomic_write_bytes(target, CLI_LAUNCHER_SCRIPT.as_bytes()).is_ok() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(target, fs::Permissions::from_mode(0o755));
                }
                installed_paths.push(target.to_string_lossy().into_owned());
            }
        }
    }

    if installed_paths.is_empty() {
        return Err("Could not write orangegel launcher to PATH directories".to_string());
    }

    Ok(format!(
        "Installed `orangegel` CLI launcher to {}",
        installed_paths.join(", ")
    ))
}

/// Resolves a CLI directory or file argument (or `ORANGEGEL_OPEN_DIR` fallback) into a canonical project root path.
pub fn resolve_startup_dir_from_args<I, S>(
    args: I,
    cwd: &Path,
    env_fallback: Option<&str>,
) -> Option<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let positional = args
        .into_iter()
        .map(|a| a.as_ref().trim().to_string())
        .find(|arg| !arg.is_empty() && !arg.starts_with('-'));

    let raw_target = positional.or_else(|| {
        env_fallback
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
    })?;

    let candidate = {
        let p = Path::new(&raw_target);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            cwd.join(p)
        }
    };

    if !candidate.exists() {
        return None;
    }

    let canon = fs::canonicalize(&candidate).unwrap_or(candidate);
    if canon.is_dir() {
        Some(canon)
    } else if canon.is_file() {
        canon.parent().map(Path::to_path_buf)
    } else {
        None
    }
}

pub fn run() {
    let raw_args: Vec<String> = std::env::args().skip(1).collect();
    for arg in &raw_args {
        if arg == "--help" || arg == "-h" {
            println!("OrangeGel 0.1.0 — Native Static Site Studio (Tauri v2 + Angular)\n");
            println!("Usage:\n  orangegel [directory-or-file]\n  orangegel .\n");
            println!("Options:\n  -h, --help       Print help information\n  -v, --version    Print version information");
            std::process::exit(0);
        }
        if arg == "--version" || arg == "-v" {
            println!("orangegel {}", env!("CARGO_PKG_VERSION"));
            std::process::exit(0);
        }
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let env_dir = std::env::var("ORANGEGEL_OPEN_DIR").ok();
    let startup_dir = resolve_startup_dir_from_args(&raw_args, &cwd, env_dir.as_deref())
        .map(|p| p.to_string_lossy().into_owned());

    let app_state = AppState::with_startup_project(startup_dir);
    let app = tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_ssg_catalog,
            open_project,
            choose_project,
            create_new_site,
            switch_project_ssg,
            refresh_project_tree,
            read_document,
            save_document,
            create_content,
            delete_file,
            get_site_graph,
            start_dev_server,
            stop_dev_server,
            get_server_status,
            get_server_logs,
            run_production_build,
            open_in_system_browser,
            read_project_dictionary,
            add_project_dictionary_word,
            ai_revise,
            git_status,
            git_diff,
            git_commit,
            git_push,
            get_deploy_config,
            save_deploy_config,
            plan_deploy,
            run_deploy,
            get_settings,
            save_settings,
            get_startup_project,
            install_cli_launcher,
        ])
        .build(tauri::generate_context!())
        .expect("error while building OrangeGel Tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.supervisor.stop_sync();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_startup_dir_from_args() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let site_dir = tmp.path().join("my-hugo-site");
        fs::create_dir_all(&site_dir).expect("create site_dir");
        let file_in_site = site_dir.join("hugo.toml");
        fs::write(&file_in_site, "title = 'Test'\n").expect("write hugo.toml");

        // 1. Relative "." resolves to cwd
        let resolved_dot = resolve_startup_dir_from_args(["."], &site_dir, None).expect("dot");
        assert_eq!(
            resolved_dot,
            fs::canonicalize(&site_dir).unwrap_or_else(|_| site_dir.clone())
        );

        // 2. Skips macOS -psn_* flags and resolves relative subdirectory
        let resolved_sub =
            resolve_startup_dir_from_args(["-psn_0_12345", "my-hugo-site"], tmp.path(), None)
                .expect("subdir");
        assert_eq!(
            resolved_sub,
            fs::canonicalize(&site_dir).unwrap_or_else(|_| site_dir.clone())
        );

        // 3. Passing a file resolves to its parent directory
        let resolved_file = resolve_startup_dir_from_args(
            [file_in_site.to_string_lossy().as_ref()],
            tmp.path(),
            None,
        )
        .expect("parent of file");
        assert_eq!(
            resolved_file,
            fs::canonicalize(&site_dir).unwrap_or_else(|_| site_dir.clone())
        );

        // 4. Environment fallback ORANGEGEL_OPEN_DIR works when no positional arg is present
        let resolved_env = resolve_startup_dir_from_args(
            ["-psn_0_999"],
            tmp.path(),
            Some(site_dir.to_string_lossy().as_ref()),
        )
        .expect("env fallback");
        assert_eq!(
            resolved_env,
            fs::canonicalize(&site_dir).unwrap_or_else(|_| site_dir.clone())
        );
    }
}
