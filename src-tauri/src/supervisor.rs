use crate::events::{EVENT_SSG_LOG, EVENT_SSG_STATUS};
use crate::ssg::{CommandSpec, SsgId};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::net::TcpListener;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const MAX_LOG_LINES: usize = 500;
const READINESS_TIMEOUT_MS: u64 = 35_000;
const READINESS_POLL_INTERVAL_MS: u64 = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerLogLine {
    pub timestamp: String,
    pub stream: String, // "stdout" | "stderr"
    pub level: String,  // "info" | "warn" | "error"
    pub line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatusPayload {
    pub state: String, // "stopped" | "starting" | "running" | "error"
    pub ssg: Option<SsgId>,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub pid: Option<u32>,
    pub error: Option<String>,
}

impl Default for ServerStatusPayload {
    fn default() -> Self {
        Self {
            state: "stopped".to_string(),
            ssg: None,
            port: None,
            url: None,
            pid: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutputResult {
    pub ok: bool,
    pub exit_code: i32,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub error: Option<String>,
}

/// Allocates a free ephemeral localhost port by binding `127.0.0.1:0`.
pub fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind ephemeral port on 127.0.0.1:0: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read local address: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

/// Classifies a single log line into `"info"`, `"warn"`, or `"error"`, explicitly ignoring
/// `"deprecated"` and `"ExperimentalWarning"` when flagging errors so noisy Node/theme warnings
/// don't paint the console red.
pub fn classify_log_level(line: &str) -> &'static str {
    let lower = line.to_ascii_lowercase();
    if lower.contains("deprecated") || line.contains("ExperimentalWarning") {
        return "warn";
    }
    if lower.contains("error")
        || lower.contains("fatal")
        || lower.contains("panic:")
        || lower.contains("unhandledrejection")
    {
        return "error";
    }
    if lower.contains("warn") {
        return "warn";
    }
    "info"
}

pub struct ServerSupervisor {
    status: Arc<Mutex<ServerStatusPayload>>,
    logs: Arc<Mutex<VecDeque<ServerLogLine>>>,
    active_pgid: Arc<Mutex<Option<u32>>>,
}

impl Default for ServerSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl ServerSupervisor {
    pub fn new() -> Self {
        Self {
            status: Arc::new(Mutex::new(ServerStatusPayload::default())),
            logs: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES))),
            active_pgid: Arc::new(Mutex::new(None)),
        }
    }

    pub fn get_status(&self) -> ServerStatusPayload {
        self.status
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default()
    }

    pub fn get_logs(&self) -> Vec<ServerLogLine> {
        self.logs
            .lock()
            .map(|q| q.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn last_n_lines(&self, n: usize) -> String {
        let Ok(q) = self.logs.lock() else {
            return String::new();
        };
        let len = q.len();
        let start = len.saturating_sub(n);
        q.iter()
            .skip(start)
            .map(|l| l.line.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn emit_status(&self, app: Option<&AppHandle>, payload: ServerStatusPayload) {
        if let Ok(mut guard) = self.status.lock() {
            *guard = payload.clone();
        }
        if let Some(handle) = app {
            let _ = handle.emit(EVENT_SSG_STATUS, payload);
        }
    }

    /// Starts the active SSG dev server in its own process group (`process_group(0)`),
    /// pumps stdout/stderr into the 500-line ring buffer, and polls HTTP readiness on
    /// `http://127.0.0.1:<port>/` every 200ms up to 35s.
    pub async fn start(
        &self,
        spec: CommandSpec,
        ssg: SsgId,
        port: u16,
        app: Option<AppHandle>,
    ) -> Result<ServerStatusPayload, String> {
        self.stop(app.as_ref()).await;

        if let Ok(mut q) = self.logs.lock() {
            q.clear();
        }

        let url = format!("http://127.0.0.1:{port}/");
        self.emit_status(
            app.as_ref(),
            ServerStatusPayload {
                state: "starting".to_string(),
                ssg: Some(ssg),
                port: Some(port),
                url: Some(url.clone()),
                pid: None,
                error: None,
            },
        );

        let mut cmd = Command::new(&spec.program);
        cmd.args(&spec.args)
            .current_dir(&spec.cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        for (k, v) in &spec.env {
            cmd.env(k, v);
        }

        #[cfg(unix)]
        {
            #[allow(unused_imports)]
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        let mut child = cmd.spawn().map_err(|e| {
            let err_msg = format!(
                "Failed to spawn '{}' ({}): {e}",
                spec.display_command(),
                ssg.as_str()
            );
            self.emit_status(
                app.as_ref(),
                ServerStatusPayload {
                    state: "error".to_string(),
                    ssg: Some(ssg),
                    port: None,
                    url: None,
                    pid: None,
                    error: Some(err_msg.clone()),
                },
            );
            err_msg
        })?;

        let pid = child.id().ok_or_else(|| "Spawned process had no PID".to_string())?;
        if let Ok(mut g) = self.active_pgid.lock() {
            *g = Some(pid);
        }

        // Pump stdout and stderr concurrently into the 500-line ring buffer
        if let Some(stdout) = child.stdout.take() {
            let logs_clone = Arc::clone(&self.logs);
            let app_clone = app.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    push_log_line(&logs_clone, app_clone.as_ref(), "stdout", line);
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let logs_clone = Arc::clone(&self.logs);
            let app_clone = app.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    push_log_line(&logs_clone, app_clone.as_ref(), "stderr", line);
                }
            });
        }

        // Background reaper task to detect early exit or unexpected crash
        let status_arc = Arc::clone(&self.status);
        let pgid_arc = Arc::clone(&self.active_pgid);
        let logs_arc = Arc::clone(&self.logs);
        let app_for_reaper = app.clone();
        tokio::spawn(async move {
            let exit_res = child.wait().await;
            let was_active = {
                let mut g = pgid_arc.lock().unwrap();
                if *g == Some(pid) {
                    *g = None;
                    true
                } else {
                    false
                }
            };
            if was_active {
                let tail = tail_from_deque(&logs_arc, 12);
                let err_str = match exit_res {
                    Ok(code) => format!(
                        "Dev server exited unexpectedly ({code}).\nLast log lines:\n{tail}"
                    ),
                    Err(e) => format!("Dev server process error: {e}\nLast log lines:\n{tail}"),
                };
                let dead_payload = ServerStatusPayload {
                    state: "stopped".to_string(),
                    ssg: Some(ssg),
                    port: None,
                    url: None,
                    pid: None,
                    error: Some(err_str),
                };
                if let Ok(mut s) = status_arc.lock() {
                    *s = dead_payload.clone();
                }
                if let Some(h) = app_for_reaper {
                    let _ = h.emit(EVENT_SSG_STATUS, dead_payload);
                }
            }
        });

        // Poll HTTP readiness every 200ms up to 35s
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .map_err(|e| format!("Failed to create HTTP readiness client: {e}"))?;

        let max_attempts = READINESS_TIMEOUT_MS / READINESS_POLL_INTERVAL_MS;
        for _ in 0..max_attempts {
            // Check if process already exited
            let still_running = self
                .active_pgid
                .lock()
                .map(|g| *g == Some(pid))
                .unwrap_or(false);
            if !still_running {
                let tail = self.last_n_lines(12);
                let msg = format!(
                    "{} dev server exited before becoming ready on {url}.\nLast 12 log lines:\n{tail}",
                    ssg.as_str()
                );
                return Err(msg);
            }

            if let Ok(_resp) = client.get(&url).send().await {
                let running_payload = ServerStatusPayload {
                    state: "running".to_string(),
                    ssg: Some(ssg),
                    port: Some(port),
                    url: Some(url),
                    pid: Some(pid),
                    error: None,
                };
                self.emit_status(app.as_ref(), running_payload.clone());
                return Ok(running_payload);
            }

            tokio::time::sleep(Duration::from_millis(READINESS_POLL_INTERVAL_MS)).await;
        }

        // Timed out waiting for HTTP readiness
        let tail = self.last_n_lines(12);
        self.stop(app.as_ref()).await;
        let timeout_msg = format!(
            "{} dev server did not respond on {url} within 35s.\nLast 12 log lines:\n{tail}",
            ssg.as_str()
        );
        self.emit_status(
            app.as_ref(),
            ServerStatusPayload {
                state: "error".to_string(),
                ssg: Some(ssg),
                port: None,
                url: None,
                pid: None,
                error: Some(timeout_msg.clone()),
            },
        );
        Err(timeout_msg)
    }

    /// Stops the active child process group (`SIGTERM` to `-pgid`, followed by `SIGKILL` after 2s).
    pub async fn stop(&self, app: Option<&AppHandle>) -> ServerStatusPayload {
        let pgid_opt = self.active_pgid.lock().ok().and_then(|mut g| g.take());
        if let Some(pgid) = pgid_opt {
            terminate_process_group(pgid).await;
        }
        let stopped = ServerStatusPayload::default();
        self.emit_status(app, stopped.clone());
        stopped
    }

    /// Synchronous process group cleanup invoked on `RunEvent::Exit` so quitting OrangeGel
    /// never leaves an orphaned SSG server holding a port.
    pub fn stop_sync(&self) {
        let pgid_opt = self.active_pgid.lock().ok().and_then(|mut g| g.take());
        if let Some(pgid) = pgid_opt {
            #[cfg(unix)]
            unsafe {
                let neg_pgid = -(pgid as i32);
                libc::kill(neg_pgid, libc::SIGTERM);
                std::thread::sleep(Duration::from_millis(150));
                libc::kill(neg_pgid, libc::SIGKILL);
            }
        }
    }
}

#[cfg(unix)]
async fn terminate_process_group(pgid: u32) {
    let neg_pgid = -(pgid as i32);
    unsafe {
        libc::kill(neg_pgid, libc::SIGTERM);
    }
    for _ in 0..20 {
        let alive = unsafe { libc::kill(neg_pgid, 0) == 0 };
        if !alive {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    unsafe {
        libc::kill(neg_pgid, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
async fn terminate_process_group(_pgid: u32) {}

fn push_log_line(
    logs: &Arc<Mutex<VecDeque<ServerLogLine>>>,
    app: Option<&AppHandle>,
    stream: &str,
    line: String,
) {
    let entry = ServerLogLine {
        timestamp: Utc::now().format("%H:%M:%S").to_string(),
        stream: stream.to_string(),
        level: classify_log_level(&line).to_string(),
        line,
    };
    if let Ok(mut q) = logs.lock() {
        if q.len() >= MAX_LOG_LINES {
            q.pop_front();
        }
        q.push_back(entry.clone());
    }
    if let Some(h) = app {
        let _ = h.emit(EVENT_SSG_LOG, entry);
    }
}

fn tail_from_deque(logs: &Arc<Mutex<VecDeque<ServerLogLine>>>, n: usize) -> String {
    let Ok(q) = logs.lock() else {
        return String::new();
    };
    let len = q.len();
    let start = len.saturating_sub(n);
    q.iter()
        .skip(start)
        .map(|l| l.line.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Runs a one-shot command (such as an SSG production build) and returns stdout/stderr even on failure.
pub async fn run_command_spec(spec: &CommandSpec) -> CommandOutputResult {
    let display = spec.display_command();
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (k, v) in &spec.env {
        cmd.env(k, v);
    }

    match cmd.output().await {
        Ok(out) => {
            let code = out.status.code().unwrap_or(-1);
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            let ok = out.status.success();
            let error = if ok {
                None
            } else {
                Some(format!(
                    "Command '{display}' failed with exit code {code}"
                ))
            };
            CommandOutputResult {
                ok,
                exit_code: code,
                command: display,
                stdout,
                stderr,
                error,
            }
        }
        Err(e) => CommandOutputResult {
            ok: false,
            exit_code: -1,
            command: display.clone(),
            stdout: String::new(),
            stderr: String::new(),
            error: Some(format!("Failed to execute '{display}': {e}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_free_port_returns_valid_ephemeral_port() {
        let p1 = free_port().unwrap();
        let p2 = free_port().unwrap();
        assert!(p1 > 1024);
        assert!(p2 > 1024);
    }

    #[test]
    fn test_log_classifier_ignores_deprecated_and_experimental_warnings_as_errors() {
        assert_eq!(
            classify_log_level("WARN  deprecated: .Site.Author was deprecated in Hugo v0.120.0"),
            "warn"
        );
        assert_eq!(
            classify_log_level("(node:1234) ExperimentalWarning: CommonJS module error text"),
            "warn"
        );
        assert_eq!(
            classify_log_level("ERROR 2026/10/20 failed to assemble template"),
            "error"
        );
        assert_eq!(
            classify_log_level("Web Server is available at http://127.0.0.1:1313/"),
            "info"
        );
    }
}
