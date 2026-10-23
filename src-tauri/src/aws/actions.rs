//! Resource changes from a fixed allowlist. Each change is prepared first (the exact command
//! and the account it targets are shown), then run only with a typed confirmation phrase.
use super::cli::{parse, run_owned, run_write, scoped, validate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Ec2Start,
    Ec2Stop,
    Ec2Reboot,
    Ec2Terminate,
    Ec2Rename,
    RdsStart,
    RdsStop,
    RdsReboot,
    RdsSnapshot,
    S3Versioning,
    LogsRetention,
    LogsRetainForever,
    LogsDelete,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionQuery {
    profile: String,
    region: String,
    action: Action,
    resource: String,
    value: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    review: String,
    account: String,
    phrase: String,
    command: String,
}
struct Pending {
    args: Vec<String>,
    profile: String,
    region: String,
    account: String,
    phrase: String,
    created: Instant,
}
static PENDING: LazyLock<Mutex<HashMap<String, Pending>>> = LazyLock::new(Default::default);
const REVIEW_TTL: Duration = Duration::from_secs(300);
const RETENTION_DAYS: [u32; 22] = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653];

fn invalid() -> String {
    "AWS_INVALID_SELECTION".into()
}
/// Builds the CLI call; names and values travel inside JSON, never as flags.
fn arguments(q: &ActionQuery) -> Result<Vec<String>, String> {
    use Action::*;
    let id = q.resource.as_str();
    if id.is_empty() || id.len() > 1024 || id.chars().any(char::is_control) {
        return Err(invalid());
    }
    let value = q.value.as_deref().unwrap_or("");
    let (service, operation, input) = match q.action {
        Ec2Start => ("ec2", "start-instances", json!({"InstanceIds": [id]})),
        Ec2Stop => ("ec2", "stop-instances", json!({"InstanceIds": [id]})),
        Ec2Reboot => ("ec2", "reboot-instances", json!({"InstanceIds": [id]})),
        Ec2Terminate => ("ec2", "terminate-instances", json!({"InstanceIds": [id]})),
        Ec2Rename => {
            if value.trim().is_empty() || value.chars().count() > 256 || value.chars().any(char::is_control) {
                return Err(invalid());
            }
            ("ec2", "create-tags", json!({"Resources": [id], "Tags": [{"Key": "Name", "Value": value}]}))
        }
        RdsStart => ("rds", "start-db-instance", json!({"DBInstanceIdentifier": id})),
        RdsStop => ("rds", "stop-db-instance", json!({"DBInstanceIdentifier": id})),
        RdsReboot => ("rds", "reboot-db-instance", json!({"DBInstanceIdentifier": id})),
        RdsSnapshot => {
            let valid = value.len() <= 255
                && value.starts_with(|c: char| c.is_ascii_alphabetic())
                && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !value.ends_with('-')
                && !value.contains("--");
            if !valid {
                return Err(invalid());
            }
            ("rds", "create-db-snapshot", json!({"DBInstanceIdentifier": id, "DBSnapshotIdentifier": value}))
        }
        S3Versioning => {
            if value != "Enabled" && value != "Suspended" {
                return Err(invalid());
            }
            ("s3api", "put-bucket-versioning", json!({"Bucket": id, "VersioningConfiguration": {"Status": value}}))
        }
        LogsRetention => {
            let days: u32 = value.parse().map_err(|_| invalid())?;
            if !RETENTION_DAYS.contains(&days) {
                return Err(invalid());
            }
            ("logs", "put-retention-policy", json!({"logGroupName": id, "retentionInDays": days}))
        }
        LogsRetainForever => ("logs", "delete-retention-policy", json!({"logGroupName": id})),
        LogsDelete => ("logs", "delete-log-group", json!({"logGroupName": id})),
    };
    let mut args = scoped(service, operation, &q.profile, &q.region)?;
    args.extend(["--cli-input-json".into(), input.to_string()]);
    Ok(args)
}
async fn account(profile: &str, region: &str) -> Result<String, String> {
    let raw = run_owned(scoped("sts", "get-caller-identity", profile, region)?, None).await?;
    parse(&raw)?["Account"]
        .as_str()
        .filter(|a| !a.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "AWS_INVALID_RESPONSE".into())
}
/// What the review dialog shows: the operation and its JSON input, without profile flags.
fn display(args: &[String]) -> String {
    format!("aws {} {} --cli-input-json '{}'", args[0], args[1], args.last().map(String::as_str).unwrap_or(""))
}

/// Off until Settings turns AWS changes on; checked again before a reviewed change runs.
static ENABLED: AtomicBool = AtomicBool::new(false);
#[tauri::command]
pub fn aws_set_actions_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
    if !enabled {
        PENDING.lock().unwrap().clear();
    }
}
fn ensure_enabled() -> Result<(), String> {
    if ENABLED.load(Ordering::SeqCst) { Ok(()) } else { Err("AWS_ACTIONS_DISABLED".into()) }
}

