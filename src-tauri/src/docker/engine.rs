use super::cli;
use std::sync::LazyLock;
use tokio::sync::Semaphore;

pub(super) static START: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(1));

// Docker Desktop manages these local Windows pipes. A context's name alone is not evidence.
pub fn is_desktop_endpoint(endpoint: &str) -> bool {
    matches!(
        endpoint.replace('\\', "/").to_ascii_lowercase().as_str(),
        "npipe:////./pipe/docker_engine"
            | "npipe:////./pipe/dockerdesktoplinuxengine"
            | "npipe:////./pipe/dockerdesktopwindowsengine"
    )
}

pub async fn supported() -> bool {
    cfg!(windows)
        && cli::run(None, &["desktop", "start", "--help"], 10)
            .await
            .is_ok_and(|help| help.contains("--timeout"))
}

#[tauri::command]
pub async fn docker_start_desktop(context: String) -> Result<(), String> {
    cli::validate(&context)?;
    let _permit = START
        .try_acquire()
        .map_err(|_| "DOCKER_DESKTOP_START_BUSY")?;
    // Re-read the actual endpoint so a renamed or edited context cannot trigger a local startup.
    let raw = cli::run(
        None,
        &[
            "context",
            "inspect",
            &context,
            "--format",
            "{{json .Endpoints.docker.Host}}",
        ],
        10,
    )
    .await?;
    let endpoint: String = serde_json::from_str(&raw).map_err(|_| "DOCKER_INVALID_RESPONSE")?;
    if !cfg!(windows) || !is_desktop_endpoint(&endpoint) {
        return Err("DOCKER_DESKTOP_LOCAL_ONLY".into());
    }
    if !supported().await {
        return Err("DOCKER_DESKTOP_START_UNSUPPORTED".into());
    }
    // Start once; never switch the user's context or restart an already-running engine.
    cli::run(None, &["desktop", "start", "--timeout", "90"], 100)
        .await
        .map_err(|e| format!("DOCKER_DESKTOP_START_FAILED: {e}"))?;
    // Desktop may be running in a different engine mode. Only this context's response proves readiness.
    cli::run(
        Some(&context),
        &["info", "--format", "{{json .ServerVersion}}"],
        10,
    )
    .await
    .map_err(|e| format!("DOCKER_DESKTOP_CONTEXT_NOT_READY: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_local_desktop_pipes_can_start_desktop() {
        for endpoint in [
            "npipe:////./pipe/docker_engine",
            "npipe:////./pipe/dockerDesktopLinuxEngine",
            "npipe:////./pipe/dockerDesktopWindowsEngine",
        ] {
            assert!(is_desktop_endpoint(endpoint));
        }
        for endpoint in [
            "ssh://server",
            "tcp://127.0.0.1:2375",
            "npipe:////server/pipe/docker_engine",
            "npipe:////./pipe/custom-engine",
            "unix:///var/run/docker.sock",
            "desktop-linux",
        ] {
            assert!(!is_desktop_endpoint(endpoint));
        }
    }
}
