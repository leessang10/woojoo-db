use std::{path::PathBuf, process::Stdio, sync::LazyLock, time::Duration};
use tokio::{io::AsyncReadExt, process::Command, sync::Semaphore, time::timeout};

static SLOTS: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(4));
const LIMIT: u64 = 16 * 1024 * 1024;

pub fn path() -> Result<PathBuf, String> {
    let exe = if cfg!(windows) {
        "docker.exe"
    } else {
        "docker"
    };
    let mut paths: Vec<_> = std::env::var_os("PATH")
        .map(|p| {
            std::env::split_paths(&p)
                .filter(|p| p.is_absolute())
                .map(|p| p.join(exe))
                .collect()
        })
        .unwrap_or_default();
    if let Some(p) = std::env::var_os("ProgramFiles") {
        paths.push(PathBuf::from(p).join("Docker/Docker/resources/bin/docker.exe"));
    }
    paths
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| "DOCKER_CLI_NOT_FOUND".into())
}
pub fn validate(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 256
        || value.starts_with('-')
        || value.chars().any(char::is_control)
    {
        return Err("DOCKER_INVALID_TARGET".into());
    }
    Ok(())
}
pub fn id(value: &str) -> Result<(), String> {
    if value.len() != 64 || !value.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("DOCKER_INVALID_CONTAINER_ID".into());
    }
    Ok(())
}
pub fn command(context: Option<&str>, args: &[&str]) -> Result<Command, String> {
    let mut c = Command::new(path()?);
    if let Some(ctx) = context {
        validate(ctx)?;
        c.args(["--context", ctx]);
    }
    c.args(args)
        .env_remove("DOCKER_HOST")
        .env_remove("DOCKER_CONTEXT")
        .env_remove("DOCKER_TLS_VERIFY")
        .env_remove("DOCKER_CERT_PATH")
        .env_remove("DOCKER_API_VERSION")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(0x08000000);
    Ok(c)
}
pub fn failure(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    let code = if lower.contains("permission denied") || lower.contains("access is denied") {
        "DOCKER_ACCESS_DENIED"
    } else if lower.contains("cannot connect")
        || lower.contains("failed to connect")
        || lower.contains("is the docker daemon")
        || lower.contains("error during connect")
        || lower.contains("connection refused")
    {
        "DOCKER_ENGINE_UNAVAILABLE"
    } else {
        "DOCKER_COMMAND_FAILED"
    };
    format!("{code}: {}", stderr.chars().take(1500).collect::<String>())
}
pub async fn run(context: Option<&str>, args: &[&str], seconds: u64) -> Result<String, String> {
    let _operation = super::storage::operation().await?;
    let _slot = timeout(Duration::from_secs(3), SLOTS.acquire())
        .await
        .map_err(|_| "DOCKER_BUSY")?
        .map_err(|_| "DOCKER_BUSY")?;
    execute(command(context, args)?, Duration::from_secs(seconds), LIMIT).await
}
pub(super) async fn execute(command: Command, duration: Duration, limit: u64) -> Result<String, String> {
    let output = execute_bytes(command, duration, limit).await?;
    String::from_utf8(output).map_err(|_| "DOCKER_INVALID_UTF8".into())
}
pub(super) async fn execute_bytes(mut command: Command, duration: Duration, limit: u64) -> Result<Vec<u8>, String> {
    let mut child = command.spawn().map_err(|_| "DOCKER_CLI_START_FAILED")?;
    let stdout = child.stdout.take().ok_or("DOCKER_PIPE_FAILED")?;
    let stderr = child.stderr.take().ok_or("DOCKER_PIPE_FAILED")?;
    let read = |stream: Box<dyn tokio::io::AsyncRead + Send + Unpin>| async move {
        let mut data = Vec::new();
        stream
            .take(limit + 1)
            .read_to_end(&mut data)
            .await
            .map_err(|_| "DOCKER_READ_FAILED")?;
        if data.len() as u64 > limit {
            return Err("DOCKER_OUTPUT_LIMIT");
        }
        Ok(data)
    };
    let work = async {
        let (out, err) = tokio::try_join!(read(Box::new(stdout)), read(Box::new(stderr)))?;
        let status = child.wait().await.map_err(|_| "DOCKER_WAIT_FAILED")?;
        Ok::<_, &str>((status, out, err))
    };
    let result = timeout(duration, work).await;
    match result {
        Ok(Ok((status, out, err))) if status.success() => {
            let _ = err;
            Ok(out)
        }
        Ok(Ok((_, _, err))) => Err(failure(&String::from_utf8_lossy(&err))),
        other => {
            let _ = child.kill().await;
            Err(match other {
                Ok(Err(e)) => e.into(),
                _ => "DOCKER_TIMEOUT: operation result may be unknown".into(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn targets_and_ids_are_validated() {
        assert!(validate("desktop-linux").is_ok());
        assert!(validate("--host=x").is_err());
        assert!(validate("bad\nname").is_err());
        assert!(id(&"a".repeat(64)).is_ok());
        assert!(id("container-name").is_err());
    }
    #[test]
    fn command_pins_context_without_a_shell() {
        if path().is_err() {
            return;
        }
        let c = command(Some("my context"), &["container", "ls"]).unwrap();
        let args: Vec<_> = c
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args, ["--context", "my context", "container", "ls"]);
        assert!(c
            .as_std()
            .get_envs()
            .any(|(k, v)| k == "DOCKER_HOST" && v.is_none()));
    }
    #[cfg(windows)]
    fn fake(script: &str) -> Command {
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .creation_flags(0x08000000);
        c
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn executor_bounds_output_and_kills_on_timeout() {
        assert_eq!(
            execute(
                fake("[Console]::Write(('x' * 4096))"),
                Duration::from_secs(10),
                1024
            )
            .await
            .unwrap_err(),
            "DOCKER_OUTPUT_LIMIT"
        );
        assert!(execute(
            fake("Start-Sleep -Seconds 5"),
            Duration::from_millis(50),
            1024
        )
        .await
        .unwrap_err()
        .starts_with("DOCKER_TIMEOUT"));
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn executor_drains_both_pipes_and_reports_failed_exit() {
        assert_eq!(
            execute(
                fake("[Console]::Write('ok'); [Console]::Error.Write('diagnostic')"),
                Duration::from_secs(10),
                1024
            )
            .await
            .unwrap(),
            "ok"
        );
        assert!(execute(
            fake("[Console]::Error.Write('permission denied'); exit 1"),
            Duration::from_secs(10),
            1024
        )
        .await
        .unwrap_err()
        .starts_with("DOCKER_ACCESS_DENIED"));
    }
}
