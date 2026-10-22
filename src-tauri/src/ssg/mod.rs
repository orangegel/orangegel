pub mod adapters;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SsgId {
    Hugo,
    Nextjs,
    Docusaurus,
    Nuxt,
    Gatsby,
    Astro,
    Jekyll,
    Hexo,
    Vuepress,
    Eleventy,
    Vitepress,
    Mkdocs,
    Zola,
    Pelican,
    Sveltekit,
    Remix,
    Middleman,
    Metalsmith,
    Gridsome,
    Bridgetown,
}

impl SsgId {
    pub fn as_str(&self) -> &'static str {
        match self {
            SsgId::Hugo => "hugo",
            SsgId::Nextjs => "nextjs",
            SsgId::Docusaurus => "docusaurus",
            SsgId::Nuxt => "nuxt",
            SsgId::Gatsby => "gatsby",
            SsgId::Astro => "astro",
            SsgId::Jekyll => "jekyll",
            SsgId::Hexo => "hexo",
            SsgId::Vuepress => "vuepress",
            SsgId::Eleventy => "eleventy",
            SsgId::Vitepress => "vitepress",
            SsgId::Mkdocs => "mkdocs",
            SsgId::Zola => "zola",
            SsgId::Pelican => "pelican",
            SsgId::Sveltekit => "sveltekit",
            SsgId::Remix => "remix",
            SsgId::Middleman => "middleman",
            SsgId::Metalsmith => "metalsmith",
            SsgId::Gridsome => "gridsome",
            SsgId::Bridgetown => "bridgetown",
        }
    }

    pub fn from_id_str(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "hugo" => Some(SsgId::Hugo),
            "nextjs" | "next" | "next.js" => Some(SsgId::Nextjs),
            "docusaurus" => Some(SsgId::Docusaurus),
            "nuxt" | "nuxtjs" => Some(SsgId::Nuxt),
            "gatsby" => Some(SsgId::Gatsby),
            "astro" => Some(SsgId::Astro),
            "jekyll" => Some(SsgId::Jekyll),
            "hexo" => Some(SsgId::Hexo),
            "vuepress" => Some(SsgId::Vuepress),
            "eleventy" | "11ty" => Some(SsgId::Eleventy),
            "vitepress" => Some(SsgId::Vitepress),
            "mkdocs" => Some(SsgId::Mkdocs),
            "zola" => Some(SsgId::Zola),
            "pelican" => Some(SsgId::Pelican),
            "sveltekit" => Some(SsgId::Sveltekit),
            "remix" | "react-router" => Some(SsgId::Remix),
            "middleman" => Some(SsgId::Middleman),
            "metalsmith" => Some(SsgId::Metalsmith),
            "gridsome" => Some(SsgId::Gridsome),
            "bridgetown" => Some(SsgId::Bridgetown),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionMatch {
    pub ssg: SsgId,
    pub confidence: u8,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedToolchain {
    pub binary_path: String,
    pub version_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevOptions {
    pub build_drafts: bool,
    pub disable_fast_render: bool,
}

impl Default for DevOptions {
    fn default() -> Self {
        Self {
            build_drafts: true,
            disable_fast_render: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOptions {
    pub minify: bool,
    pub build_drafts: bool,
}

impl Default for BuildOptions {
    fn default() -> Self {
        Self {
            minify: true,
            build_drafts: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
}

impl CommandSpec {
    pub fn display_command(&self) -> String {
        if self.args.is_empty() {
            self.program.clone()
        } else {
            format!("{} {}", self.program, self.args.join(" "))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScaffoldStrategy {
    Cli(CommandSpec),
    FrontMatter { format: String, default_ext: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SsgCatalogEntry {
    pub id: SsgId,
    pub display_name: String,
    pub ecosystem: String,
    pub preferred: bool,
    pub config_markers: Vec<String>,
    pub content_dirs: Vec<String>,
    pub output_dir: String,
    pub dev_command_preview: String,
    pub build_command_preview: String,
    pub installed: bool,
    pub resolved_binary: Option<String>,
}

pub trait SsgAdapter: Send + Sync {
    fn id(&self) -> SsgId;
    fn display_name(&self) -> &'static str;
    fn ecosystem(&self) -> &'static str;
    fn is_preferred(&self) -> bool {
        false
    }
    fn config_markers(&self) -> Vec<&'static str>;
    fn default_content_dirs(&self) -> Vec<&'static str>;
    fn default_output_dir(&self) -> &'static str;
    fn primary_binary_name(&self) -> &'static str;

    fn detect(&self, root: &Path) -> Option<DetectionMatch>;

    fn resolve_binary(
        &self,
        root: &Path,
        override_bin: Option<&str>,
    ) -> Result<ResolvedToolchain, String> {
        if let Some(custom) = override_bin {
            let trimmed = custom.trim();
            if !trimmed.is_empty() {
                if let Some(found) = find_executable(trimmed, Some(root)) {
                    return Ok(ResolvedToolchain {
                        binary_path: found.to_string_lossy().into_owned(),
                        version_hint: None,
                    });
                }
                return Err(format!(
                    "Configured {} binary override '{}' was not found or is not executable",
                    self.display_name(),
                    trimmed
                ));
            }
        }

        let bin_name = self.primary_binary_name();
        if let Some(found) = find_executable(bin_name, Some(root)) {
            Ok(ResolvedToolchain {
                binary_path: found.to_string_lossy().into_owned(),
                version_hint: None,
            })
        } else {
            Err(format!(
                "{} toolchain ('{}') not found in PATH or standard locations (/opt/homebrew/bin, /usr/local/bin, ~/.cargo/bin). Install '{}' or configure a binary override in Settings.",
                self.display_name(),
                bin_name,
                bin_name
            ))
        }
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec;

    fn build_command(
        &self,
        root: &Path,
        opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec;

    fn new_content(
        &self,
        root: &Path,
        rel_path: &str,
        resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy;

    fn content_dirs(&self, root: &Path) -> Vec<PathBuf> {
        self.default_content_dirs()
            .into_iter()
            .map(|d| root.join(d))
            .collect()
    }

    fn output_dir(&self, root: &Path) -> PathBuf {
        root.join(self.default_output_dir())
    }

    fn preview_url_path(&self, rel_path: &str) -> String {
        default_preview_url_path(rel_path, &self.default_content_dirs())
    }
}

/// Searches standard PATH plus macOS/Linux developer prefixes (`/opt/homebrew/bin`,
/// `/usr/local/bin`, `~/.cargo/bin`, `~/.local/bin`, project `./bin` & `./node_modules/.bin`).
pub fn find_executable(name: &str, project_root: Option<&Path>) -> Option<PathBuf> {
    let candidate = Path::new(name);
    if candidate.is_absolute() || name.contains('/') {
        let full = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else if let Some(root) = project_root {
            root.join(candidate)
        } else {
            candidate.to_path_buf()
        };
        if is_executable_file(&full) {
            return Some(full);
        }
        return None;
    }

    let mut search_dirs: Vec<PathBuf> = Vec::new();
    if let Some(root) = project_root {
        search_dirs.push(root.join("bin"));
        search_dirs.push(root.join("node_modules").join(".bin"));
    }

    if let Some(path_var) = env::var_os("PATH") {
        search_dirs.extend(env::split_paths(&path_var));
    }

    search_dirs.push(PathBuf::from("/opt/homebrew/bin"));
    search_dirs.push(PathBuf::from("/usr/local/bin"));
    search_dirs.push(PathBuf::from("/usr/bin"));
    search_dirs.push(PathBuf::from("/bin"));

    if let Ok(home) = env::var("HOME") {
        let h = PathBuf::from(home);
        search_dirs.push(h.join(".cargo/bin"));
        search_dirs.push(h.join(".local/bin"));
        search_dirs.push(h.join("go/bin"));
        search_dirs.push(h.join(".nvm/current/bin"));
        search_dirs.push(h.join(".volta/bin"));
        search_dirs.push(h.join(".asdf/shims"));
        search_dirs.push(h.join(".rbenv/shims"));
    }

    for dir in search_dirs {
        let full = dir.join(name);
        if is_executable_file(&full) {
            return Some(full);
        }
    }
    None
}

pub fn augmented_path_env(project_root: Option<&Path>) -> String {
    let mut dirs: Vec<String> = Vec::new();
    if let Some(root) = project_root {
        dirs.push(root.join("node_modules/.bin").to_string_lossy().into_owned());
        dirs.push(root.join("bin").to_string_lossy().into_owned());
    }
    dirs.push("/opt/homebrew/bin".to_string());
    dirs.push("/usr/local/bin".to_string());
    if let Ok(home) = env::var("HOME") {
        dirs.push(format!("{home}/.cargo/bin"));
        dirs.push(format!("{home}/.local/bin"));
        dirs.push(format!("{home}/go/bin"));
    }
    if let Ok(existing) = env::var("PATH") {
        dirs.push(existing);
    }
    dirs.join(":")
}

fn is_executable_file(path: &Path) -> bool {
    if let Ok(meta) = fs::metadata(path) {
        if !meta.is_file() {
            return false;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            return (meta.permissions().mode() & 0o111) != 0;
        }
        #[cfg(not(unix))]
        {
            return true;
        }
    }
    false
}

pub fn default_preview_url_path(rel_path: &str, content_prefixes: &[&str]) -> String {
    let mut s = rel_path.trim().replace('\\', "/");
    while s.starts_with('/') {
        s.remove(0);
    }

    // Strip known content prefixes (e.g. "content/", "src/content/", "src/pages/", "docs/")
    for prefix in content_prefixes {
        let clean_prefix = prefix.trim_matches('/');
        if !clean_prefix.is_empty() {
            let with_slash = format!("{clean_prefix}/");
            if s.starts_with(&with_slash) {
                s = s[with_slash.len()..].to_string();
                break;
            }
        }
    }

    // Strip known content extensions
    for ext in [
        ".mdx", ".markdown", ".md", ".html", ".astro", ".svelte", ".vue", ".tsx", ".jsx", ".njk",
        ".liquid", ".rst", ".adoc",
    ] {
        if s.ends_with(ext) {
            s.truncate(s.len() - ext.len());
            break;
        }
    }

    // Strip Jekyll/Hexo date prefix YYYY-MM-DD- from leaf segment if present
    let segments: Vec<&str> = s.split('/').filter(|p| !p.is_empty()).collect();
    let mut cleaned_segments: Vec<String> = Vec::new();
    for (idx, &seg) in segments.iter().enumerate() {
        if idx + 1 == segments.len() && (seg == "index" || seg == "_index") {
            continue;
        }
        // Strip leading _posts or _drafts directory
        if seg == "_posts" || seg == "_drafts" {
            continue;
        }
        // Check YYYY-MM-DD-slug
        if seg.len() > 11
            && seg.as_bytes()[4] == b'-'
            && seg.as_bytes()[7] == b'-'
            && seg.as_bytes()[10] == b'-'
            && seg[0..4].chars().all(|c| c.is_ascii_digit())
            && seg[5..7].chars().all(|c| c.is_ascii_digit())
            && seg[8..10].chars().all(|c| c.is_ascii_digit())
        {
            cleaned_segments.push(seg[11..].to_string());
        } else {
            cleaned_segments.push(seg.to_string());
        }
    }

    if cleaned_segments.is_empty() {
        "/".to_string()
    } else {
        format!("/{}/", cleaned_segments.join("/"))
    }
}

/// Returns all 20 SSG adapters in priority order (Hugo first).
pub fn all_adapters() -> Vec<Box<dyn SsgAdapter>> {
    adapters::build_all_adapters()
}

pub fn get_adapter(id: SsgId) -> Box<dyn SsgAdapter> {
    for adapter in all_adapters() {
        if adapter.id() == id {
            return adapter;
        }
    }
    Box::new(adapters::HugoAdapter)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectSsgConfig {
    pub ssg: Option<SsgId>,
}

/// Detects the active SSG for `root`, checking:
/// 1. Explicit `.orangegel/project.json` override
/// 2. Highest-confidence adapter detection across all 20 adapters (Hugo evaluated first)
/// 3. Fallback to `preferred` (`SsgId::Hugo`)
pub fn detect_project_ssg(root: &Path, preferred: SsgId) -> DetectionMatch {
    let project_cfg = root.join(".orangegel/project.json");
    if let Ok(raw) = fs::read_to_string(&project_cfg) {
        if let Ok(parsed) = serde_json::from_str::<ProjectSsgConfig>(&raw) {
            if let Some(explicit_ssg) = parsed.ssg {
                return DetectionMatch {
                    ssg: explicit_ssg,
                    confidence: 100,
                    reason: "Configured explicitly in .orangegel/project.json".to_string(),
                };
            }
        }
    }

    let mut best: Option<DetectionMatch> = None;
    for adapter in all_adapters() {
        if let Some(m) = adapter.detect(root) {
            if m.confidence == 100 {
                return m;
            }
            match &best {
                None => best = Some(m),
                Some(prev) if m.confidence > prev.confidence => best = Some(m),
                _ => {}
            }
        }
    }

    best.unwrap_or(DetectionMatch {
        ssg: preferred,
        confidence: 50,
        reason: format!("Defaulted to preferred generator ({})", preferred.as_str()),
    })
}

pub fn build_catalog(
    project_root: Option<&Path>,
    binary_overrides: &HashMap<String, String>,
) -> Vec<SsgCatalogEntry> {
    let dummy_root = project_root.unwrap_or_else(|| Path::new("."));
    let dev_opts = DevOptions::default();
    let build_opts = BuildOptions::default();

    all_adapters()
        .into_iter()
        .map(|adapter| {
            let id = adapter.id();
            let override_bin = binary_overrides.get(id.as_str()).map(|s| s.as_str());
            let resolved = adapter.resolve_binary(dummy_root, override_bin).ok();
            let dev_cmd = adapter.dev_command(
                dummy_root,
                1313,
                &dev_opts,
                resolved.as_ref().map(|r| r.binary_path.as_str()),
            );
            let build_cmd = adapter.build_command(
                dummy_root,
                &build_opts,
                resolved.as_ref().map(|r| r.binary_path.as_str()),
            );

            SsgCatalogEntry {
                id,
                display_name: adapter.display_name().to_string(),
                ecosystem: adapter.ecosystem().to_string(),
                preferred: adapter.is_preferred(),
                config_markers: adapter
                    .config_markers()
                    .into_iter()
                    .map(|s| s.to_string())
                    .collect(),
                content_dirs: adapter
                    .default_content_dirs()
                    .into_iter()
                    .map(|s| s.to_string())
                    .collect(),
                output_dir: adapter.default_output_dir().to_string(),
                dev_command_preview: dev_cmd.display_command(),
                build_command_preview: build_cmd.display_command(),
                installed: resolved.is_some(),
                resolved_binary: resolved.map(|r| r.binary_path),
            }
        })
        .collect()
}
