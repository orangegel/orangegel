use crate::ssg::{
    augmented_path_env, BuildOptions, CommandSpec, DetectionMatch, DevOptions, ScaffoldStrategy,
    SsgAdapter, SsgId,
};
use std::fs;
use std::path::Path;

fn make_cmd(root: &Path, program: &str, args: Vec<String>) -> CommandSpec {
    CommandSpec {
        program: program.to_string(),
        args,
        cwd: root.to_path_buf(),
        env: vec![
            ("PATH".to_string(), augmented_path_env(Some(root))),
            ("CI".to_string(), "false".to_string()),
        ],
    }
}

fn has_any_file(root: &Path, names: &[&str]) -> Option<String> {
    for &name in names {
        if root.join(name).exists() {
            return Some(name.to_string());
        }
    }
    None
}

fn package_json_mentions(root: &Path, dep: &str) -> bool {
    let pkg_path = root.join("package.json");
    let Ok(raw) = fs::read_to_string(pkg_path) else {
        return false;
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    for section in ["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(obj) = val.get(section).and_then(|v| v.as_object()) {
            if obj.contains_key(dep) {
                return true;
            }
        }
    }
    false
}

fn file_contains(root: &Path, rel: &str, needle: &str) -> bool {
    fs::read_to_string(root.join(rel))
        .map(|s| s.contains(needle))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// 1. Hugo (Preferred Flagship)
// ---------------------------------------------------------------------------
pub struct HugoAdapter;

impl SsgAdapter for HugoAdapter {
    fn id(&self) -> SsgId {
        SsgId::Hugo
    }
    fn display_name(&self) -> &'static str {
        "Hugo"
    }
    fn ecosystem(&self) -> &'static str {
        "Go"
    }
    fn is_preferred(&self) -> bool {
        true
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec![
            "hugo.toml",
            "hugo.yaml",
            "hugo.yml",
            "hugo.json",
            "config/_default/hugo.toml",
            "config/_default/config.toml",
            "config.toml",
            "config.yaml",
            "config.json",
        ]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["content"]
    }
    fn default_output_dir(&self) -> &'static str {
        "public"
    }
    fn primary_binary_name(&self) -> &'static str {
        "hugo"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(marker) = has_any_file(
            root,
            &[
                "hugo.toml",
                "hugo.yaml",
                "hugo.yml",
                "hugo.json",
                "config/_default/hugo.toml",
                "config/_default/hugo.yaml",
                "config/_default/config.toml",
            ],
        ) {
            return Some(DetectionMatch {
                ssg: SsgId::Hugo,
                confidence: 100,
                reason: format!("Found {marker}"),
            });
        }
        // Check legacy config.{toml,yaml,json} when paired with Hugo directory conventions
        // (and not Zola which has templates/ + [markdown] in config.toml without archetypes/)
        if let Some(cfg) = has_any_file(root, &["config.toml", "config.yaml", "config.yml", "config.json"]) {
            let has_hugo_dirs = root.join("archetypes").is_dir()
                || root.join("layouts").is_dir()
                || root.join("themes").is_dir()
                || (root.join("content").is_dir() && !file_contains(root, "config.toml", "compile_sass"));
            if has_hugo_dirs {
                return Some(DetectionMatch {
                    ssg: SsgId::Hugo,
                    confidence: 95,
                    reason: format!("Found {cfg} with Hugo directory structure"),
                });
            }
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("hugo");
        let mut args = vec![
            "server".to_string(),
            "--port".to_string(),
            port.to_string(),
            "--bind".to_string(),
            "127.0.0.1".to_string(),
        ];
        if opts.build_drafts {
            args.push("--buildDrafts".to_string());
        }
        if opts.disable_fast_render {
            args.push("--disableFastRender".to_string());
        }
        make_cmd(root, bin, args)
    }

    fn build_command(
        &self,
        root: &Path,
        opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("hugo");
        let mut args = vec!["--gc".to_string()];
        if opts.minify {
            args.push("--minify".to_string());
        }
        if opts.build_drafts {
            args.push("--buildDrafts".to_string());
        }
        make_cmd(root, bin, args)
    }

    fn new_content(
        &self,
        root: &Path,
        rel_path: &str,
        resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        let bin = resolved_bin.unwrap_or("hugo");
        let clean = rel_path
            .trim_start_matches('/')
            .trim_start_matches("content/");
        ScaffoldStrategy::Cli(make_cmd(
            root,
            bin,
            vec!["new".to_string(), "content".to_string(), clean.to_string()],
        ))
    }
}

