use serde::Serialize;
use serde_json::Value;
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::process::Command;

fn cli_path() -> Option<PathBuf> {
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
fn validate(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 256
        || value.starts_with('-')
        || value.chars().any(char::is_control)
    {
        return Err("AWS_INVALID_SELECTION".into());
    }
    Ok(())
}
fn failure(stderr: &str) -> String {
    let s = stderr.to_lowercase();
    if s.contains("accessdenied") || s.contains("unauthorizedoperation") {
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
    } else {
        "AWS_CLI_FAILED"
    }
    .into()
}
async fn run(args: &[&str]) -> Result<String, String> {
    let path = cli_path().ok_or("AWS_CLI_NOT_FOUND")?;
    let mut command = Command::new(path);
    command
        .args(args)
        .env("AWS_PAGER", "")
        .env("AWS_CLI_AUTO_PROMPT", "off")
        .env("AWS_MAX_ATTEMPTS", "2")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(Duration::from_secs(60), command.output())
        .await
        .map_err(|_| "AWS_TIMEOUT")?
        .map_err(|_| "AWS_CLI_START_FAILED")?;
    if !output.status.success() {
        return Err(failure(&String::from_utf8_lossy(&output.stderr)));
    }
    String::from_utf8(output.stdout).map_err(|_| "AWS_INVALID_RESPONSE".into())
}
async fn json(args: &[&str]) -> Result<Value, String> {
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
    serde_json::from_str(&run(&args).await?).map_err(|_| "AWS_INVALID_RESPONSE".into())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    installed: bool,
    version: String,
    profiles: Vec<String>,
}
#[tauri::command]
pub async fn aws_cli_info() -> Result<CliInfo, String> {
    if cli_path().is_none() {
        return Ok(CliInfo {
            installed: false,
            version: String::new(),
            profiles: vec![],
        });
    }
    let version = run(&["--version"]).await?;
    let profiles = run(&["configure", "list-profiles"]).await?;
    let mut profiles: Vec<String> = profiles
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    profiles.sort();
    profiles.dedup();
    Ok(CliInfo {
        installed: true,
        version: version.trim().into(),
        profiles,
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    account: String,
    arn: String,
    region: String,
    regions: Vec<String>,
    regions_warning: Option<String>,
}
#[tauri::command]
pub async fn aws_environment(profile: String) -> Result<Environment, String> {
    validate(&profile)?;
    let region = run(&["configure", "get", "region", "--profile", &profile])
        .await
        .unwrap_or_default()
        .trim()
        .to_owned();
    let region = if region.is_empty() {
        "us-east-1".into()
    } else {
        region
    };
    let identity = json(&[
        "sts",
        "get-caller-identity",
        "--profile",
        &profile,
        "--region",
        &region,
    ])
    .await?;
    let result = json(&[
        "ec2",
        "describe-regions",
        "--profile",
        &profile,
        "--region",
        &region,
    ])
    .await;
    let (mut regions, warning) = match result {
        Ok(value) => (
            value["Regions"]
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .filter_map(|row| row["RegionName"].as_str().map(str::to_owned))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            None,
        ),
        Err(reason) => (vec![], Some(reason)),
    };
    regions.push(region.clone());
    regions.sort();
    regions.dedup();
    Ok(Environment {
        account: identity["Account"].as_str().unwrap_or("").into(),
        arn: identity["Arn"].as_str().unwrap_or("").into(),
        region,
        regions,
        regions_warning: warning,
    })
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    id: String,
    engine: String,
    version: String,
    status: String,
    host: String,
    port: u16,
    database: String,
    username: String,
    public: bool,
    supported: bool,
}
fn instances(value: Value) -> Result<Vec<Instance>, String> {
    let rows = value["DBInstances"]
        .as_array()
        .ok_or("AWS_INVALID_RESPONSE")?;
    let mut result = rows
        .iter()
        .map(|row| {
            let text = |key: &str| row[key].as_str().unwrap_or("").to_owned();
            let engine = text("Engine");
            Instance {
                id: text("DBInstanceIdentifier"),
                supported: matches!(
                    engine.as_str(),
                    "postgres" | "mysql" | "mariadb" | "aurora-postgresql" | "aurora-mysql"
                ),
                engine,
                version: text("EngineVersion"),
                status: text("DBInstanceStatus"),
                host: row["Endpoint"]["Address"].as_str().unwrap_or("").into(),
                port: row["Endpoint"]["Port"]
                    .as_u64()
                    .and_then(|n| u16::try_from(n).ok())
                    .unwrap_or(0),
                database: text("DBName"),
                username: text("MasterUsername"),
                public: row["PubliclyAccessible"].as_bool().unwrap_or(false),
            }
        })
        .collect::<Vec<_>>();
    result.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(result)
}
#[tauri::command]
pub async fn aws_rds_instances(profile: String, region: String) -> Result<Vec<Instance>, String> {
    validate(&profile)?;
    validate(&region)?;
    if !region
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("AWS_INVALID_SELECTION".into());
    }
    // CLI auto-pagination stays enabled. Return only non-secret connection metadata.
    instances(
        json(&[
            "rds",
            "describe-db-instances",
            "--profile",
            &profile,
            "--region",
            &region,
        ])
        .await?,
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_supported_engines_and_missing_endpoints() {
        let rows=instances(serde_json::json!({"DBInstances":[{"DBInstanceIdentifier":"a","Engine":"aurora-postgresql","Endpoint":{"Address":"example.rds.amazonaws.com","Port":5432}},{"DBInstanceIdentifier":"b","Engine":"oracle-ee"}]})).unwrap();
        assert!(rows[0].supported);
        assert_eq!(rows[0].port, 5432);
        assert!(!rows[1].supported);
        assert!(rows[1].host.is_empty());
    }
    #[test]
    fn rejects_flags_and_sanitizes_errors() {
        assert!(validate("--debug").is_err());
        assert!(validate("x\ny").is_err());
        assert!(validate("team production").is_ok());
        assert_eq!(
            failure("ExpiredToken: sensitive details"),
            "AWS_AUTH_REQUIRED"
        );
        assert_eq!(failure("AccessDeniedException"), "AWS_ACCESS_DENIED");
    }
    #[tokio::test]
    #[ignore = "requires a configured local AWS CLI; reads metadata only"]
    async fn local_aws_discovery() {
        let info = aws_cli_info().await.unwrap();
        assert!(info.installed);
        let profile = std::env::var("WOOJOO_TEST_AWS_PROFILE").unwrap_or_else(|_| "default".into());
        assert!(info.profiles.contains(&profile));
        let env = aws_environment(profile.clone()).await.unwrap();
        assert!(!env.account.is_empty());
        let _ = aws_rds_instances(profile, env.region).await.unwrap();
    }
}
