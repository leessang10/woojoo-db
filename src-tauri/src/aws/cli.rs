//! Runs the user's local AWS CLI with fixed argument lists (no shell) and maps
//! failures to stable error codes, so raw stderr never reaches the UI.
use serde_json::Value;
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tokio::{
    io::AsyncReadExt,
    process::Command,
    sync::{oneshot, Semaphore},
    time::timeout,
};

/// At most three CLI processes at once; a request waits briefly for a slot.
static SLOTS: Semaphore = Semaphore::const_new(3);
/// Cancel handles for in-flight requests the UI may abandon.
static RUNNING: LazyLock<Mutex<HashMap<String, oneshot::Sender<()>>>> =
    LazyLock::new(Default::default);
const OUTPUT_LIMIT: usize = 8 * 1024 * 1024;

pub fn cli_path() -> Option<PathBuf> {
    let executable = if cfg!(windows) { "aws.exe" } else { "aws" };
    let mut candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths)
                .filter(|p| p.is_absolute())
                .map(|p| p.join(executable))
                .collect()
        })
        .unwrap_or_default();
    if cfg!(windows) {
        if let Some(base) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(base).join("Amazon/AWSCLIV2/aws.exe"));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}
pub fn validate(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 256
        || value.starts_with('-')
        || value.chars().any(char::is_control)
    {
        return Err("AWS_INVALID_SELECTION".into());
    }
    Ok(())
}
pub fn validate_region(region: &str) -> Result<(), String> {
    validate(region)?;
    if region.len() > 64
        || !region
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("AWS_INVALID_SELECTION".into());
    }
    Ok(())
}
pub fn failure(stderr: &str) -> String {
    let s = stderr.to_lowercase();
    if s.contains("accessdenied") || s.contains("unauthorizedoperation") || s.contains("authorizationerror") {
        "AWS_ACCESS_DENIED"
    } else if s.contains("expired")
        || s.contains("sso")
        || s.contains("invalidclienttokenid")
        || s.contains("unable to locate credentials")
        || s.contains("token")
    {
        "AWS_AUTH_REQUIRED"
    } else if s.contains("could not connect")
        || s.contains("timeout")
        || s.contains("ssl validation")
    {
        "AWS_NETWORK_ERROR"
    } else if s.contains("nosuchbucket")
        || s.contains("notfound")
        || s.contains("resourcenotfound")
    {
        "AWS_NOT_FOUND"
    } else {
        "AWS_CLI_FAILED"
    }
    .into()
}

