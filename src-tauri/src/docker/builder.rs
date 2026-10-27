use super::{cli, compose::atomic_write};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{hash_map::DefaultHasher, BTreeMap, HashMap},
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct SourceFile {
    pub path: String,
    pub original: Option<String>,
    pub source: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInput {
    pub id: String,
    pub context: String,
    pub name: String,
    pub files: Vec<SourceFile>,
    pub profiles: Vec<String>,
    #[serde(default)]
    pub rebuild: bool,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}
#[derive(Clone)]
pub struct Plan {
    pub input: BuildInput,
    pub model: Value,
    pub references: Vec<PathBuf>,
    pub fingerprint: String,
    pub extras: Vec<SourceFile>,
    pub created: u64,
}
static PLANS: LazyLock<Mutex<HashMap<String, Plan>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static WRITES: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn hash(value: &str) -> String {
    let mut h = DefaultHasher::new();
    value.hash(&mut h);
    format!("{:016x}", h.finish())
}
fn read(path: &Path) -> Result<String, String> {
    if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024 {
        return Err("File exceeds 2 MiB".into());
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}
pub fn fingerprint_files(paths: &[PathBuf]) -> Result<String, String> {
    let mut h = DefaultHasher::new();
    for p in paths {
        p.hash(&mut h);
        if p.exists() {
            std::fs::read(p).map_err(|e| e.to_string())?.hash(&mut h)
        } else {
            "missing".hash(&mut h)
        }
    }
    Ok(format!("{:016x}", h.finish()))
}
fn validate(input: &BuildInput) -> Result<(), String> {
    if input.name.is_empty()
        || input.name.len() > 128
        || !input
            .name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
        || !input.name.as_bytes()[0].is_ascii_alphanumeric()
    {
        return Err("Invalid project name".into());
    }
    if input.files.is_empty() || input.files.len() > 20 {
        return Err("Choose 1–20 Compose files".into());
    }
    let mut paths = std::collections::HashSet::new();
    for f in &input.files {
        if f.source.len() > 2 * 1024 * 1024
            || !Path::new(&f.path).is_absolute()
            || !paths.insert(&f.path)
        {
            return Err("Invalid, duplicate or oversized source file".into());
        }
    }
    for p in &input.profiles {
        cli::validate(p)?;
    }
    Ok(())
}
pub fn compose_args(
    input: &BuildInput,
    files: &[String],
    tail: &[&str],
) -> Result<Vec<String>, String> {
    cli::validate(&input.context)?;
    let folder = Path::new(&input.files[0].path)
        .parent()
        .ok_or("Missing project directory")?;
    let mut args = vec![
        "compose".into(),
        "--ansi".into(),
        "never".into(),
        "--project-directory".into(),
        folder.to_string_lossy().into_owned(),
        "--project-name".into(),
        input.name.clone(),
    ];
    for f in files {
        args.extend(["--file".into(), f.clone()]);
    }
    for p in &input.profiles {
        args.extend(["--profile".into(), p.clone()]);
    }
    args.extend(tail.iter().map(|s| s.to_string()));
    Ok(args)
}
pub fn command(
    input: &BuildInput,
    files: &[String],
    tail: &[&str],
) -> Result<tokio::process::Command, String> {
    let args = compose_args(input, files, tail)?;
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let mut c = cli::command(Some(&input.context), &refs)?;
    c.current_dir(
        Path::new(&input.files[0].path)
            .parent()
            .ok_or("Missing project directory")?,
    );
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().starts_with("COMPOSE_") {
            c.env_remove(k);
        }
    }
    c.env("COMPOSE_REMOVE_ORPHANS", "false")
        .env("COMPOSE_IGNORE_ORPHANS", "false")
        .env("COMPOSE_PROFILES", "");
    for (k, v) in &input.env {
        if !k.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
            || k.starts_with("COMPOSE_")
            || k.starts_with("DOCKER_")
        {
            return Err("Invalid environment key".into());
        }
        c.env(k, v);
    }
    Ok(c)
}
struct Temporary(Vec<PathBuf>);
impl Drop for Temporary {
    fn drop(&mut self) {
        for p in &self.0 {
            let _ = std::fs::remove_file(p);
        }
    }
}
async fn resolve(input: &BuildInput, no_env: bool) -> Result<Value, String> {
    validate(input)?;
    let mut temp = Temporary(vec![]);
    for f in &input.files {
        let p = Path::new(&f.path)
            .with_file_name(format!(".woojoo-review-{}.yml", uuid::Uuid::new_v4()));
        atomic_write(&p, f.source.as_bytes())?;
        temp.0.push(p);
    }
    let files = temp
        .0
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let tail = if no_env {
        vec!["config", "--no-env-resolution", "--format", "json"]
    } else {
        vec!["config", "--format", "json"]
    };
    let _operation = super::storage::operation().await?;
    let raw = cli::execute(
        command(input, &files, &tail)?,
        Duration::from_secs(45),
        16 * 1024 * 1024,
    )
    .await?;
    serde_json::from_str(&raw).map_err(|_| "Invalid Compose config response".into())
}
fn references(input: &BuildInput, model: &Value) -> Vec<PathBuf> {
    let base = Path::new(&input.files[0].path)
        .parent()
        .unwrap_or(Path::new("."));
    let mut refs = vec![base.join(".env")];
    let path = |s: &str| {
        let p = Path::new(s);
        if p.is_absolute() {
            p.to_owned()
        } else {
            base.join(p)
        }
    };
    for s in model["services"]
        .as_object()
        .into_iter()
        .flat_map(|s| s.values())
    {
        for e in s["env_file"].as_array().into_iter().flatten() {
            if let Some(p) = e.as_str().or_else(|| e["path"].as_str()) {
                refs.push(path(p));
            }
        }
        if let Some(build) = s.get("build") {
            if let Some(context) = build["context"].as_str() {
                if !context.contains("://") {
                    refs.push(
                        path(context).join(build["dockerfile"].as_str().unwrap_or("Dockerfile")),
                    );
                }
            }
        }
    }
    for kind in ["configs", "secrets"] {
        for item in model[kind].as_object().into_iter().flat_map(|s| s.values()) {
            if let Some(p) = item["file"].as_str() {
                refs.push(path(p));
            }
        }
    }
    refs.sort();
    refs.dedup();
    refs
}
pub fn mask_model(model: &mut Value) {
    if let Some(services) = model["services"].as_object_mut() {
        for s in services.values_mut() {
            if let Some(env) = s["environment"].as_object_mut() {
                for v in env.values_mut() {
                    *v = json!("••••");
                }
            }
            if let Some(args) = s["build"]["args"].as_object_mut() {
                for v in args.values_mut() {
                    *v = json!("••••");
                }
            }
            if let Some(obj) = s.as_object_mut() {
                for k in ["command", "entrypoint", "labels"] {
                    if obj.contains_key(k) {
                        obj.insert(k.into(), json!("••••"));
                    }
                }
            }
        }
    }
}
fn check_originals(files: &[SourceFile]) -> Result<(), String> {
    for f in files {
        let current = if Path::new(&f.path).exists() {
            Some(read(Path::new(&f.path))?)
        } else {
            None
        };
        if current != f.original {
            return Err(format!("SOURCE_CHANGED: {}", f.path));
        }
    }
    Ok(())
}
fn env_files(input: &BuildInput) -> Result<Vec<SourceFile>, String> {
    if input.env.is_empty() {
        return Ok(vec![]);
    }
    let dir = Path::new(&input.files[0].path)
        .parent()
        .ok_or("Missing project directory")?;
    let load = |name: &str| -> Result<SourceFile, String> {
        let path = dir.join(name);
        let original = if path.exists() {
            Some(read(&path)?)
        } else {
            None
        };
        Ok(SourceFile {
            path: path.to_string_lossy().into_owned(),
            source: original.clone().unwrap_or_default(),
            original,
        })
    };
    let mut env = load(".env")?;
    let mut example = load(".env.example")?;
    let mut ignore = load(".gitignore")?;
    for (k, v) in &input.env {
        if env.source.lines().any(|l| {
            l.trim_start()
                .trim_start_matches("export ")
                .trim_start()
                .strip_prefix(k)
                .is_some_and(|s| s.trim_start().starts_with('='))
        }) {
            return Err(format!(
                "Existing .env key {k}: edit the original file instead of overwriting"
            ));
        }
        if k.is_empty() || !k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
            return Err("Invalid variable key".into());
        }
        env.source.push_str(&format!("\n{k}={}\n", dotenv_value(v)));
        if !example
            .source
            .lines()
            .any(|l| l.starts_with(&format!("{k}=")))
        {
            example.source.push_str(&format!("\n{k}=\n"));
        }
    }
    if !ignore.source.lines().any(|l| l.trim() == ".env") {
        ignore
            .source
            .push_str("\n# Local Compose credentials\n.env\n");
    }
    Ok(vec![env, example, ignore])
}
fn dotenv_value(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('$', "$$")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    )
}

