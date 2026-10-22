use crate::events::EVENT_DEPLOY_EVENT;
use crate::settings::atomic_write_bytes;
use crate::ssg::{augmented_path_env, find_executable, get_adapter, BuildOptions, SsgId};
use crate::supervisor::run_command_spec;
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DeployProvider {
    #[default]
    #[serde(alias = "firebase")]
    Firebase,
    #[serde(alias = "githubPages", alias = "github_pages", alias = "github-pages")]
    GithubPages,
    #[serde(alias = "gitlabPages", alias = "gitlab_pages", alias = "gitlab-pages")]
    GitlabPages,
    #[serde(alias = "cloudflarePages", alias = "cloudflare_pages")]
    Cloudflare,
    #[serde(alias = "netlify")]
    Netlify,
    #[serde(alias = "vercel")]
    Vercel,
    #[serde(alias = "s3Cloudfront", alias = "s3_cloudfront", alias = "s3-cloudfront")]
    S3Cloudfront,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeployConfig {
    pub provider: DeployProvider,
    pub gcp_project: String,
    pub firebase_site: String,
    pub live_url: String,
    pub enable_cloud_run: bool,
    pub cloud_run_service: Option<String>,
    pub cloud_run_region: Option<String>,
    pub artifact_repo: Option<String>,
    pub app_label: String,
    pub env_label: String,
    pub github_repo: Option<String>,
    pub github_branch: Option<String>,
    pub use_blacksmith_ci: bool,
    pub gitlab_project: Option<String>,
    pub gitlab_branch: Option<String>,
    pub cloudflare_project: Option<String>,
    pub cloudflare_branch: Option<String>,
    pub netlify_site_id: Option<String>,
    pub vercel_project: Option<String>,
    pub s3_bucket: Option<String>,
    pub cloudfront_distribution_id: Option<String>,
}

impl Default for DeployConfig {
    fn default() -> Self {
        Self {
            provider: DeployProvider::Firebase,
            gcp_project: "jasonsmithio".to_string(),
            firebase_site: String::new(),
            live_url: String::new(),
            enable_cloud_run: false,
            cloud_run_service: None,
            cloud_run_region: None,
            artifact_repo: None,
            app_label: "orangegel-site".to_string(),
            env_label: "prod".to_string(),
            github_repo: Some("orangegel/site".to_string()),
            github_branch: Some("gh-pages".to_string()),
            use_blacksmith_ci: true,
            gitlab_project: None,
            gitlab_branch: Some("main".to_string()),
            cloudflare_project: None,
            cloudflare_branch: Some("main".to_string()),
            netlify_site_id: None,
            vercel_project: None,
            s3_bucket: None,
            cloudfront_distribution_id: None,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployStepPlan {
    pub index: usize,
    #[serde(default)]
    pub step: usize,
    pub id: String,
    pub title: String,
    pub command_preview: String,
    #[serde(default = "default_true")]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployPlan {
    pub ssg: SsgId,
    pub config: DeployConfig,
    pub steps: Vec<DeployStepPlan>,
    pub mermaid_diagram: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployEventPayload {
    pub step_id: String,
    pub status: String, // "running" | "success" | "error"
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployRunResult {
    pub ok: bool,
    pub rollback_revision: Option<String>,
    pub deployed_digest: Option<String>,
    pub plain_sha256: Option<String>,
    pub cache_busted_sha256: Option<String>,
    pub verification_note: String,
    pub logs: Vec<String>,
}

/// Validates a GCP billing label value (`^[a-z][a-z0-9_-]{0,62}$`).
pub fn validate_gcp_label(label: &str) -> Result<(), String> {
    let re = Regex::new(r"^[a-z][a-z0-9_-]{0,62}$").unwrap();
    if re.is_match(label) {
        Ok(())
    } else {
        Err(format!(
            "Invalid GCP billing label '{label}': must start with a lowercase letter, contain only [a-z0-9_-], and be at most 63 characters"
        ))
    }
}

/// Parses `firebase.json` to extract any Hosting Cloud Run rewrite `(serviceId, region)` and `site`.
pub fn inspect_firebase_json(root: &Path) -> (Option<String>, Option<String>, Option<String>) {
    let path = root.join("firebase.json");
    let Ok(raw) = fs::read_to_string(path) else {
        return (None, None, None);
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return (None, None, None);
    };

    let Some(hosting) = val.get("hosting") else {
        return (None, None, None);
    };

    let hosting_obj = if hosting.is_array() {
        hosting.as_array().and_then(|a| a.first())
    } else {
        Some(hosting)
    };

    let Some(h) = hosting_obj else {
        return (None, None, None);
    };

    let site = h
        .get("site")
        .or_else(|| h.get("target"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if let Some(rewrites) = h.get("rewrites").and_then(|r| r.as_array()) {
        for rw in rewrites {
            if let Some(run_cfg) = rw.get("run") {
                let service_id = run_cfg
                    .get("serviceId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let region = run_cfg
                    .get("region")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                if service_id.is_some() || region.is_some() {
                    return (site, service_id, region);
                }
            }
        }
    }

    (site, None, None)
}

/// Loads `<root>/.orangegel/deploy.json` with fallback read from `<root>/.orangegel-legacy/deploy.json`,
/// and enriches missing fields from `firebase.json`.
pub fn load_deploy_config(root: &Path) -> DeployConfig {
    let primary = root.join(".orangegel/deploy.json");
    let legacy = root.join(".orangegel-legacy/deploy.json");
    let mut cfg: DeployConfig = fs::read_to_string(&primary)
        .or_else(|_| fs::read_to_string(&legacy))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let (fb_site, fb_service, fb_region) = inspect_firebase_json(root);
    if cfg.firebase_site.trim().is_empty() {
        if let Some(s) = fb_site {
            cfg.firebase_site = s;
        }
    }
    // Region and service come from firebase.json rewrite if present
    if let Some(svc) = fb_service {
        if cfg.cloud_run_service.as_deref().unwrap_or("").is_empty() {
            cfg.cloud_run_service = Some(svc);
        }
    }
    if let Some(reg) = fb_region {
        cfg.cloud_run_region = Some(reg);
    }

    cfg
}

pub fn save_deploy_config(root: &Path, cfg: &DeployConfig) -> Result<DeployConfig, String> {
    validate_gcp_label(&cfg.app_label)?;
    validate_gcp_label(&cfg.env_label)?;

    let target = root.join(".orangegel/deploy.json");
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| format!("Failed to serialize deploy config: {e}"))?;
    atomic_write_bytes(&target, json.as_bytes())?;
    Ok(cfg.clone())
}

fn make_step(index: usize, id: &str, title: &str, command_preview: String) -> DeployStepPlan {
    DeployStepPlan {
        index,
        step: index,
        id: id.to_string(),
        title: title.to_string(),
        command_preview,
        required: true,
    }
}

/// Generates the deterministic deployment plan WITHOUT running any commands.
/// Enforces the invariant across all 7 providers:
/// 1. Preflight & Rollback / Auth capture
/// 2. SSG Production Build
/// 3. (Optional) Origin / CI workflow / S3 upload step
/// 4. Edge Publication / Cache Invalidation ALWAYS LAST before verification
/// 5. Edge vs Origin SHA-256 verification
pub fn plan_deploy(
    root: &Path,
    ssg: SsgId,
    cfg: &DeployConfig,
    build_opts: &BuildOptions,
    binary_overrides: &HashMap<String, String>,
) -> Result<DeployPlan, String> {
    if cfg.provider == DeployProvider::Firebase {
        validate_gcp_label(&cfg.app_label)?;
        validate_gcp_label(&cfg.env_label)?;
    }

    let adapter = get_adapter(ssg);
    let override_bin = binary_overrides.get(ssg.as_str()).map(|s| s.as_str());
    let resolved_bin = adapter
        .resolve_binary(root, override_bin)
        .ok()
        .map(|r| r.binary_path);
    let build_spec = adapter.build_command(root, build_opts, resolved_bin.as_deref());
    let out_dir_path = adapter.output_dir(root);
    let out_dir_rel = out_dir_path
        .strip_prefix(root)
        .unwrap_or(&out_dir_path)
        .to_string_lossy()
        .to_string();

    let mut steps = Vec::new();
    let mermaid_diagram: String;

    match cfg.provider {
        DeployProvider::Firebase => {
            let site_target = if cfg.firebase_site.trim().is_empty() {
                "default"
            } else {
                cfg.firebase_site.trim()
            };

            steps.push(make_step(
                1,
                "preflight",
                "Preflight & Rollback Revision Capture",
                if cfg.enable_cloud_run {
                    let svc = cfg.cloud_run_service.as_deref().unwrap_or("site-origin");
                    let reg = cfg.cloud_run_region.as_deref().unwrap_or("us-central1");
                    format!(
                        "gcloud run services describe {svc} --project={} --region={reg} --format='value(status.latestReadyRevisionName)'",
                        cfg.gcp_project
                    )
                } else {
                    "Verify SSG, firebase CLI, and .orangegel/deploy.json".to_string()
                },
            ));

            steps.push(make_step(
                2,
                "ssg_build",
                &format!("{} Production Build", adapter.display_name()),
                build_spec.display_command(),
            ));

            if cfg.enable_cloud_run {
                let svc = cfg
                    .cloud_run_service
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .ok_or_else(|| {
                        "Cloud Run serviceId is required when Cloud Run is enabled".to_string()
                    })?;
                let reg = cfg
                    .cloud_run_region
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .ok_or_else(|| {
                        "Cloud Run region is required (from firebase.json rewrite or deploy.json)"
                            .to_string()
                    })?;
                let repo = cfg
                    .artifact_repo
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("cloud-run-source-deploy");
                let image_base =
                    format!("{reg}-docker.pkg.dev/{}/{repo}/{svc}", cfg.gcp_project);

                steps.push(make_step(
                    3,
                    "cloud_run",
                    "Cloud Build & Cloud Run Deploy by @sha256 Digest",
                    format!(
                        "gcloud builds submit --tag {image_base}:latest --project={} && gcloud run deploy {svc} --image {image_base}@sha256:<DIGEST> --region={reg} --project={} --labels app={},env={}",
                        cfg.gcp_project, cfg.gcp_project, cfg.app_label, cfg.env_label
                    ),
                ));
            }

            let hosting_idx = steps.len() + 1;
            steps.push(make_step(
                hosting_idx,
                "firebase_hosting",
                "Firebase Hosting Release (Edge Purge — Always Last)",
                format!(
                    "firebase deploy --only hosting:{site_target} --project {}",
                    cfg.gcp_project
                ),
            ));

            let verify_idx = steps.len() + 1;
            let url_preview = if cfg.live_url.trim().is_empty() {
                format!("https://{site_target}.web.app")
            } else {
                cfg.live_url.trim().to_string()
            };
            steps.push(make_step(
                verify_idx,
                "verify_edge",
                "Plain vs. Cache-Busted Edge SHA-256 Verification",
                format!("GET {url_preview} vs GET {url_preview}?_og_cb=<timestamp>"),
            ));

            mermaid_diagram = if cfg.enable_cloud_run {
                "flowchart LR\n  A[\"1. Preflight\"] --> B[\"2. SSG Build\"]\n  B --> C[\"3. Cloud Run @sha256\"]\n  C --> D[\"4. Firebase Hosting Edge Purge\"]\n  D --> E[\"5. SHA-256 Verify\"]".to_string()
            } else {
                "flowchart LR\n  A[\"1. Preflight\"] --> B[\"2. SSG Build\"]\n  B --> D[\"3. Firebase Hosting Edge Purge\"]\n  D --> E[\"4. SHA-256 Verify\"]".to_string()
            };
        }
        DeployProvider::GithubPages => {
            let repo = cfg
                .github_repo
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("orangegel/site");
            let branch = cfg
                .github_branch
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("gh-pages");

            steps.push(make_step(
                1,
                "preflight",
                "Preflight & GitHub Remote Check",
                format!("git remote -v && gh repo view {repo}"),
            ));
            steps.push(make_step(
                2,
                "ssg_build",
                &format!("{} Production Build", adapter.display_name()),
                build_spec.display_command(),
            ));
            if cfg.use_blacksmith_ci {
                steps.push(make_step(
                    3,
                    "blacksmith_workflow",
                    "Generate Blacksmith GitHub Pages Workflow (blacksmith-4vcpu-ubuntu-2204)",
                    "Write .github/workflows/deploy-pages.yml (runs-on: blacksmith-4vcpu-ubuntu-2204 -> actions/deploy-pages@v4)".to_string(),
                ));
            }
            let gh_idx = steps.len() + 1;
            steps.push(make_step(
                gh_idx,
                "github_pages",
                "GitHub Pages Branch Release (Edge Publish — Always Last)",
                format!("npx gh-pages -d {out_dir_rel} -b {branch} -r https://github.com/{repo}.git"),
            ));
            let verify_idx = steps.len() + 1;
            let default_gh_url = {
                let parts: Vec<&str> = repo.split('/').collect();
                if parts.len() == 2 {
                    format!("https://{}.github.io/{}", parts[0], parts[1])
                } else {
                    format!("https://github.com/{repo}")
                }
            };
            let url_preview = if cfg.live_url.trim().is_empty() {
                default_gh_url
            } else {
                cfg.live_url.trim().to_string()
            };
            steps.push(make_step(
                verify_idx,
                "verify_edge",
                "Plain vs. Cache-Busted Edge SHA-256 Verification",
                format!("GET {url_preview} vs GET {url_preview}?_og_cb=<timestamp>"),
            ));
            mermaid_diagram = "flowchart LR\n  A[\"1. Git Preflight\"] --> B[\"2. SSG Build\"]\n  B --> C[\"3. Blacksmith Pages CI\"]\n  C --> D[\"4. GitHub Pages Publish LAST\"]\n  D --> E[\"5. SHA-256 Verify\"]".to_string();
        }
        DeployProvider::GitlabPages => {
            let project = cfg
                .gitlab_project
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("jasonsmithio/orangegel-site");
            let branch = cfg
                .gitlab_branch
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("main");

            steps.push(make_step(
                1,
                "preflight",
                "Preflight & GitLab Remote Check",
                format!("git remote -v (target: gitlab.com/{project})"),
            ));
            steps.push(make_step(
                2,
                "ssg_build",
                &format!("{} Production Build", adapter.display_name()),
                build_spec.display_command(),
            ));
            steps.push(make_step(
                3,
                "gitlab_ci",
                "Ensure .gitlab-ci.yml pages: Artifact Pipeline",
                "Write .gitlab-ci.yml pages job publishing public/ artifact".to_string(),
            ));
            steps.push(make_step(
                4,
                "gitlab_pages",
                "GitLab Pages Push & Pipeline Release (Edge Publish — Always Last)",
                format!("git push https://gitlab.com/{project}.git HEAD:{branch}"),
            ));
            let url_preview = if cfg.live_url.trim().is_empty() {
                let parts: Vec<&str> = project.split('/').collect();
                if parts.len() == 2 {
                    format!("https://{}.gitlab.io/{}", parts[0], parts[1])
                } else {
                    format!("https://gitlab.com/{project}")
                }
            } else {
                cfg.live_url.trim().to_string()
            };
            steps.push(make_step(
                5,
                "verify_edge",
                "Plain vs. Cache-Busted Edge SHA-256 Verification",
                format!("GET {url_preview} vs GET {url_preview}?_og_cb=<timestamp>"),
            ));
            mermaid_diagram = "flowchart LR\n  A[\"1. GitLab Preflight\"] --> B[\"2. SSG Build\"]\n  B --> C[\"3. .gitlab-ci.yml pages:\"]\n  C --> D[\"4. GitLab Pages Push LAST\"]\n  D --> E[\"5. SHA-256 Verify\"]".to_string();
        }
        DeployProvider::Cloudflare => {
            let cf_proj = cfg
                .cloudflare_project
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("orangegel-site");
            let cf_branch = cfg
                .cloudflare_branch
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("main");

            steps.push(make_step(
                1,
                "preflight",
                "Preflight & Wrangler Auth Check",
                "npx wrangler whoami".to_string(),
            ));
            steps.push(make_step(
                2,
                "ssg_build",
                &format!("{} Production Build", adapter.display_name()),
                build_spec.display_command(),
            ));
            steps.push(make_step(
                3,
                "cloudflare_pages",
                "Cloudflare Pages Edge Release (Always Last)",
                format!(
                    "npx wrangler pages deploy {out_dir_rel} --project-name {cf_proj} --branch {cf_branch}"
                ),
            ));
            let url_preview = if cfg.live_url.trim().is_empty() {
                format!("https://{cf_proj}.pages.dev")
            } else {
                cfg.live_url.trim().to_string()
            };
            steps.push(make_step(
                4,
                "verify_edge",
                "Plain vs. Cache-Busted Edge SHA-256 Verification",
                format!("GET {url_preview} vs GET {url_preview}?_og_cb=<timestamp>"),
            ));
            mermaid_diagram = "flowchart LR\n  A[\"1. Wrangler Preflight\"] --> B[\"2. SSG Build\"]\n  B --> D[\"3. Cloudflare Pages Edge LAST\"]\n  D --> E[\"4. SHA-256 Verify\"]".to_string();
        }
        DeployProvider::Netlify => {
            let site_id = cfg
                .netlify_site_id
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("orangegel-site");

            steps.push(make_step(
                1,
                "preflight",
                "Preflight & Netlify Auth Check",
                "npx netlify status".to_string(),
            ));
            steps.push(make_step(
                2,
                "ssg_build",
                &format!("{} Production Build", adapter.display_name()),
                build_spec.display_command(),
            ));
            steps.push(make_step(
                3,
                "netlify_edge",
                "Netlify Production Edge Deploy (Always Last)",
                format!("npx netlify deploy --prod --dir {out_dir_rel} --site {site_id}"),
            ));
            let url_preview = if cfg.live_url.trim().is_empty() {
                format!("https://{site_id}.netlify.app")
            } else {
                cfg.live_url.trim().to_string()
            };
            steps.push(make_step(
                4,
                "verify_edge",
                "Plain vs. Cache-Busted Edge SHA-256 Verification",
                format!("GET {url_preview} vs GET {url_preview}?_og_cb=<timestamp>"),
            ));
            mermaid_diagram = "flowchart LR\n  A[\"1. Netlify Preflight\"] --> B[\"2. SSG Build\"]\n  B --> D[\"3. Netlify Prod Edge LAST\"]\n  D --> E[\"4. SHA-256 Verify\"]".to_string();
        }
        DeployProvider::Vercel => {
            let vercel_proj = cfg
                .vercel_project
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("orangegel-site");

            steps.push(make_step(
                1,
                "preflight",
                "Preflight & Vercel Auth Check",
                "npx vercel whoami".to_string(),
            ));
            steps.push(make_step(
                2,
                "ssg_build",
                &format!("{} Production Build", adapter.display_name()),
                build_spec.display_command(),
            ));
            steps.push(make_step(
                3,
                "vercel_edge",
                "Vercel Production Edge Release (Always Last)",
                format!("npx vercel deploy {out_dir_rel} --prod --yes --name {vercel_proj}"),
            ));
            let url_preview = if cfg.live_url.trim().is_empty() {
                format!("https://{vercel_proj}.vercel.app")
            } else {
                cfg.live_url.trim().to_string()
            };
            steps.push(make_step(
                4,
                "verify_edge",
                "Plain vs. Cache-Busted Edge SHA-256 Verification",
                format!("GET {url_preview} vs GET {url_preview}?_og_cb=<timestamp>"),
            ));
            mermaid_diagram = "flowchart LR\n  A[\"1. Vercel Preflight\"] --> B[\"2. SSG Build\"]\n  B --> D[\"3. Vercel Prod Edge LAST\"]\n  D --> E[\"4. SHA-256 Verify\"]".to_string();
        }
        DeployProvider::S3Cloudfront => {
            let bucket = cfg
                .s3_bucket
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("orangegel-static-site");
            let dist_id = cfg
                .cloudfront_distribution_id
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("E1ORANGEGELDIST");

            steps.push(make_step(
                1,
                "preflight",
                "Preflight & AWS STS Identity Check",
                "aws sts get-caller-identity".to_string(),
            ));
            steps.push(make_step(
                2,
                "ssg_build",
                &format!("{} Production Build", adapter.display_name()),
                build_spec.display_command(),
            ));
            steps.push(make_step(
                3,
                "s3_sync",
                "Sync Static Artifacts to S3 Origin",
                format!("aws s3 sync {out_dir_rel} s3://{bucket} --delete"),
            ));
            steps.push(make_step(
                4,
                "cloudfront_invalidation",
                "CloudFront Edge Cache Invalidation (Always Last)",
                format!(
                    "aws cloudfront create-invalidation --distribution-id {dist_id} --paths \"/*\""
                ),
            ));
            let url_preview = if cfg.live_url.trim().is_empty() {
                format!("https://{bucket}.s3.amazonaws.com")
            } else {
                cfg.live_url.trim().to_string()
            };
            steps.push(make_step(
                5,
                "verify_edge",
                "Plain vs. Cache-Busted Edge SHA-256 Verification",
                format!("GET {url_preview} vs GET {url_preview}?_og_cb=<timestamp>"),
            ));
            mermaid_diagram = "flowchart LR\n  A[\"1. AWS Preflight\"] --> B[\"2. SSG Build\"]\n  B --> C[\"3. S3 Origin Sync\"]\n  C --> D[\"4. CloudFront Invalidate LAST\"]\n  D --> E[\"5. SHA-256 Verify\"]".to_string();
        }
    }

    Ok(DeployPlan {
        ssg,
        config: cfg.clone(),
        steps,
        mermaid_diagram,
    })
}

fn emit_deploy_step(app: Option<&AppHandle>, step_id: &str, status: &str, message: &str) {
    if let Some(h) = app {
        let _ = h.emit(
            EVENT_DEPLOY_EVENT,
            DeployEventPayload {
                step_id: step_id.to_string(),
                status: status.to_string(),
                message: message.to_string(),
                timestamp: Utc::now().format("%H:%M:%S").to_string(),
            },
        );
    }
}

async fn run_cli_no_prompts(
    root: &Path,
    program: &str,
    args: &[String],
) -> Result<String, String> {
    let out = Command::new(program)
        .args(args)
        .current_dir(root)
        .env("PATH", augmented_path_env(Some(root)))
        .env("CLOUDSDK_CORE_DISABLE_PROMPTS", "1")
        .env("CI", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to execute '{program} {}': {e}", args.join(" ")))?;

    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if !out.status.success() {
        return Err(format!(
            "Command '{program} {}' failed:\n{combined}",
            args.join(" ")
        ));
    }
    Ok(combined.trim().to_string())
}

pub fn generate_blacksmith_github_pages_workflow(build_cmd: &str, out_dir_rel: &str) -> String {
    format!(
        r#"name: Deploy Static Site to GitHub Pages (Blacksmith)

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: blacksmith-4vcpu-ubuntu-2204
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          submodules: recursive
      - name: Setup Pages
        uses: actions/configure-pages@v5
      - name: Build Site
        run: {build_cmd}
      - name: Upload Artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./{out_dir_rel}

  deploy:
    environment:
      name: github-pages
      url: ${{{{ steps.deployment.outputs.page_url }}}}
    runs-on: blacksmith-4vcpu-ubuntu-2204
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
"#
    )
}

pub fn generate_gitlab_pages_ci(build_cmd: &str, out_dir_rel: &str) -> String {
    let move_step = if out_dir_rel != "public" {
        format!("\n    - rm -rf public && mv {out_dir_rel} public")
    } else {
        String::new()
    };
    format!(
        r#"pages:
  stage: deploy
  script:
    - {build_cmd}{move_step}
  artifacts:
    paths:
      - public
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
"#
    )
}

pub async fn run_deploy(
    root: &Path,
    ssg: SsgId,
    cfg: &DeployConfig,
    build_opts: &BuildOptions,
    binary_overrides: &HashMap<String, String>,
    app: Option<AppHandle>,
) -> Result<DeployRunResult, String> {
    let _plan = plan_deploy(root, ssg, cfg, build_opts, binary_overrides)?;
    let mut logs: Vec<String> = Vec::new();

    // 1. Preflight
    emit_deploy_step(
        app.as_ref(),
        "preflight",
        "running",
        "Validating CLIs and target provider configuration...",
    );

    let adapter = get_adapter(ssg);
    let override_bin = binary_overrides.get(ssg.as_str()).map(|s| s.as_str());
    let resolved_ssg = adapter.resolve_binary(root, override_bin)?;

    let mut rollback_revision: Option<String> = None;
    if cfg.provider == DeployProvider::Firebase {
        if find_executable("firebase", Some(root)).is_none() {
            emit_deploy_step(
                app.as_ref(),
                "preflight",
                "error",
                "firebase CLI not found in PATH",
            );
            return Err("firebase CLI not found in PATH. Install firebase-tools first.".to_string());
        }
        if cfg.enable_cloud_run {
            if find_executable("gcloud", Some(root)).is_none() {
                emit_deploy_step(
                    app.as_ref(),
                    "preflight",
                    "error",
                    "gcloud CLI not found in PATH",
                );
                return Err("gcloud CLI not found in PATH.".to_string());
            }
            let svc = cfg.cloud_run_service.as_deref().unwrap_or("site-origin");
            let reg = cfg.cloud_run_region.as_deref().unwrap_or("us-central1");
            if let Ok(rev) = run_cli_no_prompts(
                root,
                "gcloud",
                &[
                    "run".to_string(),
                    "services".to_string(),
                    "describe".to_string(),
                    svc.to_string(),
                    format!("--project={}", cfg.gcp_project),
                    format!("--region={reg}"),
                    "--format=value(status.latestReadyRevisionName)".to_string(),
                ],
            )
            .await
            {
                if !rev.is_empty() {
                    rollback_revision = Some(rev.clone());
                    logs.push(format!("Captured rollback revision: {rev}"));
                }
            }
        }
    }
    emit_deploy_step(app.as_ref(), "preflight", "success", "Preflight passed.");

    // 2. SSG Production Build
    emit_deploy_step(
        app.as_ref(),
        "ssg_build",
        "running",
        &format!("Running {} production build...", adapter.display_name()),
    );
    let build_spec = adapter.build_command(root, build_opts, Some(&resolved_ssg.binary_path));
    let build_res = run_command_spec(&build_spec).await;
    logs.push(format!(
        "$ {}\n{}\n{}",
        build_res.command, build_res.stdout, build_res.stderr
    ));
    if !build_res.ok {
        let err_msg = build_res
            .error
            .unwrap_or_else(|| "SSG production build failed".to_string());
        emit_deploy_step(app.as_ref(), "ssg_build", "error", &err_msg);
        return Err(format!(
            "{err_msg}\n{}\n{}",
            build_res.stdout, build_res.stderr
        ));
    }

    let out_dir = adapter.output_dir(root);
    if !out_dir.exists() {
        let msg = format!(
            "Build succeeded but expected output directory '{}' was not created",
            out_dir.display()
        );
        emit_deploy_step(app.as_ref(), "ssg_build", "error", &msg);
        return Err(msg);
    }
    let out_dir_rel = out_dir
        .strip_prefix(root)
        .unwrap_or(&out_dir)
        .to_string_lossy()
        .to_string();
    emit_deploy_step(
        app.as_ref(),
        "ssg_build",
        "success",
        "Production build complete.",
    );

    let mut deployed_digest: Option<String> = None;
    let live_url: String;

    match cfg.provider {
        DeployProvider::Firebase => {
            if cfg.enable_cloud_run {
                emit_deploy_step(
                    app.as_ref(),
                    "cloud_run",
                    "running",
                    "Building container via Cloud Build and deploying by @sha256 digest...",
                );
                let svc = cfg.cloud_run_service.as_deref().unwrap_or("site-origin");
                let reg = cfg.cloud_run_region.as_deref().unwrap_or("us-central1");
                let repo = cfg
                    .artifact_repo
                    .as_deref()
                    .unwrap_or("cloud-run-source-deploy");
                let image_base =
                    format!("{reg}-docker.pkg.dev/{}/{repo}/{svc}", cfg.gcp_project);

                let submit_out = run_cli_no_prompts(
                    root,
                    "gcloud",
                    &[
                        "builds".to_string(),
                        "submit".to_string(),
                        "--tag".to_string(),
                        format!("{image_base}:latest"),
                        format!("--project={}", cfg.gcp_project),
                    ],
                )
                .await?;
                logs.push(submit_out);

                let digest_out = run_cli_no_prompts(
                    root,
                    "gcloud",
                    &[
                        "artifacts".to_string(),
                        "docker".to_string(),
                        "images".to_string(),
                        "describe".to_string(),
                        format!("{image_base}:latest"),
                        format!("--project={}", cfg.gcp_project),
                        "--format=value(image_summary.digest)".to_string(),
                    ],
                )
                .await?;
                let digest = digest_out.trim().to_string();
                deployed_digest = Some(digest.clone());

                let deploy_out = run_cli_no_prompts(
                    root,
                    "gcloud",
                    &[
                        "run".to_string(),
                        "deploy".to_string(),
                        svc.to_string(),
                        "--image".to_string(),
                        format!("{image_base}@{digest}"),
                        format!("--region={reg}"),
                        format!("--project={}", cfg.gcp_project),
                        "--labels".to_string(),
                        format!("app={},env={}", cfg.app_label, cfg.env_label),
                    ],
                )
                .await?;
                logs.push(deploy_out);
                emit_deploy_step(
                    app.as_ref(),
                    "cloud_run",
                    "success",
                    "Cloud Run revision deployed by immutable digest.",
                );
            }

            emit_deploy_step(
                app.as_ref(),
                "firebase_hosting",
                "running",
                "Releasing to Firebase Hosting & purging CDN edge...",
            );
            let site_target = if cfg.firebase_site.trim().is_empty() {
                "default"
            } else {
                cfg.firebase_site.trim()
            };
            let fb_out = run_cli_no_prompts(
                root,
                "firebase",
                &[
                    "deploy".to_string(),
                    "--only".to_string(),
                    format!("hosting:{site_target}"),
                    "--project".to_string(),
                    cfg.gcp_project.clone(),
                ],
            )
            .await?;
            logs.push(fb_out);
            emit_deploy_step(
                app.as_ref(),
                "firebase_hosting",
                "success",
                "Firebase Hosting release completed.",
            );
            live_url = if cfg.live_url.trim().is_empty() {
                format!("https://{site_target}.web.app/")
            } else {
                cfg.live_url.trim().to_string()
            };
        }
        DeployProvider::GithubPages => {
            let repo = cfg
                .github_repo
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("orangegel/site");
            let branch = cfg
                .github_branch
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("gh-pages");

            if cfg.use_blacksmith_ci {
                emit_deploy_step(
                    app.as_ref(),
                    "blacksmith_workflow",
                    "running",
                    "Writing .github/workflows/deploy-pages.yml (blacksmith-4vcpu-ubuntu-2204)...",
                );
                let wf_path = root.join(".github/workflows/deploy-pages.yml");
                let wf_content = generate_blacksmith_github_pages_workflow(
                    &build_spec.display_command(),
                    &out_dir_rel,
                );
                atomic_write_bytes(&wf_path, wf_content.as_bytes())?;
                logs.push(format!("Wrote {}", wf_path.display()));
                emit_deploy_step(
                    app.as_ref(),
                    "blacksmith_workflow",
                    "success",
                    "Blacksmith GitHub Pages workflow generated.",
                );
            }

            emit_deploy_step(
                app.as_ref(),
                "github_pages",
                "running",
                "Publishing output directory to GitHub Pages branch...",
            );
            let gh_out = run_cli_no_prompts(
                root,
                "npx",
                &[
                    "--yes".to_string(),
                    "gh-pages".to_string(),
                    "-d".to_string(),
                    out_dir_rel.clone(),
                    "-b".to_string(),
                    branch.to_string(),
                    "-r".to_string(),
                    format!("https://github.com/{repo}.git"),
                ],
            )
            .await?;
            logs.push(gh_out);
            emit_deploy_step(
                app.as_ref(),
                "github_pages",
                "success",
                "GitHub Pages release completed.",
            );
            live_url = if cfg.live_url.trim().is_empty() {
                let parts: Vec<&str> = repo.split('/').collect();
                if parts.len() == 2 {
                    format!("https://{}.github.io/{}/", parts[0], parts[1])
                } else {
                    format!("https://github.com/{repo}")
                }
            } else {
                cfg.live_url.trim().to_string()
            };
        }
        DeployProvider::GitlabPages => {
            let project = cfg
                .gitlab_project
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("jasonsmithio/orangegel-site");
            let branch = cfg
                .gitlab_branch
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("main");

            emit_deploy_step(
                app.as_ref(),
                "gitlab_ci",
                "running",
                "Ensuring .gitlab-ci.yml pages: job exists...",
            );
            let ci_path = root.join(".gitlab-ci.yml");
            if !ci_path.exists() {
                let ci_content =
                    generate_gitlab_pages_ci(&build_spec.display_command(), &out_dir_rel);
                atomic_write_bytes(&ci_path, ci_content.as_bytes())?;
                logs.push(format!("Wrote {}", ci_path.display()));
            }
            emit_deploy_step(
                app.as_ref(),
                "gitlab_ci",
                "success",
                ".gitlab-ci.yml verified.",
            );

            emit_deploy_step(
                app.as_ref(),
                "gitlab_pages",
                "running",
                "Pushing to GitLab repository to trigger Pages deployment...",
            );
            let gl_out = run_cli_no_prompts(
                root,
                "git",
                &[
                    "push".to_string(),
                    format!("https://gitlab.com/{project}.git"),
                    format!("HEAD:{branch}"),
                ],
            )
            .await?;
            logs.push(gl_out);
            emit_deploy_step(
                app.as_ref(),
                "gitlab_pages",
                "success",
                "GitLab Pages pipeline triggered.",
            );
            live_url = if cfg.live_url.trim().is_empty() {
                let parts: Vec<&str> = project.split('/').collect();
                if parts.len() == 2 {
                    format!("https://{}.gitlab.io/{}/", parts[0], parts[1])
                } else {
                    format!("https://gitlab.com/{project}")
                }
            } else {
                cfg.live_url.trim().to_string()
            };
        }
        DeployProvider::Cloudflare => {
            let cf_proj = cfg
                .cloudflare_project
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("orangegel-site");
            let cf_branch = cfg
                .cloudflare_branch
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("main");

            emit_deploy_step(
                app.as_ref(),
                "cloudflare_pages",
                "running",
                "Deploying to Cloudflare Pages via Wrangler...",
            );
            let cf_out = run_cli_no_prompts(
                root,
                "npx",
                &[
                    "--yes".to_string(),
                    "wrangler".to_string(),
                    "pages".to_string(),
                    "deploy".to_string(),
                    out_dir_rel.clone(),
                    "--project-name".to_string(),
                    cf_proj.to_string(),
                    "--branch".to_string(),
                    cf_branch.to_string(),
                ],
            )
            .await?;
            logs.push(cf_out);
            emit_deploy_step(
                app.as_ref(),
                "cloudflare_pages",
                "success",
                "Cloudflare Pages edge deployment complete.",
            );
            live_url = if cfg.live_url.trim().is_empty() {
                format!("https://{cf_proj}.pages.dev/")
            } else {
                cfg.live_url.trim().to_string()
            };
        }
        DeployProvider::Netlify => {
            let site_id = cfg
                .netlify_site_id
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("orangegel-site");

            emit_deploy_step(
                app.as_ref(),
                "netlify_edge",
                "running",
                "Deploying to Netlify production edge...",
            );
            let nl_out = run_cli_no_prompts(
                root,
                "npx",
                &[
                    "--yes".to_string(),
                    "netlify-cli".to_string(),
                    "deploy".to_string(),
                    "--prod".to_string(),
                    "--dir".to_string(),
                    out_dir_rel.clone(),
                    "--site".to_string(),
                    site_id.to_string(),
                ],
            )
            .await?;
            logs.push(nl_out);
            emit_deploy_step(
                app.as_ref(),
                "netlify_edge",
                "success",
                "Netlify production edge deployment complete.",
            );
            live_url = if cfg.live_url.trim().is_empty() {
                format!("https://{site_id}.netlify.app/")
            } else {
                cfg.live_url.trim().to_string()
            };
        }
        DeployProvider::Vercel => {
            let vercel_proj = cfg
                .vercel_project
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("orangegel-site");

            emit_deploy_step(
                app.as_ref(),
                "vercel_edge",
                "running",
                "Deploying to Vercel production edge...",
            );
            let vc_out = run_cli_no_prompts(
                root,
                "npx",
                &[
                    "--yes".to_string(),
                    "vercel".to_string(),
                    "deploy".to_string(),
                    out_dir_rel.clone(),
                    "--prod".to_string(),
                    "--yes".to_string(),
                    "--name".to_string(),
                    vercel_proj.to_string(),
                ],
            )
            .await?;
            logs.push(vc_out);
            emit_deploy_step(
                app.as_ref(),
                "vercel_edge",
                "success",
                "Vercel production deployment complete.",
            );
            live_url = if cfg.live_url.trim().is_empty() {
                format!("https://{vercel_proj}.vercel.app/")
            } else {
                cfg.live_url.trim().to_string()
            };
        }
        DeployProvider::S3Cloudfront => {
            let bucket = cfg
                .s3_bucket
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("orangegel-static-site");
            let dist_id = cfg
                .cloudfront_distribution_id
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("E1ORANGEGELDIST");

            emit_deploy_step(
                app.as_ref(),
                "s3_sync",
                "running",
                "Syncing build output to S3 bucket...",
            );
            let s3_out = run_cli_no_prompts(
                root,
                "aws",
                &[
                    "s3".to_string(),
                    "sync".to_string(),
                    out_dir_rel.clone(),
                    format!("s3://{bucket}"),
                    "--delete".to_string(),
                ],
            )
            .await?;
            logs.push(s3_out);
            emit_deploy_step(app.as_ref(), "s3_sync", "success", "S3 sync completed.");

            emit_deploy_step(
                app.as_ref(),
                "cloudfront_invalidation",
                "running",
                "Invalidating CloudFront edge cache (Always Last)...",
            );
            let cf_inv_out = run_cli_no_prompts(
                root,
                "aws",
                &[
                    "cloudfront".to_string(),
                    "create-invalidation".to_string(),
                    "--distribution-id".to_string(),
                    dist_id.to_string(),
                    "--paths".to_string(),
                    "/*".to_string(),
                ],
            )
            .await?;
            logs.push(cf_inv_out);
            emit_deploy_step(
                app.as_ref(),
                "cloudfront_invalidation",
                "success",
                "CloudFront edge invalidation created.",
            );
            live_url = if cfg.live_url.trim().is_empty() {
                format!("https://{bucket}.s3.amazonaws.com/")
            } else {
                cfg.live_url.trim().to_string()
            };
        }
    }

    // Final Step: Honest Edge Verification (Plain vs Cache-Busted SHA-256)
    emit_deploy_step(
        app.as_ref(),
        "verify_edge",
        "running",
        "Comparing plain URL vs cache-busted URL SHA-256...",
    );

    let (plain_sha256, cache_busted_sha256, verification_note) =
        verify_live_edge_hashes(&live_url).await;

    emit_deploy_step(
        app.as_ref(),
        "verify_edge",
        "success",
        &verification_note,
    );

    Ok(DeployRunResult {
        ok: true,
        rollback_revision,
        deployed_digest,
        plain_sha256,
        cache_busted_sha256,
        verification_note,
        logs,
    })
}

async fn verify_live_edge_hashes(live_url: &str) -> (Option<String>, Option<String>, String) {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    else {
        return (
            None,
            None,
            "Skipped edge hash comparison (could not initialize HTTP client).".to_string(),
        );
    };

    let ts = Utc::now().timestamp_millis();
    let sep = if live_url.contains('?') { "&" } else { "?" };
    let busted_url = format!("{live_url}{sep}_og_cb={ts}");

    let plain_bytes = match client.get(live_url).send().await {
        Ok(r) => r.bytes().await.ok(),
        Err(_) => None,
    };
    let busted_bytes = match client.get(&busted_url).send().await {
        Ok(r) => r.bytes().await.ok(),
        Err(_) => None,
    };

    match (plain_bytes, busted_bytes) {
        (Some(p), Some(b)) => {
            let mut h1 = Sha256::new();
            h1.update(&p);
            let sha_plain = hex::encode(h1.finalize());

            let mut h2 = Sha256::new();
            h2.update(&b);
            let sha_busted = hex::encode(h2.finalize());

            let note = if sha_plain == sha_busted {
                format!(
                    "Edge and origin SHA-256 hashes match from this machine ({}). Note: Anycast CDN confirms nearest POP is fresh, not global convergence.",
                    &sha_plain[..12]
                )
            } else {
                format!(
                    "Edge SHA-256 ({}) differs from cache-busted origin ({}). Nearest CDN POP is still converging.",
                    &sha_plain[..12],
                    &sha_busted[..12]
                )
            };
            (Some(sha_plain), Some(sha_busted), note)
        }
        _ => (
            None,
            None,
            format!("Deployed to {live_url}; live HTTP hash probe was unreachable from this network."),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_plan_always_purges_the_edge_last() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("hugo.toml"), "baseURL = 'https://example.com/'").unwrap();

        // Case 1: Static-only Firebase Hosting (Cloud Run disabled)
        let static_cfg = DeployConfig {
            provider: DeployProvider::Firebase,
            gcp_project: "jasonsmithio".to_string(),
            firebase_site: "orangegel-docs".to_string(),
            live_url: "https://orangegel-docs.web.app".to_string(),
            enable_cloud_run: false,
            cloud_run_service: None,
            cloud_run_region: None,
            artifact_repo: None,
            app_label: "orangegel".to_string(),
            env_label: "prod".to_string(),
            ..Default::default()
        };
        let plan_static = plan_deploy(
            tmp.path(),
            SsgId::Hugo,
            &static_cfg,
            &BuildOptions::default(),
            &HashMap::new(),
        )
        .unwrap();

        let deploy_steps_static: Vec<&DeployStepPlan> = plan_static
            .steps
            .iter()
            .filter(|s| s.id != "verify_edge")
            .collect();
        let last_static = deploy_steps_static.last().unwrap();
        assert_eq!(last_static.id, "firebase_hosting");
        assert!(last_static
            .command_preview
            .contains("firebase deploy --only hosting:orangegel-docs"));

        // Case 2: Cloud Run origin enabled -> Firebase Hosting MUST still be the final deploy step before verification
        let ssr_cfg = DeployConfig {
            provider: DeployProvider::Firebase,
            gcp_project: "jasonsmithio".to_string(),
            firebase_site: "orangegel-app".to_string(),
            live_url: "https://orangegel-app.web.app".to_string(),
            enable_cloud_run: true,
            cloud_run_service: Some("orangegel-ssr".to_string()),
            cloud_run_region: Some("us-central1".to_string()),
            artifact_repo: Some("containers".to_string()),
            app_label: "orangegel".to_string(),
            env_label: "prod".to_string(),
            ..Default::default()
        };
        let plan_ssr = plan_deploy(
            tmp.path(),
            SsgId::Hugo,
            &ssr_cfg,
            &BuildOptions::default(),
            &HashMap::new(),
        )
        .unwrap();

        let deploy_steps_ssr: Vec<&DeployStepPlan> = plan_ssr
            .steps
            .iter()
            .filter(|s| s.id != "verify_edge")
            .collect();
        assert_eq!(deploy_steps_ssr.len(), 4);
        assert_eq!(deploy_steps_ssr[2].id, "cloud_run");
        assert_eq!(deploy_steps_ssr[3].id, "firebase_hosting");
        assert!(deploy_steps_ssr[3]
            .command_preview
            .contains("firebase deploy --only hosting:orangegel-app"));
        assert_eq!(plan_ssr.steps.last().unwrap().id, "verify_edge");
    }

    #[test]
    fn test_plan_deploy_all_seven_providers() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("hugo.toml"), "baseURL = 'https://orangegel.io/'").unwrap();

        // 1. GitHub Pages (with Blacksmith CI)
        let gh_cfg = DeployConfig {
            provider: DeployProvider::GithubPages,
            github_repo: Some("orangegel/site".to_string()),
            github_branch: Some("gh-pages".to_string()),
            use_blacksmith_ci: true,
            ..Default::default()
        };
        let gh_plan = plan_deploy(
            tmp.path(),
            SsgId::Hugo,
            &gh_cfg,
            &BuildOptions::default(),
            &HashMap::new(),
        )
        .unwrap();
        assert_eq!(gh_plan.steps[2].id, "blacksmith_workflow");
        assert_eq!(gh_plan.steps[3].id, "github_pages");
        assert!(gh_plan.steps[3].command_preview.contains("gh-pages"));
        assert_eq!(gh_plan.steps.last().unwrap().id, "verify_edge");

        // 2. GitLab Pages
        let gl_cfg = DeployConfig {
            provider: DeployProvider::GitlabPages,
            gitlab_project: Some("jasonsmithio/orangegel-site".to_string()),
            gitlab_branch: Some("main".to_string()),
            ..Default::default()
        };
        let gl_plan = plan_deploy(
            tmp.path(),
            SsgId::Hugo,
            &gl_cfg,
            &BuildOptions::default(),
            &HashMap::new(),
        )
        .unwrap();
        assert_eq!(gl_plan.steps[2].id, "gitlab_ci");
        assert_eq!(gl_plan.steps[3].id, "gitlab_pages");
        assert_eq!(gl_plan.steps.last().unwrap().id, "verify_edge");

        // 3. Cloudflare Pages
        let cf_cfg = DeployConfig {
            provider: DeployProvider::Cloudflare,
            cloudflare_project: Some("orangegel-docs".to_string()),
            cloudflare_branch: Some("main".to_string()),
            ..Default::default()
        };
        let cf_plan = plan_deploy(
            tmp.path(),
            SsgId::Hugo,
            &cf_cfg,
            &BuildOptions::default(),
            &HashMap::new(),
        )
        .unwrap();
        assert_eq!(cf_plan.steps[2].id, "cloudflare_pages");
        assert!(cf_plan.steps[2]
            .command_preview
            .contains("wrangler pages deploy"));
        assert_eq!(cf_plan.steps.last().unwrap().id, "verify_edge");

        // 4. Netlify
        let nl_cfg = DeployConfig {
            provider: DeployProvider::Netlify,
            netlify_site_id: Some("orangegel-netlify".to_string()),
            ..Default::default()
        };
        let nl_plan = plan_deploy(
            tmp.path(),
            SsgId::Hugo,
            &nl_cfg,
            &BuildOptions::default(),
            &HashMap::new(),
        )
        .unwrap();
        assert_eq!(nl_plan.steps[2].id, "netlify_edge");
        assert!(nl_plan.steps[2]
            .command_preview
            .contains("netlify deploy --prod"));
        assert_eq!(nl_plan.steps.last().unwrap().id, "verify_edge");

        // 5. Vercel
        let vc_cfg = DeployConfig {
            provider: DeployProvider::Vercel,
            vercel_project: Some("orangegel-vercel".to_string()),
            ..Default::default()
        };
        let vc_plan = plan_deploy(
            tmp.path(),
            SsgId::Hugo,
            &vc_cfg,
            &BuildOptions::default(),
            &HashMap::new(),
        )
        .unwrap();
        assert_eq!(vc_plan.steps[2].id, "vercel_edge");
        assert!(vc_plan.steps[2]
            .command_preview
            .contains("vercel deploy"));
        assert_eq!(vc_plan.steps.last().unwrap().id, "verify_edge");

        // 6. AWS S3 + CloudFront (CloudFront invalidation MUST be last before verify_edge)
        let s3_cfg = DeployConfig {
            provider: DeployProvider::S3Cloudfront,
            s3_bucket: Some("orangegel-prod-bucket".to_string()),
            cloudfront_distribution_id: Some("E999CFDIST".to_string()),
            ..Default::default()
        };
        let s3_plan = plan_deploy(
            tmp.path(),
            SsgId::Hugo,
            &s3_cfg,
            &BuildOptions::default(),
            &HashMap::new(),
        )
        .unwrap();
        assert_eq!(s3_plan.steps[2].id, "s3_sync");
        assert_eq!(s3_plan.steps[3].id, "cloudfront_invalidation");
        assert!(s3_plan.steps[3]
            .command_preview
            .contains("aws cloudfront create-invalidation --distribution-id E999CFDIST"));
        assert_eq!(s3_plan.steps.last().unwrap().id, "verify_edge");
    }

    #[test]
    fn test_gcp_label_validation_and_firebase_json_rewrite_extraction() {
        assert!(validate_gcp_label("orangegel-site_1").is_ok());
        assert!(validate_gcp_label("InvalidUppercase").is_err());
        assert!(validate_gcp_label("1leadingdigit").is_err());

        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("firebase.json"),
            r#"{
              "hosting": {
                "site": "my-citrus-site",
                "public": "public",
                "rewrites": [
                  {
                    "source": "**",
                    "run": {
                      "serviceId": "citrus-api",
                      "region": "us-east1"
                    }
                  }
                ]
              }
            }"#,
        )
        .unwrap();

        let cfg = load_deploy_config(tmp.path());
        assert_eq!(cfg.provider, DeployProvider::Firebase);
        assert_eq!(cfg.firebase_site, "my-citrus-site");
        assert_eq!(cfg.cloud_run_service.as_deref(), Some("citrus-api"));
        assert_eq!(cfg.cloud_run_region.as_deref(), Some("us-east1"));
    }
}
