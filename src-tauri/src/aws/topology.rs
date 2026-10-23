//! Fixed read-only queries that feed the infrastructure map.
use super::cli::{paged, run_owned, scoped};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TopologyKind {
    Vpcs,
    Subnets,
    Instances,
    Databases,
    LoadBalancers,
    TargetGroups,
    Buckets,
    Targets,
    LbAttributes,
    BucketLocation,
    BucketNotifications,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyQuery {
    profile: String,
    region: String,
    kind: TopologyKind,
    resource: Option<String>,
    next_token: Option<String>,
    request: Option<String>,
}

fn arguments(q: &TopologyQuery) -> Result<Vec<String>, String> {
    use TopologyKind::*;
    let (service, operation, parameter) = match q.kind {
        Vpcs => ("ec2", "describe-vpcs", None),
        Subnets => ("ec2", "describe-subnets", None),
        Instances => ("ec2", "describe-instances", None),
        Databases => ("rds", "describe-db-instances", None),
        LoadBalancers => ("elbv2", "describe-load-balancers", None),
        TargetGroups => ("elbv2", "describe-target-groups", None),
        Buckets => ("s3api", "list-buckets", None),
        Targets => ("elbv2", "describe-target-health", Some("TargetGroupArn")),
        LbAttributes => ("elbv2", "describe-load-balancer-attributes", Some("LoadBalancerArn")),
        BucketLocation => ("s3api", "get-bucket-location", Some("Bucket")),
        BucketNotifications => ("s3api", "get-bucket-notification-configuration", Some("Bucket")),
    };
    let args = scoped(service, operation, &q.profile, &q.region)?;
    let Some(key) = parameter else {
        return paged(args, q.next_token.as_deref());
    };
    let resource = q.resource.as_deref().ok_or("AWS_INVALID_SELECTION")?;
    if resource.is_empty() || resource.len() > 2048 || resource.chars().any(char::is_control) || q.next_token.is_some() {
        return Err("AWS_INVALID_SELECTION".into());
    }
    let mut args = args;
    args.extend(["--cli-input-json".into(), json!({ key: resource }).to_string()]);
    Ok(args)
}
fn parse_response(kind: TopologyKind, raw: &str) -> Result<Value, String> {
    // The CLI prints nothing for an empty S3 notification configuration.
    if kind == TopologyKind::BucketNotifications && raw.trim().is_empty() {
        return Ok(json!({}));
    }
    super::cli::parse(raw)
}
#[tauri::command]
pub async fn aws_topology_query(query: TopologyQuery) -> Result<Value, String> {
    let raw = run_owned(arguments(&query)?, query.request.as_deref()).await?;
    parse_response(query.kind, &raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn query(kind: TopologyKind) -> TopologyQuery {
        TopologyQuery { profile: "test".into(), region: "ap-northeast-2".into(), kind, resource: None, next_token: None, request: None }
    }
    #[test]
    fn only_fixed_read_operations_are_allowed() {
        assert!(serde_json::from_value::<TopologyQuery>(json!({"profile":"a","region":"b","kind":"terminateInstances"})).is_err());
        assert_eq!(parse_response(TopologyKind::BucketNotifications, "").unwrap(), json!({}));
        assert!(parse_response(TopologyKind::Vpcs, "").is_err());
        for kind in [TopologyKind::Vpcs, TopologyKind::Subnets, TopologyKind::Instances, TopologyKind::Databases, TopologyKind::LoadBalancers, TopologyKind::TargetGroups, TopologyKind::Buckets] {
            let args = arguments(&query(kind)).unwrap();
            assert!(args[1].starts_with("describe-") || args[1] == "list-buckets");
            assert!(args.contains(&"--max-items".into()));
        }
    }
    #[test]
    fn resources_are_json_values_not_cli_arguments() {
        let mut q = query(TopologyKind::Targets);
        assert!(arguments(&q).is_err());
        q.resource = Some("--endpoint-url=bad".into());
        let args = arguments(&q).unwrap();
        let input: Value = serde_json::from_str(args.last().unwrap()).unwrap();
        assert_eq!(input["TargetGroupArn"], "--endpoint-url=bad");
        assert!(!args.contains(&"--max-items".into()));
        q.next_token = Some("cursor".into());
        assert!(arguments(&q).is_err());
    }
}
