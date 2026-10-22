use crate::settings::AppSettings;
use crate::ssg::{get_adapter, ResolvedToolchain, SsgAdapter, SsgId};
use crate::supervisor::ServerSupervisor;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

#[derive(Debug, Clone)]
pub struct ActiveProject {
    pub root: PathBuf,
    pub active_ssg: SsgId,
    pub detection_reason: String,
}

pub struct AppState {
    pub settings_path: PathBuf,
    pub settings: RwLock<AppSettings>,
    pub project: RwLock<Option<ActiveProject>>,
    pub supervisor: Arc<ServerSupervisor>,
    pub startup_project: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self::with_startup_project(None)
    }

    pub fn with_startup_project(startup_project: Option<String>) -> Self {
        let settings_path = AppSettings::default_config_path();
        let settings = AppSettings::load_from(&settings_path);
        Self {
            settings_path,
            settings: RwLock::new(settings),
            project: RwLock::new(None),
            supervisor: Arc::new(ServerSupervisor::new()),
            startup_project: Mutex::new(startup_project),
        }
    }

    pub fn require_project(&self) -> Result<ActiveProject, String> {
        let guard = self
            .project
            .read()
            .map_err(|_| "Failed to acquire project lock".to_string())?;
        guard
            .clone()
            .ok_or_else(|| "No project is currently open".to_string())
    }

    /// Re-resolves the active SSG binary on demand so if a user installs `hugo` or `npx`
    /// while OrangeGel is running, clicking Start Server or Build immediately succeeds.
    pub fn require_ssg(
        &self,
        proj: &ActiveProject,
    ) -> Result<(Box<dyn SsgAdapter>, ResolvedToolchain), String> {
        let adapter = get_adapter(proj.active_ssg);
        let override_bin = self
            .settings
            .read()
            .ok()
            .and_then(|s| s.binary_overrides.get(proj.active_ssg.as_str()).cloned());
        let resolved = adapter.resolve_binary(&proj.root, override_bin.as_deref())?;
        Ok((adapter, resolved))
    }
}
