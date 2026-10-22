use crate::ssg::SsgId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

const MAX_RECENT_PROJECTS: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub preferred_ssg: SsgId,
    pub binary_overrides: HashMap<String, String>,
    pub recent_projects: Vec<String>,
    pub llm_endpoint: String,
    pub llm_model: String,
    pub build_drafts: bool,
    pub disable_fast_render: bool,
    pub minify_build: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            preferred_ssg: SsgId::Hugo,
            binary_overrides: HashMap::new(),
            recent_projects: Vec::new(),
            llm_endpoint: "http://localhost:11434/v1".to_string(),
            llm_model: "qwen2.5:7b".to_string(),
            build_drafts: true,
            disable_fast_render: false,
            minify_build: true,
        }
    }
}

impl AppSettings {
    pub fn default_config_path() -> PathBuf {
        if let Ok(home) = std::env::var("HOME") {
            let mac_dir = PathBuf::from(&home)
                .join("Library")
                .join("Application Support")
                .join("com.jasonsmithio.orangegel");
            return mac_dir.join("settings.json");
        }
        std::env::temp_dir()
            .join("com.jasonsmithio.orangegel")
            .join("settings.json")
    }

    /// Loads settings from disk. Corrupt or missing files fall back cleanly to defaults
    /// so a broken settings file can never prevent OrangeGel from starting.
    pub fn load_from(path: &Path) -> Self {
        match fs::read_to_string(path) {
            Ok(raw) => serde_json::from_str::<AppSettings>(&raw).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// Saves settings using atomic write-then-rename in the same directory.
    pub fn save_to(&self, path: &Path) -> Result<(), String> {
        let parent = path
            .parent()
            .ok_or_else(|| "Invalid settings file path".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings directory '{}': {e}", parent.display()))?;

        let serialized = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize settings: {e}"))?;

        atomic_write_bytes(path, serialized.as_bytes())
    }

    pub fn record_recent_project(&mut self, root_path: &str) {
        let trimmed = root_path.trim().to_string();
        if trimmed.is_empty() {
            return;
        }
        self.recent_projects.retain(|p| p != &trimmed);
        self.recent_projects.insert(0, trimmed);
        if self.recent_projects.len() > MAX_RECENT_PROJECTS {
            self.recent_projects.truncate(MAX_RECENT_PROJECTS);
        }
    }
}

/// Atomic write-then-rename helper shared by settings, project config, dictionary, and document saves.
pub fn atomic_write_bytes(target_path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target_path
        .parent()
        .ok_or_else(|| format!("Target path '{}' has no parent directory", target_path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create directory '{}': {e}", parent.display()))?;

    let mut tmp = NamedTempFile::new_in(parent)
        .map_err(|e| format!("Failed to create temporary file in '{}': {e}", parent.display()))?;
    tmp.write_all(bytes)
        .map_err(|e| format!("Failed to write temporary file: {e}"))?;
    tmp.flush()
        .map_err(|e| format!("Failed to flush temporary file: {e}"))?;
    tmp.persist(target_path)
        .map_err(|e| format!("Failed to atomically persist '{}': {e}", target_path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_settings_atomic_roundtrip_and_corrupt_fallback() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");

        let mut s = AppSettings::default();
        assert_eq!(s.preferred_ssg, SsgId::Hugo);
        s.record_recent_project("/Users/test/site-a");
        s.record_recent_project("/Users/test/site-b");
        s.save_to(&path).unwrap();

        let loaded = AppSettings::load_from(&path);
        assert_eq!(loaded.recent_projects[0], "/Users/test/site-b");
        assert_eq!(loaded.recent_projects[1], "/Users/test/site-a");

        // Corrupt JSON falls back to defaults instead of panicking
        fs::write(&path, "{broken json").unwrap();
        let fallback = AppSettings::load_from(&path);
        assert_eq!(fallback.preferred_ssg, SsgId::Hugo);
    }
}
