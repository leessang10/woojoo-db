pub mod cli;
pub mod logs;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{LazyLock, Mutex},
};

fn string(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}
fn project(v: &Value) -> String {
    string(&v["com.docker.compose.project"])
}
fn array(v: Value) -> Result<Vec<Value>, String> {
    v.as_array()
        .cloned()
        .ok_or_else(|| "DOCKER_INVALID_RESPONSE".into())
}
fn parse(raw: &str) -> Result<Value, String> {
    serde_json::from_str(raw).map_err(|_| "DOCKER_INVALID_RESPONSE".into())
}

// Whitelist fields here: Config.Env, secrets and full inspect payloads never cross IPC.
pub fn container(v: &Value) -> Value {
    let mut ports = Vec::new();
    let bindings = v["NetworkSettings"]["Ports"].as_object();
    let mut keys = HashSet::new();
    if let Some(p) = v["Config"]["ExposedPorts"].as_object() {
        keys.extend(p.keys().cloned());
    }
    if let Some(p) = bindings {
        keys.extend(p.keys().cloned());
    }
    let mut keys: Vec<_> = keys.into_iter().collect();
    keys.sort();
    for key in keys {
        let entries = bindings.and_then(|b| b.get(&key)).and_then(Value::as_array);
        if let Some(entries) = entries.filter(|e| !e.is_empty()) {
            for p in entries {
                ports.push(json!({"privatePort":key,"hostIp":string(&p["HostIp"]),"hostPort":string(&p["HostPort"])}));
            }
        } else {
            ports.push(json!({"privatePort":key,"hostIp":"","hostPort":""}));
        }
    }
    let mut mounts: Vec<_> = v["Mounts"].as_array().into_iter().flatten().map(|m| json!({"kind":string(&m["Type"]),"name":string(&m["Name"]),"source":string(&m["Source"]),"target":string(&m["Destination"]),"rw":m["RW"].as_bool().unwrap_or(false)})).collect();
    if let Some(tmpfs) = v["HostConfig"]["Tmpfs"].as_object() {
        for (target, options) in tmpfs {
            if !mounts.iter().any(|m| m["target"].as_str() == Some(target)) {
                mounts.push(json!({"kind":"tmpfs","name":"","source":"","target":target,"rw":!options.as_str().unwrap_or("").split(',').any(|o|o=="ro")}));
            }
        }
    }
    let networks: Vec<_> = v["NetworkSettings"]["Networks"].as_object().into_iter().flatten().map(|(name,n)| json!({"id":string(&n["NetworkID"]),"name":name,"ip":string(&n["IPAddress"])})).collect();
    let health_output = v["State"]["Health"]["Log"]
        .as_array()
        .and_then(|a| a.last())
        .map(|l| string(&l["Output"]))
        .unwrap_or_default();
    json!({"id":string(&v["Id"]),"name":string(&v["Name"]).trim_start_matches('/'),"imageId":string(&v["Image"]),"image":string(&v["Config"]["Image"]),
        "project":project(&v["Config"]["Labels"]),"service":string(&v["Config"]["Labels"]["com.docker.compose.service"]),
        "state":string(&v["State"]["Status"]),"health":string(&v["State"]["Health"]["Status"]),"exitCode":v["State"]["ExitCode"].as_i64().unwrap_or(0),
        "oom":v["State"]["OOMKilled"].as_bool().unwrap_or(false),"error":string(&v["State"]["Error"]),"finishedAt":string(&v["State"]["FinishedAt"]),
        "restartCount":v["RestartCount"].as_u64().unwrap_or(0),"networkMode":string(&v["HostConfig"]["NetworkMode"]),"healthOutput":health_output.chars().take(4000).collect::<String>(),
        "ports":ports,"mounts":mounts,"networks":networks})
}

#[tauri::command]
pub async fn docker_contexts() -> Result<Value, String> {
    let raw = cli::run(None, &["context", "ls", "--format", "{{json .}}"], 15).await?;
    let mut list = Vec::new();
    for line in raw.lines().filter(|l| !l.trim().is_empty()) {
        let v = parse(line)?;
        list.push(json!({"name":string(&v["Name"]),"endpoint":string(&v["DockerEndpoint"]),"current":v["Current"].as_bool().unwrap_or(false)}));
    }
    Ok(json!(list))
}

async fn inspect_many(
    context: &str,
    kind: &str,
    ids: &[String],
    warnings: &mut Vec<String>,
) -> Result<Vec<Value>, String> {
    let mut result = Vec::new();
    for batch in ids.chunks(40) {
        let mut args = vec![kind, "inspect"];
        args.extend(batch.iter().map(String::as_str));
        match cli::run(Some(context), &args, 20).await {
            Ok(raw) => result.extend(array(parse(&raw)?)?),
            // A resource can disappear between listing and inspect; retain the other batches and label incomplete.
            Err(e) => warnings.push(format!("{kind}: {e}")),
        }
    }
    Ok(result)
}
async fn ids(context: &str, args: &[&str]) -> Result<Vec<String>, String> {
    Ok(cli::run(Some(context), args, 20)
        .await?
        .lines()
        .filter(|s| !s.is_empty())
        .take(2001)
        .map(str::to_owned)
        .collect())
}

