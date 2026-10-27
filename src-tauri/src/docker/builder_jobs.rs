use super::builder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};
use tauri::{ipc::Channel, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Notify,
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: String,
    pub context: String,
    pub project: String,
    pub fingerprint: String,
    pub state: String,
    pub started: u64,
    pub finished: Option<u64>,
    pub code: Option<i32>,
    #[serde(skip)]
    pub lines: Vec<String>,
}
struct Job {
    op: Operation,
    cancel: Arc<Notify>,
}
static JOBS: LazyLock<Mutex<HashMap<String, Job>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
fn persist(app: &tauri::AppHandle) {
    if let (Ok(dir), Ok(jobs)) = (app.path().app_data_dir(), JOBS.lock()) {
        let ops = jobs.values().map(|j| &j.op).collect::<Vec<_>>();
        if let Ok(bytes) = serde_json::to_vec(&ops) {
            let _ =
                super::compose::atomic_write(&dir.join("docker-builder-operations.json"), &bytes);
        }
    }
}
pub fn busy() -> bool {
    JOBS.lock()
        .map(|jobs| jobs.values().any(|j| j.op.state == "running"))
        .unwrap_or(true)
}
pub fn redact(line: &str, values: &[String]) -> String {
    let mut out = line.to_owned();
    for value in values {
        if !value.is_empty() {
            out = out.replace(value, "••••")
        }
    }
    out.chars().take(4096).collect()
}
fn secrets(model: &Value) -> Vec<String> {
    let mut values = vec![];
    for s in model["services"]
        .as_object()
        .into_iter()
        .flat_map(|s| s.values())
    {
        for env in [&s["environment"], &s["build"]["args"]] {
            for v in env.as_object().into_iter().flat_map(|e| e.values()) {
                if let Some(s) = v.as_str() {
                    if s.len() >= 3 {
                        values.push(s.to_owned())
                    }
                }
            }
        }
    }
    values.sort_by_key(|s| std::cmp::Reverse(s.len()));
    values.dedup();
    values
}
fn emit(id: &str, line: String, channel: &Channel<Value>) {
    if let Ok(mut jobs) = JOBS.lock() {
        if let Some(j) = jobs.get_mut(id) {
            j.op.lines.push(line.clone());
            if j.op.lines.len() > 2000 {
                j.op.lines.drain(..500);
            }
        }
    }
    let _ = channel.send(json!({"id":id,"line":line}));
}
async fn kill_tree(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let mut c = tokio::process::Command::new("taskkill.exe");
        c.args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x08000000);
        let _ = tokio::time::timeout(Duration::from_secs(5), c.output()).await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}