#[tauri::command]
pub async fn aws_prepare_action(query: ActionQuery) -> Result<Review, String> {
    ensure_enabled()?;
    validate(&query.profile)?;
    let args = arguments(&query)?;
    let account = account(&query.profile, &query.region).await?;
    // Typing the resource name confirms which resource changes; the review names the account.
    let phrase = query.resource.clone();
    let review = uuid::Uuid::new_v4().to_string();
    let mut pending = PENDING.lock().unwrap();
    pending.retain(|_, p| p.created.elapsed() < REVIEW_TTL);
    if pending.len() >= 16 {
        return Err("AWS_BUSY".into());
    }
    let command = display(&args);
    pending.insert(review.clone(), Pending { args, profile: query.profile, region: query.region, account: account.clone(), phrase: phrase.clone(), created: Instant::now() });
    Ok(Review { review, account, phrase, command })
}
fn take(review: &str, confirmation: &str) -> Result<Pending, String> {
    let mut pending = PENDING.lock().unwrap();
    let item = pending.get(review).ok_or("AWS_REVIEW_EXPIRED")?;
    if item.created.elapsed() >= REVIEW_TTL {
        pending.remove(review);
        return Err("AWS_REVIEW_EXPIRED".into());
    }
    if item.phrase != confirmation {
        return Err("AWS_CONFIRMATION_MISMATCH".into());
    }
    Ok(pending.remove(review).unwrap())
}
#[tauri::command]
pub async fn aws_run_action(review: String, confirmation: String) -> Result<Value, String> {
    ensure_enabled()?;
    let item = take(&review, &confirmation)?;
    // The profile may have switched accounts (SSO, role) since the review; never write elsewhere.
    if account(&item.profile, &item.region).await? != item.account {
        return Err("AWS_ACCOUNT_CHANGED".into());
    }
    let raw = run_write(item.args).await?;
    if raw.trim().is_empty() {
        return Ok(json!({}));
    }
    parse(&raw)
}
#[tauri::command]
pub fn aws_cancel_action(review: String) {
    PENDING.lock().unwrap().remove(&review);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn query(action: Action, resource: &str, value: Option<&str>) -> ActionQuery {
        ActionQuery { profile: "dev".into(), region: "ap-northeast-2".into(), action, resource: resource.into(), value: value.map(str::to_owned) }
    }
    #[test]
    fn only_allowlisted_actions_parse() {
        assert!(serde_json::from_value::<ActionQuery>(json!({"profile":"a","region":"b","action":"deleteBucket","resource":"x"})).is_err());
        assert!(serde_json::from_value::<ActionQuery>(json!({"profile":"a","region":"b","action":"ec2Stop","resource":"i-1"})).is_ok());
    }
    #[test]
    fn values_are_validated_and_stay_inside_json() {
        assert!(arguments(&query(Action::RdsSnapshot, "db", Some("bad--name"))).is_err());
        assert!(arguments(&query(Action::RdsSnapshot, "db", Some("1abc"))).is_err());
        assert!(arguments(&query(Action::LogsRetention, "/g", Some("2"))).is_err());
        assert!(arguments(&query(Action::S3Versioning, "b", Some("Off"))).is_err());
        let args = arguments(&query(Action::Ec2Rename, "--endpoint-url=x", Some("web 1"))).unwrap();
        assert_eq!(&args[..2], ["ec2", "create-tags"]);
        let input: Value = serde_json::from_str(args.last().unwrap()).unwrap();
        assert_eq!(input["Resources"][0], "--endpoint-url=x");
        assert_eq!(input["Tags"][0]["Value"], "web 1");
        let args = arguments(&query(Action::LogsRetention, "/aws/lambda/x", Some("30"))).unwrap();
        assert!(display(&args).starts_with("aws logs put-retention-policy"));
    }
    #[tokio::test]
    async fn changes_are_refused_while_disabled() {
        // Off by default; the setter is not called so other tests' reviews are left alone.
        let error = aws_prepare_action(query(Action::Ec2Stop, "i-1", None)).await.err().unwrap();
        assert_eq!(error, "AWS_ACTIONS_DISABLED");
        assert_eq!(aws_run_action("x".into(), "i-1".into()).await.err().unwrap(), "AWS_ACTIONS_DISABLED");
    }
    #[test]
    fn reviews_need_the_exact_phrase_and_are_single_use() {
        let id = "test-review".to_string();
        PENDING.lock().unwrap().insert(id.clone(), Pending { args: vec![], profile: "p".into(), region: "r".into(), account: "1".into(), phrase: "i-1".into(), created: Instant::now() });
        assert_eq!(take(&id, "i-2").err().unwrap(), "AWS_CONFIRMATION_MISMATCH");
        assert!(take(&id, "i-1").is_ok());
        assert_eq!(take(&id, "i-1").err().unwrap(), "AWS_REVIEW_EXPIRED");
    }
}