#[tauri::command]
pub async fn docker_snapshot(context: String, resources: bool) -> Result<Value, String> {
    tokio::time::timeout(
        std::time::Duration::from_secs(60),
        snapshot(context, resources),
    )
    .await
    .map_err(|_| "DOCKER_TIMEOUT: snapshot exceeded 60 seconds".to_owned())?
}
async fn snapshot(context: String, resources: bool) -> Result<Value, String> {
    cli::validate(&context)?;
    let mut warnings = Vec::new();
    let mut container_ids = ids(
        &context,
        &["container", "ls", "--all", "--quiet", "--no-trunc"],
    )
    .await?;
    if container_ids.len() > 2000 {
        warnings.push("DOCKER_RESOURCE_LIMIT: containers > 2000".into());
        container_ids.truncate(2000);
    }
    let containers: Vec<_> = inspect_many(&context, "container", &container_ids, &mut warnings)
        .await?
        .iter()
        .map(container)
        .collect();
    let mut images = Vec::new();
    let mut volumes = Vec::new();
    let mut networks = Vec::new();
    if resources {
        match cli::run(
            Some(&context),
            &[
                "image",
                "ls",
                "--all",
                "--no-trunc",
                "--format",
                "{{json .}}",
            ],
            20,
        )
        .await
        {
            Ok(raw) => {
                let mut seen = HashSet::new();
                for line in raw.lines().take(2000) {
                    let v = parse(line)?;
                    let id = string(&v["ID"]);
                    if seen.insert(id.clone()) {
                        images.push(json!({"id":id,"name":format!("{}:{}",string(&v["Repository"]),string(&v["Tag"])),"project":"","detail":string(&v["Size"])}));
                    }
                }
                if raw.lines().count() > 2000 {
                    warnings.push("DOCKER_RESOURCE_LIMIT: images > 2000".into());
                }
            }
            Err(e) => warnings.push(e),
        }
        for kind in ["volume", "network"] {
            match ids(&context, &[kind, "ls", "--quiet"]).await {
                Ok(mut ids) => {
                    if ids.len() > 2000 {
                        warnings.push(format!("DOCKER_RESOURCE_LIMIT: {kind} > 2000"));
                        ids.truncate(2000);
                    }
                    for v in inspect_many(&context, kind, &ids, &mut warnings).await? {
                        let name = string(&v["Name"]);
                        let id = if kind == "volume" {
                            name.clone()
                        } else {
                            string(&v["Id"])
                        };
                        let r = json!({"id":id,"name":name,"project":project(&v["Labels"]),"detail":if kind=="volume" {string(&v["Mountpoint"])} else {string(&v["Driver"])}});
                        if kind == "volume" {
                            volumes.push(r);
                        } else {
                            networks.push(r);
                        }
                    }
                }
                Err(e) => warnings.push(e),
            }
        }
    }
    Ok(
        json!({"context":context,"containers":containers,"images":images,"volumes":volumes,"networks":networks,"complete":warnings.is_empty(),"warnings":warnings}),
    )
}

static ACTIONS: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
struct ActionGuard(String);
impl Drop for ActionGuard {
    fn drop(&mut self) {
        if let Ok(mut locks) = ACTIONS.lock() {
            locks.remove(&self.0);
        }
    }
}
#[tauri::command]
pub async fn docker_action(context: String, id: String, action: String) -> Result<(), String> {
    cli::validate(&context)?;
    cli::id(&id)?;
    if !["start", "stop", "restart"].contains(&action.as_str()) {
        return Err("DOCKER_INVALID_ACTION".into());
    }
    let key = format!("{context}:{id}");
    if !ACTIONS
        .lock()
        .map_err(|_| "DOCKER_BUSY")?
        .insert(key.clone())
    {
        return Err("DOCKER_BUSY".into());
    }
    let _guard = ActionGuard(key);
    cli::run(Some(&context), &["container", &action, &id], 45).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inspect_is_sanitized_and_exposed_ports_are_not_published() {
        let v = json!({"Id":"id","Name":"/db","Config":{"Env":["SECRET=shh"],"ExposedPorts":{"80/tcp":{}},"Labels":{"com.docker.compose.project":"app"}},"NetworkSettings":{"Ports":{"5432/tcp":[{"HostIp":"::","HostPort":"15432"}]}},"State":{"Status":"running"},"Mounts":[{"Type":"bind","Source":"/host","Destination":"/app","RW":false}]});
        let c = container(&v);
        assert_eq!(c["name"], "db");
        assert_eq!(c["health"], "");
        assert_eq!(c["project"], "app");
        assert!(!c.to_string().contains("SECRET"));
        assert_eq!(c["ports"].as_array().unwrap().len(), 2);
        assert!(c["ports"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["privatePort"] == "80/tcp" && p["hostPort"] == ""));
        assert_eq!(c["mounts"][0]["rw"], false);
    }
    #[test]
    fn tmpfs_from_host_config_is_ephemeral_and_preserves_readonly() {
        let c = container(&json!({"HostConfig":{"Tmpfs":{"/cache":"ro,size=64m"}}}));
        assert_eq!(c["mounts"][0]["kind"], "tmpfs");
        assert_eq!(c["mounts"][0]["target"], "/cache");
        assert_eq!(c["mounts"][0]["rw"], false);
    }
}
