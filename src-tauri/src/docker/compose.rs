use super::cli;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::LazyLock,
};
use tauri::Manager;
use tokio::sync::Mutex;

static LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
const MAX_SOURCE: usize = 2 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
pub struct Project {
    id: String,
    context: String,
    name: String,
    path: String,
}
fn store(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("compose-projects.json"))
}
fn list(app: &tauri::AppHandle) -> Result<Vec<Project>, String> {
    let path = store(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
fn persist(app: &tauri::AppHandle, projects: &[Project]) -> Result<(), String> {
    let path = store(app)?;
    std::fs::create_dir_all(path.parent().ok_or("Invalid storage path")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        &path,
        &serde_json::to_vec_pretty(projects).map_err(|e| e.to_string())?,
    )
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let temp = Draft(path.with_file_name(format!(".woojoo-save-{}", uuid::Uuid::new_v4())));
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp.0)
        .map_err(|e| e.to_string())?;
    if let Ok(metadata) = path.metadata() {
        file.set_permissions(metadata.permissions())
            .map_err(|e| e.to_string())?;
    }
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(&temp.0, path).map_err(|e| e.to_string())
}
fn project(app: &tauri::AppHandle, id: &str) -> Result<Project, String> {
    list(app)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or("Compose project not found".into())
}
fn read(path: &Path) -> Result<String, String> {
    if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_SOURCE as u64 {
        return Err("Compose file exceeds 2 MiB".into());
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}
fn document(p: &Project) -> Result<Value, String> {
    Ok(json!({"project":p,"source":read(Path::new(&p.path))?}))
}
fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 128
        || !name
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        || !name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
    {
        return Err("Invalid Compose project name".into());
    }
    Ok(())
}
fn token(source: &str, model: &Value) -> String {
    let mut h = DefaultHasher::new();
    source.hash(&mut h);
    model.to_string().hash(&mut h);
    format!("{:x}", h.finish())
}
fn args(p: &Project, file: &str, tail: &[&str]) -> Result<Vec<String>, String> {
    cli::validate(&p.context)?;
    check_name(&p.name)?;
    let directory = Path::new(&p.path)
        .parent()
        .ok_or("Compose parent directory missing")?;
    let mut args = vec![
        "compose".into(),
        "--ansi".into(),
        "never".into(),
        "--project-directory".into(),
        directory.to_string_lossy().into_owned(),
        "--project-name".into(),
        p.name.clone(),
        "--file".into(),
        file.into(),
    ];
    args.extend(tail.iter().map(|s| s.to_string()));
    Ok(args)
}
async fn run(p: &Project, file: &str, tail: &[&str], seconds: u64) -> Result<String, String> {
    let _operation = super::storage::operation().await?;
    let args = args(p, file, tail)?;
    let refs: Vec<_> = args.iter().map(String::as_str).collect();
    let mut command = cli::command(Some(&p.context), &refs)?;
    command.current_dir(
        Path::new(&p.path)
            .parent()
            .ok_or("Compose parent directory missing")?,
    );
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("COMPOSE_") {
            command.env_remove(key);
        }
    }
    // Explicit values also override operational switches loaded from project .env.
    command
        .env("COMPOSE_REMOVE_ORPHANS", "false")
        .env("COMPOSE_PROFILES", "")
        .env("COMPOSE_IGNORE_ORPHANS", "false");
    cli::execute(
        command,
        std::time::Duration::from_secs(seconds),
        16 * 1024 * 1024,
    )
    .await
}
struct Draft(PathBuf);
impl Drop for Draft {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
async fn model(p: &Project, source: &str) -> Result<Value, String> {
    if source.len() > MAX_SOURCE {
        return Err("Compose file exceeds 2 MiB".into());
    }
    let folder = Path::new(&p.path)
        .parent()
        .ok_or("Compose parent directory missing")?;
    let draft = Draft(folder.join(format!(".woojoo-{}.compose.yml", uuid::Uuid::new_v4())));
    // Same directory and explicit project-directory preserve relative build/bind/env paths.
    {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&draft.0)
            .map_err(|e| e.to_string())?;
        file.write_all(source.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let output = run(
        p,
        &draft.0.to_string_lossy(),
        &["--profile", "*", "config", "--format", "json"],
        30,
    )
    .await?;
    serde_json::from_str(&output).map_err(|_| "Invalid Compose config response".into())
}
fn preview(source: &str, model: &Value) -> Value {
    let services: Vec<_> = model["services"].as_object().into_iter().flat_map(|s| s.iter()).map(|(name, s)| {
        let ports: Vec<_> = s["ports"].as_array().into_iter().flatten().map(|v| format!("{}:{} → {}/{}", v["host_ip"].as_str().unwrap_or("0.0.0.0"), v["published"].as_str().unwrap_or("—"), v["target"], v["protocol"].as_str().unwrap_or("tcp"))).collect();
        let mounts: Vec<_> = s["volumes"].as_array().into_iter().flatten().map(|v| format!("{} → {} ({})", v["source"].as_str().unwrap_or("anonymous"), v["target"].as_str().unwrap_or(""), v["type"].as_str().unwrap_or("volume"))).collect();
        let depends: Vec<_> = s["depends_on"].as_object().into_iter().flat_map(|d| d.keys()).collect();
        let structured: Vec<_> = s["volumes"].as_array().into_iter().flatten().map(|v| json!({"kind":v["type"].as_str().unwrap_or("volume"),"source":v["source"].as_str().unwrap_or(""),"target":v["target"].as_str().unwrap_or("")})).collect();
        json!({"name":name,"image":s["image"].as_str().unwrap_or(""),"build":s.get("build").is_some(),"ports":ports,"volumes":mounts,"mounts":structured,"depends":depends,"profiles":s["profiles"].as_array().cloned().unwrap_or_default()})
    }).collect();
    let volumes: Vec<_> = model["volumes"]
        .as_object()
        .into_iter()
        .flat_map(|v| v.keys())
        .collect();
    json!({"token":token(source,model),"services":services,"volumes":volumes})
}
#[tauri::command]
pub async fn compose_list(app: tauri::AppHandle) -> Result<Vec<Project>, String> {
    let _lock = LOCK.lock().await;
    list(&app)
}
#[tauri::command]
pub async fn compose_read(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    let _lock = LOCK.lock().await;
    document(&project(&app, &id)?)
}
#[tauri::command]
pub async fn compose_import(
    app: tauri::AppHandle,
    context: String,
) -> Result<Option<Value>, String> {
    cli::validate(&context)?;
    let selected = rfd::AsyncFileDialog::new()
        .add_filter("Compose", &["yaml", "yml", "json"])
        .pick_file()
        .await;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let _lock = LOCK.lock().await;
    let path = selected.path().canonicalize().map_err(|e| e.to_string())?;
    let mut projects = list(&app)?;
    if let Some(p) = projects
        .iter()
        .find(|p| p.context == context && Path::new(&p.path) == path)
    {
        return document(p).map(Some);
    }
    let mut p = Project {
        id: uuid::Uuid::new_v4().to_string(),
        context,
        name: "woojoo-import".into(),
        path: path.to_string_lossy().into_owned(),
    };
    // Let Compose determine name from the actual file / original directory, without -p overriding it.
    let source = read(&path)?;
    let mut command = cli::command(
        Some(&p.context),
        &[
            "compose",
            "--project-directory",
            &path.parent().ok_or("Missing directory")?.to_string_lossy(),
            "--file",
            &p.path,
            "config",
            "--format",
            "json",
        ],
    )?;
    command.current_dir(path.parent().ok_or("Missing directory")?);
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("COMPOSE_") {
            command.env_remove(key);
        }
    }
    let output = cli::execute(
        command,
        std::time::Duration::from_secs(30),
        16 * 1024 * 1024,
    )
    .await?;
    let config: Value =
        serde_json::from_str(&output).map_err(|_| "Invalid Compose configuration")?;
    p.name = config["name"]
        .as_str()
        .ok_or("Compose project name missing")?
        .into();
    check_name(&p.name)?;
    if projects
        .iter()
        .any(|other| other.context == p.context && other.name == p.name)
    {
        return Err(
            "A different Compose file already uses this project name in this context".into(),
        );
    }
    projects.push(p.clone());
    persist(&app, &projects)?;
    Ok(Some(json!({"project":p,"source":source})))
}
#[tauri::command]
pub async fn compose_create(
    app: tauri::AppHandle,
    context: String,
    name: String,
    source: String,
) -> Result<Option<Value>, String> {
    cli::validate(&context)?;
    check_name(&name)?;
    let selected = rfd::AsyncFileDialog::new()
        .set_file_name("compose.yml")
        .add_filter("Compose", &["yml", "yaml"])
        .save_file()
        .await;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let _lock = LOCK.lock().await;
    let path = selected.path();
    if path.exists() {
        return Err("File already exists. Import it to edit without overwriting changes.".into());
    }
    let mut projects = list(&app)?;
    if projects
        .iter()
        .any(|p| p.context == context && p.name == name)
    {
        return Err("Project name already registered in this context".into());
    }
    let p = Project {
        id: uuid::Uuid::new_v4().to_string(),
        context,
        name,
        path: path.to_string_lossy().into_owned(),
    };
    model(&p, &source).await?;
    {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        file.write_all(source.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    projects.push(p.clone());
    persist(&app, &projects)?;
    document(&p).map(Some)
}
#[tauri::command]
pub async fn compose_preview(
    app: tauri::AppHandle,
    id: String,
    source: String,
) -> Result<Value, String> {
    let _lock = LOCK.lock().await;
    let p = project(&app, &id)?;
    Ok(preview(&source, &model(&p, &source).await?))
}
#[tauri::command]
pub async fn compose_save(
    app: tauri::AppHandle,
    id: String,
    source: String,
    expected: String,
) -> Result<Value, String> {
    let _lock = LOCK.lock().await;
    let p = project(&app, &id)?;
    if read(Path::new(&p.path))? != expected {
        return Err("Compose file changed outside Woojoo. Reopen it before saving.".into());
    }
    model(&p, &source).await?;
    if read(Path::new(&p.path))? != expected {
        return Err("Compose file changed during validation. Reopen it before saving.".into());
    }
    atomic_write(Path::new(&p.path), source.as_bytes())?;
    document(&p)
}
fn action_tail(action: &str, service: &str) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = match action {
        "up" => vec!["up", "--detach", "--remove-orphans=false"],
        "stop" => vec!["stop"],
        "restart" => vec!["restart"],
        "down" if service.is_empty() => vec!["down", "--remove-orphans=false"],
        "remove" if !service.is_empty() => vec!["rm", "--stop", "--force"],
        _ => return Err("Invalid Compose action".into()),
    }
    .into_iter()
    .map(str::to_string)
    .collect();
    if !service.is_empty() {
        cli::validate(service)?;
        args.push(service.into());
    }
    Ok(args)
}
#[tauri::command]
pub async fn compose_action(
    app: tauri::AppHandle,
    id: String,
    token: String,
    action: String,
    service: String,
) -> Result<(), String> {
    let _lock = LOCK.try_lock().map_err(|_| "DOCKER_BUSY")?;
    let p = project(&app, &id)?;
    let source = read(Path::new(&p.path))?;
    let config = model(&p, &source).await?;
    if token != self::token(&source, &config) {
        return Err("Compose configuration changed. Validate and review again.".into());
    }
    if !service.is_empty() && config["services"].get(&service).is_none() {
        return Err("Compose service not found".into());
    }
    let args = action_tail(&action, &service)?;
    ensure_current_source(Path::new(&p.path), &source)?;
    run(
        &p,
        &p.path,
        &args.iter().map(String::as_str).collect::<Vec<_>>(),
        180,
    )
    .await?;
    Ok(())
}
fn ensure_current_source(path: &Path, expected: &str) -> Result<(), String> {
    if read(path)? != expected {
        return Err("Compose source changed during validation. Validate and review again.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn compose_forget(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let _lock = LOCK.lock().await;
    let mut projects = list(&app)?;
    projects.retain(|p| p.id != id);
    persist(&app, &projects)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commands_preserve_volumes_and_bound_targets() {
        assert_eq!(
            action_tail("down", "").unwrap(),
            ["down", "--remove-orphans=false"]
        );
        assert_eq!(
            action_tail("up", "").unwrap(),
            ["up", "--detach", "--remove-orphans=false"]
        );
        assert_eq!(
            action_tail("remove", "db").unwrap(),
            ["rm", "--stop", "--force", "db"]
        );
        assert!(action_tail("down", "db").is_err());
        assert!(action_tail("up", "--volumes").is_err());
        assert!(check_name("../escape").is_err());
        let p = Project {
            id: "1".into(),
            context: "remote".into(),
            name: "app".into(),
            path: "/projects/with spaces/compose.yml".into(),
        };
        let a = args(&p, &p.path, &["up", "--detach"]).unwrap();
        assert!(a.windows(2).any(|a| a == ["--project-name", "app"]));
        assert!(a.windows(2).any(|a| a == ["--file", &p.path]));
    }
    #[test]
    fn previews_hide_environment_and_detect_env_changes() {
        let model = json!({"services":{"db":{"image":"postgres:16","environment":{"PASSWORD":"secret"},"depends_on":{"api":{}},"volumes":[{"type":"volume","source":"data","target":"/data"}]}}});
        let p = preview("services: {}", &model);
        assert!(!p.to_string().contains("secret"));
        assert_eq!(p["services"][0]["depends"], json!(["api"]));
        let mut changed = model.clone();
        changed["services"]["db"]["environment"]["PASSWORD"] = json!("changed");
        assert_ne!(token("same", &model), token("same", &changed));
        assert_ne!(token("before", &model), token("after", &model));
    }
    #[tokio::test]
    async fn real_compose_preserves_relative_env_and_cleans_drafts() {
        if cli::path().is_err() {
            return;
        }
        let root =
            std::env::temp_dir().join(format!("woojoo compose test {}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let p = Project {
            id: "test".into(),
            context: "default".into(),
            name: "woojoo-test".into(),
            path: root.join("compose.yml").to_string_lossy().into_owned(),
        };
        std::fs::write(root.join(".env"), "IMAGE_TAG=16\n").unwrap();
        std::fs::write(root.join("service.env"), "TOKEN=private-test-value\n").unwrap();
        let source = "services:\n  db:\n    image: postgres:${IMAGE_TAG}\n    env_file: ./service.env\n    volumes:\n      - ./data:/data\n  debug:\n    image: alpine\n    profiles: [debug]\n";
        let result = model(&p, source).await;
        let leftovers: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(".woojoo-"))
            .collect();
        std::fs::remove_file(root.join(".env")).unwrap();
        std::fs::remove_file(root.join("service.env")).unwrap();
        std::fs::remove_dir(&root).unwrap();
        let result = result.unwrap();
        assert!(
            result["services"].get("debug").is_some(),
            "Profile services must be available for individual actions"
        );
        assert_eq!(result["services"]["db"]["image"], "postgres:16");
        assert_eq!(
            result["services"]["db"]["environment"]["TOKEN"],
            "private-test-value"
        );
        assert!(!preview(source, &result)
            .to_string()
            .contains("private-test-value"));
        assert!(leftovers.is_empty());
    }
    #[test]
    fn atomic_replace_preserves_complete_source() {
        let path = std::env::temp_dir().join(format!("woojoo-{}.yml", uuid::Uuid::new_v4()));
        atomic_write(&path, b"before").unwrap();
        atomic_write(&path, b"after").unwrap();
        assert_eq!(read(&path).unwrap(), "after");
        assert!(ensure_current_source(&path, "before").is_err());
        assert!(ensure_current_source(&path, "after").is_ok());
        std::fs::remove_file(path).unwrap();
    }
}