// Stage every output first. A failed replacement restores only files still
// matching our just-written content; an external edit is never overwritten.
fn save_files_with(
    files: &[SourceFile],
    mut commit: impl FnMut(&Path, &Path) -> Result<(), String>,
) -> Result<(), String> {
    check_originals(files)?;
    let mut temp = Temporary(vec![]);
    for f in files {
        let target = Path::new(&f.path);
        let staged = target.with_file_name(format!(".woojoo-save-{}", uuid::Uuid::new_v4()));
        temp.0.push(staged.clone());
        atomic_write(&staged, f.source.as_bytes())?;
        if let Ok(metadata) = target.metadata() {
            std::fs::set_permissions(&staged, metadata.permissions()).map_err(|e| e.to_string())?;
        }
    }
    check_originals(files)?;
    for (index, f) in files.iter().enumerate() {
        if let Err(error) = commit(&temp.0[index], Path::new(&f.path)) {
            let mut unrestored = vec![];
            for previous in files[..index].iter().rev() {
                let path = Path::new(&previous.path);
                let result = if read(path).ok().as_ref() != Some(&previous.source) {
                    Err("External edit".into())
                } else if let Some(original) = &previous.original {
                    atomic_write(path, original.as_bytes())
                } else {
                    std::fs::remove_file(path).map_err(|e| e.to_string())
                };
                if result.is_err() {
                    unrestored.push(previous.path.clone());
                }
            }
            return Err(if unrestored.is_empty() {
                format!("SAVE_FAILED: {error}; prior writes restored")
            } else {
                format!(
                    "SAVE_PARTIAL: {error}; inspect these files before retry: {}",
                    unrestored.join(", ")
                )
            });
        }
    }
    Ok(())
}
fn save_files(files: &[SourceFile]) -> Result<(), String> {
    save_files_with(files, |from, to| {
        std::fs::rename(from, to).map_err(|e| e.to_string())
    })
}
#[tauri::command]
pub async fn docker_builder_import(
    paths: Option<Vec<String>>,
) -> Result<Option<Vec<SourceFile>>, String> {
    let paths = match paths {
        Some(p) => p,
        None => {
            let Some(files) = rfd::AsyncFileDialog::new()
                .add_filter("Compose", &["yml", "yaml", "json"])
                .pick_files()
                .await
            else {
                return Ok(None);
            };
            files
                .into_iter()
                .map(|f| f.path().to_string_lossy().into_owned())
                .collect()
        }
    };
    if paths.len() > 20 {
        return Err("Choose at most 20 files".into());
    }
    let mut result = vec![];
    for p in paths {
        let path = Path::new(&p).canonicalize().map_err(|e| e.to_string())?;
        let source = read(&path)?;
        result.push(SourceFile {
            path: path.to_string_lossy().into_owned(),
            original: Some(source.clone()),
            source,
        });
    }
    Ok(Some(result))
}
#[tauri::command]
pub async fn docker_builder_destination() -> Result<Option<String>, String> {
    Ok(rfd::AsyncFileDialog::new()
        .set_file_name("compose.yml")
        .add_filter("Compose", &["yml", "yaml"])
        .save_file()
        .await
        .map(|f| f.path().to_string_lossy().into_owned()))
}
#[tauri::command]
pub async fn docker_builder_pick_app() -> Result<Option<Value>, String> {
    let Some(folder) = rfd::AsyncFileDialog::new().pick_folder().await else {
        return Ok(None);
    };
    let path = folder.path();
    let mut files = vec![];
    for item in std::fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let name = item.file_name().to_string_lossy().into_owned();
        if item.path().is_file() && (name == "Dockerfile" || name.starts_with("Dockerfile.")) {
            files.push(name);
        }
    }
    files.sort();
    Ok(Some(
        json!({"context":path.to_string_lossy(),"dockerfiles":files}),
    ))
}
#[tauri::command]
pub async fn docker_builder_pick_path() -> Result<Option<String>, String> {
    Ok(rfd::AsyncFileDialog::new()
        .pick_folder()
        .await
        .map(|f| f.path().to_string_lossy().into_owned()))
}
#[tauri::command]
pub async fn docker_builder_example_keys() -> Result<Option<Vec<String>>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Select .env.example (keys only)")
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let raw = read(file.path())?;
    Ok(Some(
        raw.lines()
            .filter_map(|l| {
                let (key, _) = l.trim().split_once('=')?;
                let key = key.trim().trim_start_matches("export ").trim();
                if !key.is_empty() && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
                    Some(key.to_owned())
                } else {
                    None
                }
            })
            .collect(),
    ))
}
#[tauri::command]
pub async fn docker_builder_search(query: String) -> Result<Value, String> {
    cli::validate(&query)?;
    let raw = cli::run(
        None,
        &[
            "search",
            "--limit",
            "25",
            "--no-trunc",
            "--format",
            "{{json .}}",
            &query,
        ],
        30,
    )
    .await?;
    let values = raw
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .collect::<Vec<_>>();
    Ok(json!({"results":values,"checked":now()}))
}
static TAGS: LazyLock<Mutex<HashMap<String, Value>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
#[tauri::command]
pub async fn docker_builder_tags(repository: String, page: u32) -> Result<Value, String> {
    if !repository
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"_./-".contains(&b))
        || repository.contains("..")
        || repository.split('/').count() > 2
        || page == 0
        || page > 1000
    {
        return Err("Invalid repository or page".into());
    }
    let repo = if repository.contains('/') {
        repository
    } else {
        format!("library/{repository}")
    };
    let key = format!("{repo}/{page}");
    let cached = TAGS
        .lock()
        .map_err(|_| "Cache unavailable")?
        .get(&key)
        .cloned();
    if let Some(c) = &cached {
        if now().saturating_sub(c["checked"].as_u64().unwrap_or(0)) < 300 {
            return Ok(c.clone());
        }
    }
    let (namespace, name) = repo.split_once('/').ok_or("Invalid repository")?;
    let request = async {
        let response=reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e|e.to_string())?.get(format!("https://hub.docker.com/v2/namespaces/{namespace}/repositories/{name}/tags?page_size=25&page={page}")).send().await.map_err(|_|"Registry unavailable/offline".to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "Registry HTTP {} (authentication/rate limit may apply)",
                response.status()
            ));
        }
        serde_json::from_str::<Value>(&response.text().await.map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    };
    match request.await {
        Ok(v) => {
            let out = json!({"results":v["results"],"next":!v["next"].is_null(),"checked":now(),"cached":false});
            let mut cache = TAGS.lock().map_err(|_| "Cache unavailable")?;
            if cache.len() > 200 {
                cache.clear()
            }
            cache.insert(key, out.clone());
            Ok(out)
        }
        Err(e) => {
            if let Some(mut c) = cached {
                c["cached"] = json!(true);
                c["warning"] = json!(e);
                Ok(c)
            } else {
                Err(e)
            }
        }
    }
}
#[tauri::command]
pub async fn docker_builder_review(input: BuildInput) -> Result<Value, String> {
    validate(&input)?;
    check_originals(&input.files)?;
    let extras = env_files(&input)?;
    let model = resolve(&input, false).await?;
    check_ports(&input, &model).await?;
    let unresolved = resolve(&input, true).await?;
    let references = references(&input, &unresolved);
    let fingerprint = fingerprint_files(&references)?;
    let token = uuid::Uuid::new_v4().to_string();
    let mut masked = model.clone();
    mask_model(&mut masked);
    let mut baseline = None;
    let mut changed_fields = BTreeMap::<String, Vec<String>>::new();
    if input.files.iter().all(|f| f.original.is_some()) {
        let mut before = input.clone();
        for f in &mut before.files {
            f.source = f.original.clone().unwrap_or_default();
        }
        if let Ok(mut old) = resolve(&before, false).await {
            for (name, service) in model["services"].as_object().into_iter().flatten() {
                let previous = &old["services"][name];
                let fields = service
                    .as_object()
                    .into_iter()
                    .flat_map(|s| s.keys())
                    .chain(previous.as_object().into_iter().flat_map(|s| s.keys()))
                    .collect::<std::collections::BTreeSet<_>>();
                changed_fields.insert(
                    name.clone(),
                    fields
                        .into_iter()
                        .filter(|k| service[*k] != previous[*k])
                        .cloned()
                        .collect(),
                );
            }
            mask_model(&mut old);
            baseline = Some(old);
        }
    }
    let result = json!({"token":token,"effective":masked,"baseline":baseline,"changedFields":changed_fields,"fingerprint":fingerprint,"files":input.files.iter().map(|f|json!({"path":f.path,"changed":f.original.as_ref()!=Some(&f.source)})).collect::<Vec<_>>(),"extraFiles":extras.iter().map(|f|json!({"path":f.path,"purpose":Path::new(&f.path).file_name().unwrap_or_default().to_string_lossy()})).collect::<Vec<_>>(),"checked":now()});
    let mut plans = PLANS.lock().map_err(|_| "Plan storage unavailable")?;
    plans.retain(|_, p| now().saturating_sub(p.created) < 1800);
    if plans.len() >= 20 {
        return Err("Too many pending reviews".into());
    }
    plans.insert(
        token.clone(),
        Plan {
            input,
            model,
            references,
            fingerprint,
            extras,
            created: now(),
        },
    );
    Ok(result)
}
pub async fn verified_plan(token: &str) -> Result<Plan, String> {
    let plan = PLANS
        .lock()
        .map_err(|_| "Plan unavailable")?
        .get(token)
        .cloned()
        .ok_or("Review expired; review again")?;
    if now().saturating_sub(plan.created) > 1800 {
        return Err("Review expired".into());
    }
    check_originals(&plan.input.files)?;
    check_originals(&plan.extras)?;
    if fingerprint_files(&plan.references)? != plan.fingerprint {
        return Err("INPUT_CHANGED: environment/config/secret/Dockerfile changed".into());
    }
    if resolve(&plan.input, false).await? != plan.model {
        return Err("INPUT_CHANGED: effective configuration changed".into());
    }
    check_ports(&plan.input, &plan.model).await?;
    Ok(plan)
}
pub async fn save_plan(token: &str) -> Result<Plan, String> {
    let _lock = WRITES.lock().await;
    let mut plan = verified_plan(token).await?;
    save_files(
        &plan
            .extras
            .iter()
            .chain(plan.input.files.iter())
            .cloned()
            .collect::<Vec<_>>(),
    )?;
    for f in plan.extras.iter_mut().chain(plan.input.files.iter_mut()) {
        f.original = Some(f.source.clone());
    }
    plan.fingerprint = fingerprint_files(&plan.references)?;
    PLANS
        .lock()
        .map_err(|_| "Plan unavailable")?
        .insert(token.into(), plan.clone());
    check_ports(&plan.input, &plan.model).await?;
    Ok(plan)
}
#[tauri::command]
pub async fn docker_builder_save(token: String) -> Result<Vec<SourceFile>, String> {
    Ok(save_plan(&token).await?.input.files)
}
#[tauri::command]
pub async fn docker_builder_save_draft(input: BuildInput) -> Result<Vec<SourceFile>, String> {
    validate(&input)?;
    let _lock = WRITES.lock().await;
    check_originals(&input.files)?;
    save_files(&input.files)?;
    Ok(input
        .files
        .into_iter()
        .map(|mut f| {
            f.original = Some(f.source.clone());
            f
        })
        .collect())
}
pub fn plan_fingerprint(plan: &Plan) -> String {
    hash(&format!(
        "{}:{}:{}",
        serde_json::to_string(&plan.input).unwrap_or_default(),
        plan.fingerprint,
        plan.model
    ))
}