async fn output<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    id: &str,
    channel: &Channel<Value>,
    values: &[String],
) {
    let mut buf = [0u8; 4096];
    let mut pending = VecDeque::new();
    let mut oversized = false;
    loop {
        match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                for b in &buf[..n] {
                    if !oversized {
                        pending.push_back(*b);
                    }
                    if pending.len() > 8192 {
                        pending.clear();
                        oversized = true;
                    }
                    if *b == b'\n' || *b == b'\r' {
                        if oversized {
                            emit(
                                id,
                                "[Oversized output line omitted / 긴 출력 줄 생략]".into(),
                                channel,
                            );
                            oversized = false;
                            continue;
                        }
                        let raw = pending.drain(..).collect::<Vec<_>>();
                        emit(
                            id,
                            redact(String::from_utf8_lossy(&raw).trim_end(), values),
                            channel,
                        );
                    }
                }
            }
        }
    }
    if oversized {
        emit(
            id,
            "[Oversized output line omitted / 긴 출력 줄 생략]".into(),
            channel,
        );
    }
    if !pending.is_empty() {
        emit(
            id,
            redact(
                &String::from_utf8_lossy(&pending.into_iter().collect::<Vec<_>>()),
                values,
            ),
            channel,
        );
    }
}
pub(super) async fn execute(
    id: &str,
    plan: &builder::Plan,
    cancel: Arc<Notify>,
    channel: &Channel<Value>,
    seconds: u64,
) -> Result<(String, Option<i32>), String> {
    let _operation = super::storage::operation().await?;
    // Execute the reviewed, normalized model through stdin. Editing a source
    // file after review cannot change the service configuration being applied.
    // Build context and mounted file contents remain external mutable inputs.
    let files = vec!["-".to_owned()];
    let mut tail = vec!["up", "--detach", "--remove-orphans=false"];
    if plan.input.rebuild {
        tail.push("--build");
    }
    let mut child = builder::command(&plan.input, &files, &tail)?
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().ok_or("Missing stdin")?;
    let bytes = serde_json::to_vec(&plan.model).map_err(|e| e.to_string())?;
    let values = secrets(&plan.model);
    let stdout = child.stdout.take().ok_or("Missing stdout")?;
    let stderr = child.stderr.take().ok_or("Missing stderr")?;
    let io = async {
        tokio::join!(
            output(stdout, &id, &channel, &values),
            output(stderr, &id, &channel, &values)
        );
    };
    let send = async {
        let result = stdin.write_all(&bytes).await;
        drop(stdin);
        result.map_err(|e| e.to_string())
    };
    // Drain output while sending the model; cancellation/timeout covers stdin too.
    let wait = async {
        let (_, sent, status) = tokio::join!(io, send, child.wait());
        sent?;
        status.map_err(|e| e.to_string())
    };
    let result = tokio::select! {r=wait=>r.map(|s|("finished".to_owned(),s.code())),_=cancel.notified()=>Err("cancelled".into()),_=tokio::time::sleep(Duration::from_secs(seconds))=>Err("timeout".into())};
    match result {
        Ok((_, Some(0))) => Ok(("completed".to_owned(), Some(0))),
        Ok((_, code)) => Ok(("failed".to_owned(), code)),
        Err(e) => {
            kill_tree(&mut child).await;
            emit(
                &id,
                format!("{e}: CLI stopped; daemon state must be reconciled / 실제 상태 확인 필요"),
                &channel,
            );
            Ok(("unknown".to_owned(), None))
        }
    }
}
async fn run(
    app: tauri::AppHandle,
    id: String,
    plan: builder::Plan,
    cancel: Arc<Notify>,
    channel: Channel<Value>,
    seconds: u64,
) {
    let work = execute(&id, &plan, cancel, &channel, seconds).await;
    let (state, code) = match work {
        Ok(result) => result,
        Err(e) => {
            emit(&id, e, &channel);
            ("failed".into(), None)
        }
    };
    if let Ok(mut jobs) = JOBS.lock() {
        if let Some(j) = jobs.get_mut(&id) {
            j.op.state = state.clone();
            j.op.finished = Some(builder::now());
            j.op.code = code;
        }
    }
    persist(&app);
    let _ = channel.send(json!({"id":id,"state":state,"code":code}));
}
#[tauri::command]
pub async fn docker_builder_start(
    app: tauri::AppHandle,
    token: String,
    seconds: u64,
    on_event: Channel<Value>,
) -> Result<Operation, String> {
    if !(30..=86400).contains(&seconds) {
        return Err("Timeout must be 30–86400 seconds".into());
    }
    let plan = builder::verified_plan(&token).await?;
    // Reserve the context/project before the second validation and disk write.
    let id = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(Notify::new());
    let op = Operation {
        id: id.clone(),
        context: plan.input.context.clone(),
        project: plan.input.name.clone(),
        fingerprint: builder::plan_fingerprint(&plan),
        state: "running".into(),
        started: builder::now(),
        finished: None,
        code: None,
        lines: vec![],
    };
    {
        let mut jobs = JOBS.lock().map_err(|_| "Job storage unavailable")?;
        if jobs.values().any(|j| {
            j.op.state == "running" && j.op.context == op.context && j.op.project == op.project
        }) {
            return Err("Project operation already running".into());
        }
        if jobs.len() > 100 {
            jobs.retain(|_, j| j.op.state == "running");
        }
        jobs.insert(
            id.clone(),
            Job {
                op: op.clone(),
                cancel: cancel.clone(),
            },
        );
    }
    let saved = match builder::save_plan(&token).await {
        Ok(p) => p,
        Err(e) => {
            JOBS.lock().map_err(|_| "Job unavailable")?.remove(&id);
            return Err(e);
        }
    };
    persist(&app);
    tauri::async_runtime::spawn(run(app, id, saved, cancel, on_event, seconds));
    Ok(op)
}
#[tauri::command]
pub async fn docker_builder_cancel(id: String) -> Result<(), String> {
    let jobs = JOBS.lock().map_err(|_| "Job unavailable")?;
    let job = jobs.get(&id).ok_or("Job not found")?;
    job.cancel.notify_one();
    Ok(())
}
#[tauri::command]
pub async fn docker_builder_operations(app: tauri::AppHandle) -> Result<Value, String> {
    let mut jobs = JOBS.lock().map_err(|_| "Job unavailable")?;
    if jobs.is_empty() {
        let file = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("docker-builder-operations.json");
        if let Ok(raw) = std::fs::read(file) {
            if let Ok(saved) = serde_json::from_slice::<Vec<Operation>>(&raw) {
                for mut op in saved {
                    if op.state == "running" {
                        op.state = "unknown".into();
                    }
                    jobs.insert(
                        op.id.clone(),
                        Job {
                            op,
                            cancel: Arc::new(Notify::new()),
                        },
                    );
                }
            }
        }
    }
    Ok(json!(jobs
        .values()
        .map(|j| {
            let mut v = serde_json::to_value(&j.op).unwrap_or_default();
            v["lines"] = json!(j.op.lines);
            v
        })
        .collect::<Vec<_>>()))
}
pub async fn shutdown() {
    if let Ok(jobs) = JOBS.lock() {
        for job in jobs.values() {
            if job.op.state == "running" {
                job.cancel.notify_one();
            }
        }
    }
    for _ in 0..80 {
        if !busy() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_metadata_has_no_output_or_source() {
        let op = Operation {
            id: "1".into(),
            context: "local".into(),
            project: "test".into(),
            fingerprint: "abc".into(),
            state: "running".into(),
            started: 1,
            finished: None,
            code: None,
            lines: vec!["secret-output".into()],
        };
        let raw = serde_json::to_string(&op).unwrap();
        assert!(!raw.contains("secret-output"));
        assert!(!raw.contains("lines"));
    }
    #[test]
    fn known_values_are_masked_and_output_is_bounded() {
        assert_eq!(redact("token=abc123", &["abc123".into()]), "token=••••");
        assert!(redact(&"x".repeat(10000), &[]).len() <= 4096);
    }
    #[tokio::test]
    async fn oversized_output_cannot_leak_a_secret_suffix_across_chunks() {
        let messages = Arc::new(Mutex::new(Vec::<String>::new()));
        let captured = messages.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(raw) = body {
                captured.lock().unwrap().push(raw);
            }
            Ok(())
        });
        let raw = format!("{}sensitive-password\n", "x".repeat(8188));
        output(
            raw.as_bytes(),
            "test",
            &channel,
            &["sensitive-password".into()],
        )
        .await;
        let output = messages.lock().unwrap().join("\n");
        assert!(!output.contains("tive-password"));
    }
}
