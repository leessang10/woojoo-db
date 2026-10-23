//! Read-only resource lists and S3/CloudWatch Logs browsing for the AWS work area.
use super::cli::{paged, parse, run_owned, scoped};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Service {
    Ec2,
    Rds,
    S3,
    Logs,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    service: Service,
    profile: String,
    region: String,
    next_token: Option<String>,
    request: Option<String>,
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    rows: Vec<Value>,
    next_token: Option<String>,
}

fn list_args(q: &ListQuery) -> Result<Vec<String>, String> {
    let (service, operation) = match q.service {
        Service::Ec2 => ("ec2", "describe-instances"),
        Service::Rds => ("rds", "describe-db-instances"),
        Service::S3 => ("s3api", "list-buckets"),
        Service::Logs => ("logs", "describe-log-groups"),
    };
    paged(scoped(service, operation, &q.profile, &q.region)?, q.next_token.as_deref())
}
fn list_page(service: Service, value: Value) -> Page {
    let rows = match service {
        // Instances arrive grouped by reservation; the list shows one row per instance.
        Service::Ec2 => value["Reservations"]
            .as_array()
            .map(|reservations| {
                reservations
                    .iter()
                    .flat_map(|r| r["Instances"].as_array().cloned().unwrap_or_default())
                    .collect()
            })
            .unwrap_or_default(),
        Service::Rds => value["DBInstances"].as_array().cloned().unwrap_or_default(),
        Service::S3 => value["Buckets"].as_array().cloned().unwrap_or_default(),
        Service::Logs => value["logGroups"].as_array().cloned().unwrap_or_default(),
    };
    Page {
        rows,
        next_token: value["NextToken"].as_str().map(str::to_owned),
    }
}
#[tauri::command]
pub async fn aws_list_resources(query: ListQuery) -> Result<Page, String> {
    let raw = run_owned(list_args(&query)?, query.request.as_deref()).await?;
    Ok(list_page(query.service, parse(&raw)?))
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BrowseKind {
    Objects,
    Events,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseQuery {
    profile: String,
    region: String,
    kind: BrowseKind,
    resource: String,
    prefix: Option<String>,
    next_token: Option<String>,
    start_time: Option<i64>,
    end_time: Option<i64>,
    pattern: Option<String>,
    request: Option<String>,
}
fn browse_args(q: &BrowseQuery) -> Result<Vec<String>, String> {
    let invalid = || "AWS_INVALID_SELECTION".to_string();
    if q.resource.is_empty() || q.resource.len() > 1024 || q.resource.chars().any(char::is_control) {
        return Err(invalid());
    }
    if q.next_token.as_ref().is_some_and(|t| t.is_empty() || t.len() > 16384) {
        return Err(invalid());
    }
    // Names and prefixes travel inside JSON, never as CLI arguments.
    let (mut args, mut input) = match q.kind {
        BrowseKind::Objects => {
            let prefix = q.prefix.as_deref().unwrap_or("");
            if prefix.len() > 1024 {
                return Err(invalid());
            }
            let mut input = json!({"Bucket": q.resource, "Prefix": prefix, "Delimiter": "/", "MaxKeys": 100});
            if let Some(token) = &q.next_token {
                input["ContinuationToken"] = json!(token);
            }
            (scoped("s3api", "list-objects-v2", &q.profile, &q.region)?, input)
        }
        BrowseKind::Events => {
            let start = q.start_time.ok_or_else(invalid)?;
            let end = q.end_time.ok_or_else(invalid)?;
            if start < 0 || end <= start || end - start > 31 * 86_400_000 {
                return Err(invalid());
            }
            let mut input = json!({"logGroupName": q.resource, "startTime": start, "endTime": end, "limit": 100});
            if let Some(token) = &q.next_token {
                input["nextToken"] = json!(token);
            }
            match q.pattern.as_deref() {
                Some(pattern) if pattern.len() > 1024 => return Err(invalid()),
                Some(pattern) if !pattern.trim().is_empty() => input["filterPattern"] = json!(pattern),
                _ => {}
            }
            (scoped("logs", "filter-log-events", &q.profile, &q.region)?, input)
        }
    };
    // One native service page, including empty pages that still carry a token.
    args.extend(["--no-paginate".into(), "--cli-input-json".into(), input.take().to_string()]);
    Ok(args)
}
fn browse_page(kind: BrowseKind, value: Value) -> Page {
    let (rows, token) = match kind {
        BrowseKind::Objects => {
            let folders = value["CommonPrefixes"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|p| json!({"kind": "folder", "Prefix": p["Prefix"]}));
            let files = value["Contents"].as_array().into_iter().flatten().map(|o| {
                let mut row = o.clone();
                row["kind"] = json!("file");
                row
            });
            (folders.chain(files).collect(), "NextContinuationToken")
        }
        BrowseKind::Events => (value["events"].as_array().cloned().unwrap_or_default(), "nextToken"),
    };
    Page {
        rows,
        next_token: value[token].as_str().map(str::to_owned),
    }
}
#[tauri::command]
pub async fn aws_browse_resources(query: BrowseQuery) -> Result<Page, String> {
    let raw = run_owned(browse_args(&query)?, query.request.as_deref()).await?;
    Ok(browse_page(query.kind, parse(&raw)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn list(service: Service) -> ListQuery {
        ListQuery { service, profile: "dev team".into(), region: "ap-northeast-2".into(), next_token: None, request: None }
    }
    fn browse(kind: BrowseKind) -> BrowseQuery {
        BrowseQuery {
            profile: "default".into(),
            region: "ap-northeast-2".into(),
            kind,
            resource: "test-bucket".into(),
            prefix: Some("한글 /a&b/".into()),
            next_token: Some("opaque/+==".into()),
            start_time: Some(1000),
            end_time: Some(2000),
            pattern: Some("\"error\"".into()),
            request: None,
        }
    }
    #[test]
    fn unknown_services_are_rejected_when_parsing() {
        assert!(serde_json::from_value::<ListQuery>(json!({"service":"terminate-instances","profile":"a","region":"b"})).is_err());
        let mut q = list(Service::Ec2);
        q.region = "--endpoint-url=http://example.com".into();
        assert!(list_args(&q).is_err());
    }
    #[test]
    fn flattens_ec2_reservations_and_preserves_pagination() {
        let page = list_page(
            Service::Ec2,
            json!({"Reservations":[{"Instances":[{"InstanceId":"i-1"}]},{"Instances":[{"InstanceId":"i-2"}]}],"NextToken":"next"}),
        );
        assert_eq!(page.rows.len(), 2);
        assert_eq!(page.next_token.as_deref(), Some("next"));
        assert!(list_args(&list(Service::S3)).unwrap().contains(&"list-buckets".to_string()));
    }
    #[test]
    fn s3_prefixes_stay_inside_json_and_keep_unicode() {
        let args = browse_args(&browse(BrowseKind::Objects)).unwrap();
        assert_eq!(args[args.len() - 2], "--cli-input-json");
        let input: Value = serde_json::from_str(args.last().unwrap()).unwrap();
        assert_eq!(input["Prefix"], "한글 /a&b/");
        assert_eq!(input["ContinuationToken"], "opaque/+==");
        let page = browse_page(
            BrowseKind::Objects,
            json!({"CommonPrefixes":[{"Prefix":"folder/"}],"Contents":[{"Key":"test.txt","Size":1}],"NextContinuationToken":"next"}),
        );
        assert_eq!(page.rows.len(), 2);
        assert_eq!(page.rows[0]["kind"], "folder");
        assert_eq!(page.next_token.as_deref(), Some("next"));
    }
    #[test]
    fn log_ranges_are_bounded_and_empty_pages_can_continue() {
        let page = browse_page(BrowseKind::Events, json!({"events":[],"nextToken":"more"}));
        assert!(page.rows.is_empty());
        assert_eq!(page.next_token.as_deref(), Some("more"));
        let mut q = browse(BrowseKind::Events);
        q.end_time = Some(32 * 86_400_000);
        assert!(browse_args(&q).is_err());
        q.end_time = Some(500);
        assert!(browse_args(&q).is_err());
    }
    #[tokio::test]
    #[ignore = "requires WOOJOO_TEST_AWS_PROFILE and WOOJOO_TEST_AWS_REGION; read-only"]
    async fn live_readonly_lists() {
        let profile = std::env::var("WOOJOO_TEST_AWS_PROFILE").expect("WOOJOO_TEST_AWS_PROFILE");
        let region = std::env::var("WOOJOO_TEST_AWS_REGION").unwrap_or("ap-northeast-2".into());
        for service in [Service::Ec2, Service::Rds, Service::S3, Service::Logs] {
            let page = aws_list_resources(ListQuery { service, profile: profile.clone(), region: region.clone(), next_token: None, request: None })
                .await
                .unwrap();
            println!("{service:?}: {} rows", page.rows.len());
        }
    }
}
