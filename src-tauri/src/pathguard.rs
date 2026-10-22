use std::fs;
use std::path::{Component, Path, PathBuf};

/// Trust boundary enforcing that every user-supplied relative path resolves strictly inside
/// the open project's canonical root directory.
pub struct PathGuard;

impl PathGuard {
    /// Resolves a user-supplied relative path inside `root`, rejecting:
    /// - empty paths
    /// - absolute paths (e.g. `/etc/passwd` or `C:\...`)
    /// - any `..` parent traversal component
    /// - any symlink whose target escapes outside the canonicalized `root`
    ///
    /// Supports non-existent leaf filenames or subdirectories (used by `create_content` and
    /// `save_document`) by canonicalizing the deepest existing ancestor and appending the
    /// verified normal components of the non-existent tail.
    pub fn abs(root: &Path, user_rel: &str) -> Result<PathBuf, String> {
        let trimmed = user_rel.trim();
        if trimmed.is_empty() {
            return Err("Path cannot be empty".to_string());
        }

        let rel_path = Path::new(trimmed);
        if rel_path.is_absolute() || trimmed.starts_with('/') || trimmed.starts_with('\\') {
            return Err(format!("Absolute path rejected: {user_rel}"));
        }

        // Reject any `..`, root dir, or prefix components up front
        let mut clean_components = Vec::new();
        for comp in rel_path.components() {
            match comp {
                Component::Normal(part) => {
                    let s = part.to_string_lossy();
                    if s.contains('\0') {
                        return Err("NUL byte in path rejected".to_string());
                    }
                    clean_components.push(part.to_os_string());
                }
                Component::CurDir => {}
                Component::ParentDir => {
                    return Err(format!("Parent directory traversal ('..') rejected: {user_rel}"));
                }
                Component::RootDir | Component::Prefix(_) => {
                    return Err(format!("Root or prefix component rejected: {user_rel}"));
                }
            }
        }

        if clean_components.is_empty() {
            return Err("Path resolves to project root itself rather than a file".to_string());
        }

        let canon_root = fs::canonicalize(root)
            .map_err(|e| format!("Failed to canonicalize project root '{}': {e}", root.display()))?;

        // Walk components to find the deepest existing path so symlinks at any level are resolved
        let mut cur = canon_root.clone();
        let mut idx = 0;
        while idx < clean_components.len() {
            let next = cur.join(&clean_components[idx]);
            if next.exists() || fs::symlink_metadata(&next).is_ok() {
                let canon_next = fs::canonicalize(&next).map_err(|e| {
                    format!(
                        "Failed to canonicalize path component '{}': {e}",
                        next.display()
                    )
                })?;
                if !canon_next.starts_with(&canon_root) {
                    return Err(format!(
                        "Path escapes project root via symlink: {user_rel}"
                    ));
                }
                cur = canon_next;
                idx += 1;
            } else {
                break;
            }
        }

        // Append remaining non-existent normal components
        for remaining in &clean_components[idx..] {
            cur.push(remaining);
        }

        if !cur.starts_with(&canon_root) {
            return Err(format!("Resolved path escapes project root: {user_rel}"));
        }

        Ok(cur)
    }

    /// Converts an absolute path inside `root` back into a normalized forward-slash relative path.
    pub fn rel(root: &Path, abs: &Path) -> Result<String, String> {
        let canon_root = fs::canonicalize(root)
            .map_err(|e| format!("Failed to canonicalize project root '{}': {e}", root.display()))?;

        // Canonicalize the existing portion of `abs`
        let resolved_abs = if abs.exists() {
            fs::canonicalize(abs)
                .map_err(|e| format!("Failed to canonicalize path '{}': {e}", abs.display()))?
        } else {
            let mut tail = Vec::new();
            let mut cursor = abs;
            let canon_prefix = loop {
                if cursor.exists() {
                    break fs::canonicalize(cursor).map_err(|e| {
                        format!("Failed to canonicalize ancestor '{}': {e}", cursor.display())
                    })?;
                }
                if let (Some(parent), Some(name)) = (cursor.parent(), cursor.file_name()) {
                    tail.push(name.to_os_string());
                    cursor = parent;
                } else {
                    return Err(format!("Path '{}' is outside project root", abs.display()));
                }
            };
            let mut rebuilt = canon_prefix;
            for part in tail.into_iter().rev() {
                rebuilt.push(part);
            }
            rebuilt
        };

        let stripped = resolved_abs
            .strip_prefix(&canon_root)
            .map_err(|_| format!("Path '{}' escapes project root", abs.display()))?;

        let mut parts = Vec::new();
        for comp in stripped.components() {
            match comp {
                Component::Normal(p) => parts.push(p.to_string_lossy().into_owned()),
                Component::CurDir => {}
                _ => {
                    return Err(format!(
                        "Invalid relative path component in '{}'",
                        abs.display()
                    ))
                }
            }
        }

        Ok(parts.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_valid_nested_existing_and_nonexistent_paths() {
        let tmp = TempDir::new().unwrap();
        let content_dir = tmp.path().join("content/posts");
        fs::create_dir_all(&content_dir).unwrap();
        let post_file = content_dir.join("hello.md");
        fs::write(&post_file, "# Hello").unwrap();

        // Existing file
        let resolved = PathGuard::abs(tmp.path(), "content/posts/hello.md").unwrap();
        assert_eq!(resolved, fs::canonicalize(&post_file).unwrap());

        let rel = PathGuard::rel(tmp.path(), &resolved).unwrap();
        assert_eq!(rel, "content/posts/hello.md");

        // Non-existent leaf file for create_content
        let future = PathGuard::abs(tmp.path(), "content/posts/new-draft.md").unwrap();
        assert!(future.ends_with("content/posts/new-draft.md"));
        assert_eq!(
            PathGuard::rel(tmp.path(), &future).unwrap(),
            "content/posts/new-draft.md"
        );
    }

    #[test]
    fn test_rejects_parent_traversal() {
        let tmp = TempDir::new().unwrap();
        assert!(PathGuard::abs(tmp.path(), "../secret.txt").is_err());
        assert!(PathGuard::abs(tmp.path(), "content/../../etc/passwd").is_err());
        assert!(PathGuard::abs(tmp.path(), "..").is_err());
    }

    #[test]
    fn test_rejects_absolute_paths_and_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(PathGuard::abs(tmp.path(), "/etc/passwd").is_err());
        assert!(PathGuard::abs(tmp.path(), "").is_err());
        assert!(PathGuard::abs(tmp.path(), "   ").is_err());
        assert!(PathGuard::abs(tmp.path(), ".").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn test_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root_tmp = TempDir::new().unwrap();
        let outside_tmp = TempDir::new().unwrap();
        let outside_secret = outside_tmp.path().join("secret.md");
        fs::write(&outside_secret, "classified").unwrap();

        let escape_link = root_tmp.path().join("escape");
        symlink(outside_tmp.path(), &escape_link).unwrap();

        let res = PathGuard::abs(root_tmp.path(), "escape/secret.md");
        assert!(res.is_err(), "Expected symlink escape outside root to fail");
    }
}