fn port_conflicts(project: &str, model: &Value, snapshot: &Value) -> Vec<String> {
    let mut conflicts = vec![];
    for (name, service) in model["services"].as_object().into_iter().flatten() {
        for port in service["ports"].as_array().into_iter().flatten() {
            let Some(published) = port["published"].as_str() else {
                continue;
            };
            let host = port["host_ip"].as_str().unwrap_or("0.0.0.0");
            let protocol = port["protocol"].as_str().unwrap_or("tcp");
            for c in snapshot["containers"].as_array().into_iter().flatten() {
                if c["project"].as_str() == Some(project) && c["service"].as_str() == Some(name) {
                    continue;
                }
                if !matches!(
                    c["state"].as_str(),
                    Some("running" | "restarting" | "paused")
                ) {
                    continue;
                }
                for bound in c["ports"].as_array().into_iter().flatten() {
                    let other = bound["hostIp"].as_str().unwrap_or("0.0.0.0");
                    if bound["hostPort"].as_str() == Some(published)
                        && bound["privatePort"]
                            .as_str()
                            .is_some_and(|p| p.ends_with(&format!("/{protocol}")))
                        && (host == other
                            || ["0.0.0.0", "::", ""].contains(&host)
                            || ["0.0.0.0", "::", ""].contains(&other))
                    {
                        conflicts.push(format!("{name}: {host}:{published}/{protocol} is already bound by another container"));
                    }
                }
            }
        }
    }
    conflicts
}
async fn check_ports(input: &BuildInput, model: &Value) -> Result<(), String> {
    if !model["services"]
        .as_object()
        .into_iter()
        .flat_map(|s| s.values())
        .any(|s| s["ports"].as_array().is_some_and(|p| !p.is_empty()))
    {
        return Ok(());
    }
    let snapshot = super::docker_snapshot(input.context.clone(), false).await?;
    if snapshot["complete"] != true {
        return Err("Docker bindings could not be fully verified".into());
    }
    let conflicts = port_conflicts(&input.name, model, &snapshot);
    if conflicts.is_empty() {
        Ok(())
    } else {
        Err(format!("PORT_CONFLICT: {}", conflicts.join("; ")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_save_restores_prior_files_and_cleans_staging() {
        let dir =
            std::env::temp_dir().join(format!("woojoo-builder-save-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let a = dir.join("a.yml");
        let b = dir.join("b.yml");
        std::fs::write(&a, "old-a").unwrap();
        std::fs::write(&b, "old-b").unwrap();
        let files = vec![
            SourceFile {
                path: a.to_string_lossy().into_owned(),
                original: Some("old-a".into()),
                source: "new-a".into(),
            },
            SourceFile {
                path: b.to_string_lossy().into_owned(),
                original: Some("old-b".into()),
                source: "new-b".into(),
            },
        ];
        let mut count = 0;
        let error = save_files_with(&files, |from, to| {
            count += 1;
            if count == 2 {
                Err("injected second-file failure".into())
            } else {
                std::fs::rename(from, to).map_err(|e| e.to_string())
            }
        })
        .unwrap_err();
        assert!(error.contains("prior writes restored"));
        assert_eq!(read(&a).unwrap(), "old-a");
        assert_eq!(read(&b).unwrap(), "old-b");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);
        std::fs::remove_file(a).unwrap();
        std::fs::remove_file(b).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn dotenv_quotes_preserve_backslashes_and_literal_interpolation() {
        assert_eq!(dotenv_value("a\\'b\n$TOKEN\""), "\"a\\\\'b\\n$$TOKEN\\\"\"");
    }
    #[test]
    fn file_changes_invalidate_review_fingerprint() {
        let dir = std::env::temp_dir().join(format!("woojoo-builder-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(".env");
        std::fs::write(&path, "TOKEN=first").unwrap();
        let a = fingerprint_files(&[path.clone()]).unwrap();
        std::fs::write(&path, "TOKEN=second").unwrap();
        assert_ne!(a, fingerprint_files(&[path.clone()]).unwrap());
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn ordered_files_and_profiles_are_explicit() {
        let input = BuildInput {
            id: "id".into(),
            context: "desktop-linux".into(),
            name: "test".into(),
            files: vec![
                SourceFile {
                    path: "C:/app/base.yml".into(),
                    original: Some("".into()),
                    source: "services: {}".into(),
                },
                SourceFile {
                    path: "C:/app/dev.yml".into(),
                    original: Some("".into()),
                    source: "services: {}".into(),
                },
            ],
            profiles: vec!["dev".into()],
            rebuild: false,
            env: BTreeMap::new(),
        };
        let args = compose_args(
            &input,
            &input
                .files
                .iter()
                .map(|f| f.path.clone())
                .collect::<Vec<_>>(),
            &["config"],
        )
        .unwrap();
        assert!(args
            .windows(4)
            .any(|w| w == ["--file", "C:/app/base.yml", "--file", "C:/app/dev.yml"]));
        assert!(args.windows(2).any(|w| w == ["--profile", "dev"]));
    }
    #[test]
    fn review_redacts_env_commands_and_build_args() {
        let mut v = serde_json::json!({"services":{"api":{"environment":{"TOKEN":"secret"},"command":"secret-command","build":{"args":{"KEY":"secret-build"}}}}});
        mask_model(&mut v);
        assert!(!v.to_string().contains("secret"));
    }
    #[test]
    fn published_port_preflight_ignores_own_service_but_catches_wildcard_overlap() {
        let model = json!({"services":{"redis":{"ports":[{"target":6379,"published":"16379","host_ip":"127.0.0.1","protocol":"tcp"}]}}});
        let snapshot = json!({"containers":[{"project":"mine","service":"redis","state":"running","ports":[{"hostIp":"0.0.0.0","hostPort":"16379","privatePort":"6379/tcp"}]}]});
        assert!(port_conflicts("mine", &model, &snapshot).is_empty());
        assert_eq!(port_conflicts("other", &model, &snapshot).len(), 1);
    }
    #[tokio::test]
    #[ignore = "Requires the local Docker Compose CLI; creates no containers"]
    async fn native_multifile_and_dotenv_roundtrip() {
        let dir =
            std::env::temp_dir().join(format!("woojoo-builder-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let mut input=BuildInput{id:"config-test".into(),context:"desktop-linux".into(),name:"config-test".into(),profiles:vec![],rebuild:false,env:BTreeMap::from([("TOKEN".into(),"one\\'two\n$LITERAL\"tail\\".into())]),files:vec![
            SourceFile{path:dir.join("base.yml").to_string_lossy().into_owned(),original:None,source:"services:\n  api:\n    image: redis:7.4\n    environment:\n      TOKEN: ${TOKEN:?required}\n    networks: [private]\n".into()},
            SourceFile{path:dir.join("dev.yml").to_string_lossy().into_owned(),original:None,source:"networks: {private: {}}\nservices: {worker: {image: redis:7.4}}\n".into()}]};
        let result = async {
            let review = docker_builder_review(input.clone()).await?;
            let plan = save_plan(review["token"].as_str().unwrap()).await?;
            input = plan.input;
            input.env.clear();
            assert_eq!(resolve(&input, false).await?, plan.model);
            input.files[1].source = input.files[1]
                .source
                .replace("image: redis:7.4", "image: redis:7.4-alpine");
            let changed = docker_builder_review(input.clone()).await?;
            assert_eq!(
                changed["effective"]["services"]["worker"]["image"],
                "redis:7.4-alpine"
            );
            assert_eq!(
                changed["baseline"]["services"]["worker"]["image"],
                "redis:7.4"
            );
            assert!(changed["changedFields"]["worker"]
                .as_array()
                .unwrap()
                .contains(&json!("image")));
            Ok::<(), String>(())
        }
        .await;
        for name in ["base.yml", "dev.yml", ".env", ".env.example", ".gitignore"] {
            let _ = std::fs::remove_file(dir.join(name));
        }
        let _ = std::fs::remove_dir(dir);
        assert!(result.is_ok(), "{result:?}");
    }
    #[tokio::test]
    #[ignore = "Creates only uniquely named disposable local Docker test resources"]
    async fn native_review_run_recreate_and_data_retention() {
        let id = format!("woojoo-builder-test-{}", uuid::Uuid::new_v4().simple());
        let dir = std::env::temp_dir().join(&id);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("compose.yml");
        let env_path = dir.join(".env");
        let dockerfile = dir.join("Dockerfile");
        let marker = dir.join("marker");
        let build_image = format!("{id}-worker:local");
        std::fs::write(&env_path, "VERIFY=one\n").unwrap();
        let source="services:\n  redis:\n    image: redis:7.4\n    command: [redis-server, --appendonly, 'yes']\n    environment:\n      VERIFY: ${VERIFY}\n    volumes: [data:/data]\n    healthcheck:\n      test: [CMD, redis-cli, ping]\n      interval: 1s\n      timeout: 2s\n      retries: 30\nvolumes:\n  data: {}\n";
        let mut input = BuildInput {
            id: id.clone(),
            context: "desktop-linux".into(),
            name: id.clone(),
            files: vec![SourceFile {
                path: path.to_string_lossy().into_owned(),
                original: None,
                source: source.into(),
            }],
            profiles: vec![],
            rebuild: false,
            env: BTreeMap::new(),
        };
        let result = docker_builder_review(input.clone()).await.unwrap();
        let token = result["token"].as_str().unwrap();
        std::fs::write(&env_path, "VERIFY=two\n").unwrap();
        assert!(verified_plan(token)
            .await
            .err()
            .unwrap()
            .contains("INPUT_CHANGED"));
        let result = docker_builder_review(input.clone()).await.unwrap();
        let plan = save_plan(result["token"].as_str().unwrap()).await.unwrap();
        input = plan.input.clone();
        let files = vec![path.to_string_lossy().into_owned()];
        let run = |input: BuildInput, tail: Vec<&'static str>| async move {
            cli::execute(
                command(&input, &files_for(&input), &tail).unwrap(),
                Duration::from_secs(240),
                16 * 1024 * 1024,
            )
            .await
        };
        let outcome=async{
            let channel=tauri::ipc::Channel::new(|_|Ok(()));
            std::fs::write(&path,"services: [invalid").unwrap();
            let executed=super::super::builder_jobs::execute("native-snapshot-test",&plan,std::sync::Arc::new(tokio::sync::Notify::new()),&channel,240).await;
            std::fs::write(&path,&input.files[0].source).unwrap();
            let (state,code)=executed?;assert_eq!(state,"completed");assert_eq!(code,Some(0));
            run(input.clone(),vec!["up","--detach","--wait","--wait-timeout","90","--remove-orphans=false"]).await?;
            assert!(run(input.clone(),vec!["exec","-T","redis","redis-cli","SET","woojoo-test","retained"]).await?.contains("OK"));
            input.files[0].source=input.files[0].source.replace("VERIFY: ${VERIFY}","VERIFY: changed");
            let r=docker_builder_review(input.clone()).await?;input=save_plan(r["token"].as_str().unwrap()).await?.input;
            run(input.clone(),vec!["up","--detach","--wait","--wait-timeout","90","--remove-orphans=false"]).await?;
            assert!(run(input.clone(),vec!["exec","-T","redis","redis-cli","GET","woojoo-test"]).await?.contains("retained"));
            input.files[0].source=input.files[0].source.replace("volumes:\n  data: {}","  worker:\n    image: redis:7.4\n    command: [sh, -c, 'sleep 300']\n    depends_on:\n      redis:\n        condition: service_healthy\nvolumes:\n  data: {}");
            let r=docker_builder_review(input.clone()).await?;input=save_plan(r["token"].as_str().unwrap()).await?.input;
            run(input.clone(),vec!["up","--detach","--wait","--wait-timeout","90","--remove-orphans=false"]).await?;
            assert!(run(input.clone(),vec!["exec","-T","worker","redis-cli","-h","redis","ping"]).await?.contains("PONG"));
            input.files[0].source=input.files[0].source.replace("sleep 300","exit 2");let r=docker_builder_review(input.clone()).await?;input=save_plan(r["token"].as_str().unwrap()).await?.input;
            assert!(run(input.clone(),vec!["up","--detach","--wait","--wait-timeout","10","--remove-orphans=false"]).await.is_err());
            input.files[0].source=input.files[0].source.replace("exit 2","sleep 300");let r=docker_builder_review(input.clone()).await?;input=save_plan(r["token"].as_str().unwrap()).await?.input;
            run(input.clone(),vec!["up","--detach","--wait","--wait-timeout","30","--remove-orphans=false"]).await?;
            std::fs::write(&dockerfile,"FROM redis:7.4\nCOPY marker /marker\n").map_err(|e|e.to_string())?;
            input.files[0].source=input.files[0].source.replace("worker:\n    image: redis:7.4",&format!("worker:\n    image: {build_image}\n    build: {{context: .}}"));input.rebuild=true;
            for value in ["first-build","rebuilt-source"]{
                std::fs::write(&marker,value).map_err(|e|e.to_string())?;
                let r=docker_builder_review(input.clone()).await?;let plan=save_plan(r["token"].as_str().unwrap()).await?;input=plan.input.clone();
                let (state,code)=super::super::builder_jobs::execute("native-rebuild-test",&plan,std::sync::Arc::new(tokio::sync::Notify::new()),&channel,240).await?;
                assert_eq!((state.as_str(),code),("completed",Some(0)));
                assert_eq!(run(input.clone(),vec!["exec","-T","worker","cat","/marker"]).await?.trim(),value);
            }
            Ok::<(),String>(())
        }.await;
        let cleanup = cli::execute(
            command(&input, &files, &["down", "--volumes", "--remove-orphans"]).unwrap(),
            Duration::from_secs(60),
            1024 * 1024,
        )
        .await;
        let _ = cli::run(Some(&input.context), &["image", "rm", &build_image], 30).await;
        for f in [&path, &env_path, &dockerfile, &marker] {
            let _ = std::fs::remove_file(f);
        }
        let _ = std::fs::remove_dir(&dir);
        assert!(cleanup.is_ok(), "Test-owned cleanup failed: {cleanup:?}");
        assert!(outcome.is_ok(), "Native scenario failed: {outcome:?}");
    }
    fn files_for(input: &BuildInput) -> Vec<String> {
        input.files.iter().map(|f| f.path.clone()).collect()
    }
}