// ---------------------------------------------------------------------------
// 2. Next.js
// ---------------------------------------------------------------------------
pub struct NextjsAdapter;

impl SsgAdapter for NextjsAdapter {
    fn id(&self) -> SsgId {
        SsgId::Nextjs
    }
    fn display_name(&self) -> &'static str {
        "Next.js"
    }
    fn ecosystem(&self) -> &'static str {
        "React / TypeScript"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["next.config.js", "next.config.mjs", "next.config.ts"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["content", "src/app", "app", "pages", "src/pages"]
    }
    fn default_output_dir(&self) -> &'static str {
        "out"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Nextjs,
                confidence: 95,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "next") {
            return Some(DetectionMatch {
                ssg: SsgId::Nextjs,
                confidence: 85,
                reason: "Found 'next' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "next".to_string(),
                "dev".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--hostname".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(root, bin, vec!["next".to_string(), "build".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "mdx".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 3. Docusaurus
// ---------------------------------------------------------------------------
pub struct DocusaurusAdapter;

impl SsgAdapter for DocusaurusAdapter {
    fn id(&self) -> SsgId {
        SsgId::Docusaurus
    }
    fn display_name(&self) -> &'static str {
        "Docusaurus"
    }
    fn ecosystem(&self) -> &'static str {
        "React / MDX"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec![
            "docusaurus.config.js",
            "docusaurus.config.ts",
            "docusaurus.config.mjs",
        ]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["docs", "blog", "src/pages"]
    }
    fn default_output_dir(&self) -> &'static str {
        "build"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Docusaurus,
                confidence: 96,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "@docusaurus/core") {
            return Some(DetectionMatch {
                ssg: SsgId::Docusaurus,
                confidence: 88,
                reason: "Found '@docusaurus/core' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "docusaurus".to_string(),
                "start".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
                "--no-open".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec!["docusaurus".to_string(), "build".to_string()],
        )
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 4. Nuxt
// ---------------------------------------------------------------------------
pub struct NuxtAdapter;

impl SsgAdapter for NuxtAdapter {
    fn id(&self) -> SsgId {
        SsgId::Nuxt
    }
    fn display_name(&self) -> &'static str {
        "Nuxt"
    }
    fn ecosystem(&self) -> &'static str {
        "Vue / TypeScript"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["content", "pages"]
    }
    fn default_output_dir(&self) -> &'static str {
        ".output/public"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Nuxt,
                confidence: 95,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "nuxt") {
            return Some(DetectionMatch {
                ssg: SsgId::Nuxt,
                confidence: 86,
                reason: "Found 'nuxt' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "nuxi".to_string(),
                "dev".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(root, bin, vec!["nuxi".to_string(), "generate".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 5. Gatsby
// ---------------------------------------------------------------------------
pub struct GatsbyAdapter;

impl SsgAdapter for GatsbyAdapter {
    fn id(&self) -> SsgId {
        SsgId::Gatsby
    }
    fn display_name(&self) -> &'static str {
        "Gatsby"
    }
    fn ecosystem(&self) -> &'static str {
        "React / GraphQL"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["gatsby-config.js", "gatsby-config.ts", "gatsby-config.mjs"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["content", "src/pages"]
    }
    fn default_output_dir(&self) -> &'static str {
        "public"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Gatsby,
                confidence: 96,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "gatsby") {
            return Some(DetectionMatch {
                ssg: SsgId::Gatsby,
                confidence: 86,
                reason: "Found 'gatsby' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "gatsby".to_string(),
                "develop".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(root, bin, vec!["gatsby".to_string(), "build".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 6. Astro
// ---------------------------------------------------------------------------
pub struct AstroAdapter;

impl SsgAdapter for AstroAdapter {
    fn id(&self) -> SsgId {
        SsgId::Astro
    }
    fn display_name(&self) -> &'static str {
        "Astro"
    }
    fn ecosystem(&self) -> &'static str {
        "JavaScript / TypeScript"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["astro.config.mjs", "astro.config.ts", "astro.config.js"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["src/content", "src/pages"]
    }
    fn default_output_dir(&self) -> &'static str {
        "dist"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Astro,
                confidence: 96,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "astro") {
            return Some(DetectionMatch {
                ssg: SsgId::Astro,
                confidence: 88,
                reason: "Found 'astro' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "astro".to_string(),
                "dev".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(root, bin, vec!["astro".to_string(), "build".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 7. Jekyll
// ---------------------------------------------------------------------------
pub struct JekyllAdapter;

impl SsgAdapter for JekyllAdapter {
    fn id(&self) -> SsgId {
        SsgId::Jekyll
    }
    fn display_name(&self) -> &'static str {
        "Jekyll"
    }
    fn ecosystem(&self) -> &'static str {
        "Ruby"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["_config.yml", "_config.yaml", "Gemfile"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["_posts", "_drafts"]
    }
    fn default_output_dir(&self) -> &'static str {
        "_site"
    }
    fn primary_binary_name(&self) -> &'static str {
        "bundle"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        let has_config = root.join("_config.yml").exists() || root.join("_config.yaml").exists();
        if has_config && !package_json_mentions(root, "hexo") {
            if file_contains(root, "Gemfile", "jekyll") || root.join("_posts").is_dir() {
                return Some(DetectionMatch {
                    ssg: SsgId::Jekyll,
                    confidence: 94,
                    reason: "Found _config.yml with Jekyll structure".to_string(),
                });
            }
            return Some(DetectionMatch {
                ssg: SsgId::Jekyll,
                confidence: 82,
                reason: "Found _config.yml".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("bundle");
        let mut args = vec![
            "exec".to_string(),
            "jekyll".to_string(),
            "serve".to_string(),
            "--port".to_string(),
            port.to_string(),
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--livereload".to_string(),
        ];
        if opts.build_drafts {
            args.push("--drafts".to_string());
        }
        make_cmd(root, bin, args)
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("bundle");
        make_cmd(
            root,
            bin,
            vec!["exec".to_string(), "jekyll".to_string(), "build".to_string()],
        )
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 8. Hexo
// ---------------------------------------------------------------------------
pub struct HexoAdapter;

impl SsgAdapter for HexoAdapter {
    fn id(&self) -> SsgId {
        SsgId::Hexo
    }
    fn display_name(&self) -> &'static str {
        "Hexo"
    }
    fn ecosystem(&self) -> &'static str {
        "Node.js"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["_config.yml", "package.json"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["source/_posts", "source"]
    }
    fn default_output_dir(&self) -> &'static str {
        "public"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if package_json_mentions(root, "hexo") {
            return Some(DetectionMatch {
                ssg: SsgId::Hexo,
                confidence: 95,
                reason: "Found 'hexo' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "hexo".to_string(),
                "server".to_string(),
                "-p".to_string(),
                port.to_string(),
                "-i".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(root, bin, vec!["hexo".to_string(), "generate".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 9. VuePress
// ---------------------------------------------------------------------------
pub struct VuepressAdapter;

impl SsgAdapter for VuepressAdapter {
    fn id(&self) -> SsgId {
        SsgId::Vuepress
    }
    fn display_name(&self) -> &'static str {
        "VuePress"
    }
    fn ecosystem(&self) -> &'static str {
        "Vue"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec![
            "docs/.vuepress/config.js",
            "docs/.vuepress/config.ts",
            ".vuepress/config.js",
            ".vuepress/config.ts",
        ]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["docs"]
    }
    fn default_output_dir(&self) -> &'static str {
        "docs/.vuepress/dist"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Vuepress,
                confidence: 95,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "vuepress") {
            return Some(DetectionMatch {
                ssg: SsgId::Vuepress,
                confidence: 86,
                reason: "Found 'vuepress' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "vuepress".to_string(),
                "dev".to_string(),
                "docs".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec!["vuepress".to_string(), "build".to_string(), "docs".to_string()],
        )
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 10. Eleventy (11ty)
// ---------------------------------------------------------------------------
pub struct EleventyAdapter;

impl SsgAdapter for EleventyAdapter {
    fn id(&self) -> SsgId {
        SsgId::Eleventy
    }
    fn display_name(&self) -> &'static str {
        "Eleventy (11ty)"
    }
    fn ecosystem(&self) -> &'static str {
        "Node.js"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec![
            "eleventy.config.js",
            "eleventy.config.mjs",
            "eleventy.config.cjs",
            ".eleventy.js",
        ]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["content", "src", "posts"]
    }
    fn default_output_dir(&self) -> &'static str {
        "_site"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Eleventy,
                confidence: 96,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "@11ty/eleventy") {
            return Some(DetectionMatch {
                ssg: SsgId::Eleventy,
                confidence: 88,
                reason: "Found '@11ty/eleventy' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "@11ty/eleventy".to_string(),
                "--serve".to_string(),
                format!("--port={port}"),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(root, bin, vec!["@11ty/eleventy".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 11. VitePress
// ---------------------------------------------------------------------------
pub struct VitepressAdapter;

impl SsgAdapter for VitepressAdapter {
    fn id(&self) -> SsgId {
        SsgId::Vitepress
    }
    fn display_name(&self) -> &'static str {
        "VitePress"
    }
    fn ecosystem(&self) -> &'static str {
        "Vue / Vite"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec![
            ".vitepress/config.mts",
            ".vitepress/config.ts",
            ".vitepress/config.js",
            "docs/.vitepress/config.mts",
            "docs/.vitepress/config.ts",
            "docs/.vitepress/config.js",
        ]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["docs"]
    }
    fn default_output_dir(&self) -> &'static str {
        "docs/.vitepress/dist"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Vitepress,
                confidence: 96,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "vitepress") {
            return Some(DetectionMatch {
                ssg: SsgId::Vitepress,
                confidence: 88,
                reason: "Found 'vitepress' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "vitepress".to_string(),
                "dev".to_string(),
                "docs".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec!["vitepress".to_string(), "build".to_string(), "docs".to_string()],
        )
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 12. MkDocs
// ---------------------------------------------------------------------------
pub struct MkdocsAdapter;

impl SsgAdapter for MkdocsAdapter {
    fn id(&self) -> SsgId {
        SsgId::Mkdocs
    }
    fn display_name(&self) -> &'static str {
        "MkDocs"
    }
    fn ecosystem(&self) -> &'static str {
        "Python"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["mkdocs.yml", "mkdocs.yaml"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["docs"]
    }
    fn default_output_dir(&self) -> &'static str {
        "site"
    }
    fn primary_binary_name(&self) -> &'static str {
        "mkdocs"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        has_any_file(root, &self.config_markers()).map(|m| DetectionMatch {
            ssg: SsgId::Mkdocs,
            confidence: 96,
            reason: format!("Found {m}"),
        })
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("mkdocs");
        make_cmd(
            root,
            bin,
            vec![
                "serve".to_string(),
                "--dev-addr".to_string(),
                format!("127.0.0.1:{port}"),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("mkdocs");
        make_cmd(root, bin, vec!["build".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 13. Zola
// ---------------------------------------------------------------------------
pub struct ZolaAdapter;

impl SsgAdapter for ZolaAdapter {
    fn id(&self) -> SsgId {
        SsgId::Zola
    }
    fn display_name(&self) -> &'static str {
        "Zola"
    }
    fn ecosystem(&self) -> &'static str {
        "Rust"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["config.toml"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["content"]
    }
    fn default_output_dir(&self) -> &'static str {
        "public"
    }
    fn primary_binary_name(&self) -> &'static str {
        "zola"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if root.join("config.toml").exists()
            && !root.join("hugo.toml").exists()
            && !root.join("archetypes").is_dir()
            && (root.join("templates").is_dir() || file_contains(root, "config.toml", "compile_sass"))
        {
            return Some(DetectionMatch {
                ssg: SsgId::Zola,
                confidence: 96,
                reason: "Found Zola config.toml with templates/ or compile_sass".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("zola");
        let mut args = vec![
            "serve".to_string(),
            "--port".to_string(),
            port.to_string(),
            "--interface".to_string(),
            "127.0.0.1".to_string(),
        ];
        if opts.build_drafts {
            args.push("--drafts".to_string());
        }
        make_cmd(root, bin, args)
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("zola");
        make_cmd(root, bin, vec!["build".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "toml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 14. Pelican
// ---------------------------------------------------------------------------
pub struct PelicanAdapter;

impl SsgAdapter for PelicanAdapter {
    fn id(&self) -> SsgId {
        SsgId::Pelican
    }
    fn display_name(&self) -> &'static str {
        "Pelican"
    }
    fn ecosystem(&self) -> &'static str {
        "Python"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["pelicanconf.py", "publishconf.py"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["content"]
    }
    fn default_output_dir(&self) -> &'static str {
        "output"
    }
    fn primary_binary_name(&self) -> &'static str {
        "pelican"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        has_any_file(root, &self.config_markers()).map(|m| DetectionMatch {
            ssg: SsgId::Pelican,
            confidence: 96,
            reason: format!("Found {m}"),
        })
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("pelican");
        make_cmd(
            root,
            bin,
            vec![
                "--listen".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--bind".to_string(),
                "127.0.0.1".to_string(),
                "--autoreload".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("pelican");
        make_cmd(root, bin, vec!["content".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 15. SvelteKit
// ---------------------------------------------------------------------------
pub struct SveltekitAdapter;

impl SsgAdapter for SveltekitAdapter {
    fn id(&self) -> SsgId {
        SsgId::Sveltekit
    }
    fn display_name(&self) -> &'static str {
        "SvelteKit"
    }
    fn ecosystem(&self) -> &'static str {
        "Svelte / TypeScript"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["svelte.config.js", "svelte.config.ts"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["src/routes", "src/content", "content"]
    }
    fn default_output_dir(&self) -> &'static str {
        "build"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Sveltekit,
                confidence: 95,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "@sveltejs/kit") {
            return Some(DetectionMatch {
                ssg: SsgId::Sveltekit,
                confidence: 88,
                reason: "Found '@sveltejs/kit' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "vite".to_string(),
                "dev".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(root, bin, vec!["vite".to_string(), "build".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 16. Remix / React Router
// ---------------------------------------------------------------------------
pub struct RemixAdapter;

impl SsgAdapter for RemixAdapter {
    fn id(&self) -> SsgId {
        SsgId::Remix
    }
    fn display_name(&self) -> &'static str {
        "Remix / React Router"
    }
    fn ecosystem(&self) -> &'static str {
        "React / TypeScript"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["react-router.config.ts", "react-router.config.js", "remix.config.js"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["app/routes", "content"]
    }
    fn default_output_dir(&self) -> &'static str {
        "build/client"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Remix,
                confidence: 95,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "@remix-run/dev")
            || package_json_mentions(root, "@react-router/dev")
        {
            return Some(DetectionMatch {
                ssg: SsgId::Remix,
                confidence: 87,
                reason: "Found Remix / React Router in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "vite".to_string(),
                "dev".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(root, bin, vec!["vite".to_string(), "build".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "mdx".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 17. Middleman
// ---------------------------------------------------------------------------
pub struct MiddlemanAdapter;

impl SsgAdapter for MiddlemanAdapter {
    fn id(&self) -> SsgId {
        SsgId::Middleman
    }
    fn display_name(&self) -> &'static str {
        "Middleman"
    }
    fn ecosystem(&self) -> &'static str {
        "Ruby"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["config.rb"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["source"]
    }
    fn default_output_dir(&self) -> &'static str {
        "build"
    }
    fn primary_binary_name(&self) -> &'static str {
        "bundle"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if root.join("config.rb").exists() && file_contains(root, "Gemfile", "middleman") {
            return Some(DetectionMatch {
                ssg: SsgId::Middleman,
                confidence: 95,
                reason: "Found config.rb and 'middleman' in Gemfile".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("bundle");
        make_cmd(
            root,
            bin,
            vec![
                "exec".to_string(),
                "middleman".to_string(),
                "server".to_string(),
                "-p".to_string(),
                port.to_string(),
                "-b".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("bundle");
        make_cmd(
            root,
            bin,
            vec!["exec".to_string(), "middleman".to_string(), "build".to_string()],
        )
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "html.markdown".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 18. Metalsmith
// ---------------------------------------------------------------------------
pub struct MetalsmithAdapter;

impl SsgAdapter for MetalsmithAdapter {
    fn id(&self) -> SsgId {
        SsgId::Metalsmith
    }
    fn display_name(&self) -> &'static str {
        "Metalsmith"
    }
    fn ecosystem(&self) -> &'static str {
        "Node.js"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["metalsmith.js", "metalsmith.json"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["src"]
    }
    fn default_output_dir(&self) -> &'static str {
        "build"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Metalsmith,
                confidence: 95,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "metalsmith") {
            return Some(DetectionMatch {
                ssg: SsgId::Metalsmith,
                confidence: 86,
                reason: "Found 'metalsmith' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "browser-sync".to_string(),
                "start".to_string(),
                "--server".to_string(),
                "build".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
                "--no-open".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        _resolved_bin: Option<&str>,
    ) -> CommandSpec {
        make_cmd(
            root,
            "npm",
            vec!["run".to_string(), "build".to_string()],
        )
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 19. Gridsome
// ---------------------------------------------------------------------------
pub struct GridsomeAdapter;

impl SsgAdapter for GridsomeAdapter {
    fn id(&self) -> SsgId {
        SsgId::Gridsome
    }
    fn display_name(&self) -> &'static str {
        "Gridsome"
    }
    fn ecosystem(&self) -> &'static str {
        "Vue / GraphQL"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["gridsome.config.js"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["content", "src/pages"]
    }
    fn default_output_dir(&self) -> &'static str {
        "dist"
    }
    fn primary_binary_name(&self) -> &'static str {
        "npx"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Gridsome,
                confidence: 96,
                reason: format!("Found {m}"),
            });
        }
        if package_json_mentions(root, "gridsome") {
            return Some(DetectionMatch {
                ssg: SsgId::Gridsome,
                confidence: 87,
                reason: "Found 'gridsome' in package.json".to_string(),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(
            root,
            bin,
            vec![
                "gridsome".to_string(),
                "develop".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("npx");
        make_cmd(root, bin, vec!["gridsome".to_string(), "build".to_string()])
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 20. Bridgetown
// ---------------------------------------------------------------------------
pub struct BridgetownAdapter;

impl SsgAdapter for BridgetownAdapter {
    fn id(&self) -> SsgId {
        SsgId::Bridgetown
    }
    fn display_name(&self) -> &'static str {
        "Bridgetown"
    }
    fn ecosystem(&self) -> &'static str {
        "Ruby"
    }
    fn config_markers(&self) -> Vec<&'static str> {
        vec!["bridgetown.config.yml", "config/initializers.rb"]
    }
    fn default_content_dirs(&self) -> Vec<&'static str> {
        vec!["src/_posts", "src"]
    }
    fn default_output_dir(&self) -> &'static str {
        "output"
    }
    fn primary_binary_name(&self) -> &'static str {
        "bundle"
    }

    fn detect(&self, root: &Path) -> Option<DetectionMatch> {
        if let Some(m) = has_any_file(root, &self.config_markers()) {
            return Some(DetectionMatch {
                ssg: SsgId::Bridgetown,
                confidence: 96,
                reason: format!("Found {m}"),
            });
        }
        None
    }

    fn dev_command(
        &self,
        root: &Path,
        port: u16,
        _opts: &DevOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("bundle");
        make_cmd(
            root,
            bin,
            vec![
                "exec".to_string(),
                "bridgetown".to_string(),
                "start".to_string(),
                "-p".to_string(),
                port.to_string(),
                "-b".to_string(),
                "127.0.0.1".to_string(),
            ],
        )
    }

    fn build_command(
        &self,
        root: &Path,
        _opts: &BuildOptions,
        resolved_bin: Option<&str>,
    ) -> CommandSpec {
        let bin = resolved_bin.unwrap_or("bundle");
        make_cmd(
            root,
            bin,
            vec![
                "exec".to_string(),
                "bridgetown".to_string(),
                "build".to_string(),
            ],
        )
    }

    fn new_content(
        &self,
        _root: &Path,
        _rel_path: &str,
        _resolved_bin: Option<&str>,
    ) -> ScaffoldStrategy {
        ScaffoldStrategy::FrontMatter {
            format: "yaml".to_string(),
            default_ext: "md".to_string(),
        }
    }
}

pub fn build_all_adapters() -> Vec<Box<dyn SsgAdapter>> {
    vec![
        Box::new(HugoAdapter),
        Box::new(NextjsAdapter),
        Box::new(DocusaurusAdapter),
        Box::new(NuxtAdapter),
        Box::new(GatsbyAdapter),
        Box::new(AstroAdapter),
        Box::new(JekyllAdapter),
        Box::new(HexoAdapter),
        Box::new(VuepressAdapter),
        Box::new(EleventyAdapter),
        Box::new(VitepressAdapter),
        Box::new(MkdocsAdapter),
        Box::new(ZolaAdapter),
        Box::new(PelicanAdapter),
        Box::new(SveltekitAdapter),
        Box::new(RemixAdapter),
        Box::new(MiddlemanAdapter),
        Box::new(MetalsmithAdapter),
        Box::new(GridsomeAdapter),
        Box::new(BridgetownAdapter),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssg::{all_adapters, detect_project_ssg, get_adapter};
    use tempfile::TempDir;

    #[test]
    fn test_all_20_adapters_registered_with_hugo_first_and_preferred() {
        let adapters = all_adapters();
        assert_eq!(adapters.len(), 20);
        assert_eq!(adapters[0].id(), SsgId::Hugo);
        assert!(adapters[0].is_preferred());
        for a in &adapters[1..] {
            assert!(!a.is_preferred());
        }
    }

    #[test]
    fn test_hugo_prioritized_when_hugo_toml_exists() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("hugo.toml"), "baseURL = 'https://example.org/'").unwrap();
        fs::write(
            tmp.path().join("package.json"),
            r#"{"dependencies": {"next": "15.0.0"}}"#,
        )
        .unwrap();

        let detected = detect_project_ssg(tmp.path(), SsgId::Hugo);
        assert_eq!(detected.ssg, SsgId::Hugo);
        assert_eq!(detected.confidence, 100);

        let hugo = get_adapter(SsgId::Hugo);
        let dev = hugo.dev_command(tmp.path(), 4455, &DevOptions::default(), Some("hugo"));
        assert_eq!(
            dev.args,
            vec!["server", "--port", "4455", "--bind", "127.0.0.1", "--buildDrafts"]
        );
        assert_eq!(
            hugo.preview_url_path("content/posts/hello-world.md"),
            "/posts/hello-world/"
        );
    }

    #[test]
    fn test_nextjs_astro_jekyll_eleventy_zola_detection_and_commands() {
        // Astro
        let astro_dir = TempDir::new().unwrap();
        fs::write(astro_dir.path().join("astro.config.mjs"), "export default {}").unwrap();
        let m = detect_project_ssg(astro_dir.path(), SsgId::Hugo);
        assert_eq!(m.ssg, SsgId::Astro);
        let astro_cmd = get_adapter(SsgId::Astro).dev_command(
            astro_dir.path(),
            4321,
            &DevOptions::default(),
            Some("npx"),
        );
        assert_eq!(
            astro_cmd.args,
            vec!["astro", "dev", "--port", "4321", "--host", "127.0.0.1"]
        );

        // Next.js
        let next_dir = TempDir::new().unwrap();
        fs::write(next_dir.path().join("next.config.ts"), "export default {}").unwrap();
        assert_eq!(detect_project_ssg(next_dir.path(), SsgId::Hugo).ssg, SsgId::Nextjs);

        // Jekyll
        let jekyll_dir = TempDir::new().unwrap();
        fs::write(jekyll_dir.path().join("_config.yml"), "title: Site").unwrap();
        fs::create_dir_all(jekyll_dir.path().join("_posts")).unwrap();
        assert_eq!(detect_project_ssg(jekyll_dir.path(), SsgId::Hugo).ssg, SsgId::Jekyll);

        // Eleventy
        let el_dir = TempDir::new().unwrap();
        fs::write(el_dir.path().join("eleventy.config.js"), "module.exports = {}").unwrap();
        assert_eq!(detect_project_ssg(el_dir.path(), SsgId::Hugo).ssg, SsgId::Eleventy);

        // Zola
        let zola_dir = TempDir::new().unwrap();
        fs::write(zola_dir.path().join("config.toml"), "compile_sass = true").unwrap();
        fs::create_dir_all(zola_dir.path().join("templates")).unwrap();
        assert_eq!(detect_project_ssg(zola_dir.path(), SsgId::Hugo).ssg, SsgId::Zola);
    }
}