/// Profile, region and output flags shared by every resource request.
pub fn scoped(service: &str, operation: &str, profile: &str, region: &str) -> Result<Vec<String>, String> {
    validate(profile)?;
    validate_region(region)?;
    Ok([
        service,
        operation,
        "--profile",
        profile,
        "--region",
        region,
        "--output",
        "json",
        "--color",
        "off",
        "--no-cli-pager",
        "--cli-connect-timeout",
        "10",
        "--cli-read-timeout",
        "20",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect())
}
/// One CLI page of at most 100 items, continuing from an opaque token.
pub fn paged(mut args: Vec<String>, token: Option<&str>) -> Result<Vec<String>, String> {
    args.extend(["--max-items".into(), "100".into()]);
    if let Some(token) = token {
        if token.is_empty() || token.len() > 16384 {
            return Err("AWS_INVALID_SELECTION".into());
        }
        args.extend(["--starting-token".into(), token.into()]);
    }
    Ok(args)
}

pub async fn run(args: &[&str]) -> Result<String, String> {
    run_owned(args.iter().map(|s| s.to_string()).collect(), None).await
}
pub async fn json(args: &[&str]) -> Result<Value, String> {
    let mut args = args.to_vec();
    args.extend([
        "--output",
        "json",
        "--color",
        "off",
        "--cli-connect-timeout",
        "5",
        "--cli-read-timeout",
        "20",
    ]);
    parse(&run(&args).await?)
}
pub fn parse(raw: &str) -> Result<Value, String> {
    serde_json::from_str(raw).map_err(|_| "AWS_INVALID_RESPONSE".into())
}

/// Runs one request; `request` lets `aws_cancel` stop it from the UI.
pub async fn run_owned(args: Vec<String>, request: Option<&str>) -> Result<String, String> {
    let path = cli_path().ok_or("AWS_CLI_NOT_FOUND")?;
    let _slot = timeout(Duration::from_secs(5), SLOTS.acquire())
        .await
        .map_err(|_| "AWS_BUSY")?
        .map_err(|_| "AWS_BUSY")?;
    let cancelled = request.map(|id| {
        let (tx, rx) = oneshot::channel();
        RUNNING.lock().unwrap().insert(id.to_owned(), tx);
        rx
    });
    let result = execute(path, args, cancelled, "2").await;
    if let Some(id) = request {
        RUNNING.lock().unwrap().remove(id);
    }
    result
}
/// Runs a change once: a retried write could apply twice, and it is never cancelled midway.
pub async fn run_write(args: Vec<String>) -> Result<String, String> {
    let path = cli_path().ok_or("AWS_CLI_NOT_FOUND")?;
    let _slot = timeout(Duration::from_secs(5), SLOTS.acquire())
        .await
        .map_err(|_| "AWS_BUSY")?
        .map_err(|_| "AWS_BUSY")?;
    execute(path, args, None, "1").await
}
async fn execute(
    path: PathBuf,
    args: Vec<String>,
    cancelled: Option<oneshot::Receiver<()>>,
    attempts: &str,
) -> Result<String, String> {
    let mut command = Command::new(path);
    command
        .args(args)
        .env("AWS_PAGER", "")
        .env("AWS_CLI_AUTO_PROMPT", "off")
        // Windows locales (e.g. CP949) are not UTF-8; keep Unicode names intact.
        .env("AWS_CLI_OUTPUT_ENCODING", "UTF-8")
        .env("AWS_MAX_ATTEMPTS", attempts)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|_| "AWS_CLI_START_FAILED")?;
    let stdout = child.stdout.take().ok_or("AWS_CLI_START_FAILED")?;
    let stderr = child.stderr.take().ok_or("AWS_CLI_START_FAILED")?;
    // Bounded reads keep a huge response from exhausting desktop memory.
    let work = async {
        let read = |stream: Box<dyn tokio::io::AsyncRead + Send + Unpin>| async move {
            let mut data = Vec::new();
            stream
                .take(OUTPUT_LIMIT as u64 + 1)
                .read_to_end(&mut data)
                .await
                .map_err(|_| "AWS_CLI_FAILED".to_string())?;
            if data.len() > OUTPUT_LIMIT {
                return Err("AWS_RESPONSE_TOO_LARGE".to_string());
            }
            Ok(data)
        };
        let (out, err) = tokio::try_join!(read(Box::new(stdout)), read(Box::new(stderr)))?;
        let status = child.wait().await.map_err(|_| "AWS_CLI_FAILED")?;
        if !status.success() {
            return Err(failure(&String::from_utf8_lossy(&err)));
        }
        String::from_utf8(out).map_err(|_| "AWS_INVALID_RESPONSE".to_string())
    };
    let limited = async {
        timeout(Duration::from_secs(40), work)
            .await
            .map_err(|_| "AWS_TIMEOUT".to_string())?
    };
    match cancelled {
        // Dropping the work future kills the child process (kill_on_drop).
        Some(cancelled) => tokio::select! {
            result = limited => result,
            _ = cancelled => Err("AWS_CANCELLED".into()),
        },
        None => limited.await,
    }
}

#[tauri::command]
pub fn aws_cancel(request: String) {
    if let Some(cancel) = RUNNING.lock().unwrap().remove(&request) {
        let _ = cancel.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_flags_and_sanitizes_errors() {
        assert!(validate("--debug").is_err());
        assert!(validate("x\ny").is_err());
        assert!(validate("team production").is_ok());
        assert!(validate_region("--endpoint-url=http://example.com").is_err());
        assert!(validate_region("ap-northeast-2").is_ok());
        assert_eq!(failure("ExpiredToken: sensitive details"), "AWS_AUTH_REQUIRED");
        assert_eq!(failure("AccessDeniedException"), "AWS_ACCESS_DENIED");
        assert_eq!(failure("An error occurred (NoSuchBucket)"), "AWS_NOT_FOUND");
    }
    #[test]
    fn profile_and_token_are_single_arguments() {
        let args = paged(scoped("ec2", "describe-instances", "dev team", "ap-northeast-2").unwrap(), Some("token with spaces")).unwrap();
        let at = |flag: &str| args[args.iter().position(|a| a == flag).unwrap() + 1].clone();
        assert_eq!(at("--profile"), "dev team");
        assert_eq!(at("--starting-token"), "token with spaces");
        assert!(paged(vec![], Some("")).is_err());
    }
}
