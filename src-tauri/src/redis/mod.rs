mod connection;
mod explorer;
mod protocol;
mod queues;
mod store;
pub mod types;
mod values;
use connection::{Connection, Session};
use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
};
use types::*;
use zeroize::Zeroize;
pub struct State {
    stopping: std::sync::atomic::AtomicBool,
    connecting: tokio::sync::Semaphore,
    store: Mutex<store::Store>,
    credentials: Mutex<crate::credentials::Store>,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    requests: Mutex<HashMap<(String, String), tokio::sync::watch::Sender<bool>>>,
}
impl State {
    pub fn new(path: std::path::PathBuf) -> Result<Self, String> {
        Ok(Self {
            stopping: std::sync::atomic::AtomicBool::new(false),
            connecting: tokio::sync::Semaphore::new(8),
            store: Mutex::new(store::Store::open(path)?),
            credentials: Mutex::new(crate::credentials::Store::redis()),
            sessions: Mutex::new(HashMap::new()),
            requests: Mutex::new(HashMap::new()),
        })
    }
    pub async fn shutdown(&self) {
        self.stopping
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let mut sessions = self.sessions.lock().unwrap();
        for (_, s) in sessions.drain() {
            s.closed.send_replace(true);
        }
        for (_, cancel) in self.requests.lock().unwrap().drain() {
            cancel.send_replace(true);
        }
    }
    fn disconnect_profile(&self, id: &str) {
        self.sessions.lock().unwrap().retain(|_, s| {
            if s.profile.id == id {
                s.closed.send_replace(true);
                false
            } else {
                true
            }
        });
    }
}
struct RequestGuard<'a> {
    state: &'a State,
    key: (String, String),
}
impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        self.state.requests.lock().unwrap().remove(&self.key);
    }
}
async fn run<T, F, Fut>(state: &State, request: ReadRequest, read: F) -> Result<T, String>
where
    T: serde::Serialize,
    F: FnOnce(Connection, Arc<Session>, ReadRequest) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    if request.request_id.is_empty() || request.request_id.len() > 128 {
        return Err("INVALID_REQUEST: Request ID required".into());
    }
    let session = state
        .sessions
        .lock()
        .unwrap()
        .get(&request.session_id)
        .cloned()
        .ok_or("DISCONNECTED: Session no longer exists")?;
    let mut closed = session.closed.subscribe();
    if *closed.borrow() {
        return Err("DISCONNECTED: Session closed".into());
    }
    let key = (request.session_id.clone(), request.request_id.clone());
    let (cancel, mut cancelled) = tokio::sync::watch::channel(false);
    {
        let mut requests = state.requests.lock().unwrap();
        if requests.len() >= 16 {
            return Err("BUSY: At most 16 reads may run concurrently".into());
        }
        if requests.contains_key(&key) {
            return Err("BUSY: Duplicate active request ID".into());
        }
        requests.insert(key.clone(), cancel);
    }
    let _guard = RequestGuard { state, key };
    let operation = async {
        let connection = session.open().await?;
        read(connection, session.clone(), request).await
    };
    tokio::select! {_ = closed.changed()=>Err("DISCONNECTED: Session closed".into()),_ = cancelled.changed()=>Err("CANCELLED: Read cancelled".into()),result=tokio::time::timeout(std::time::Duration::from_secs(10),operation)=>ipc(result.map_err(|_|"TIMEOUT: Read timed out")??)}
}
#[tauri::command]
pub fn redis_workspace_load(state: tauri::State<'_, State>) -> Result<Workspace, String> {
    ipc(state.store.lock().unwrap().workspace())
}
#[tauri::command]
pub fn redis_profile_save(state: tauri::State<'_, State>, profile: Profile) -> Result<(), String> {
    state.store.lock().unwrap().save_profile(profile)
}
#[tauri::command]
pub fn redis_profile_delete(state: tauri::State<'_, State>, id: String) -> Result<(), String> {
    if !types::valid_id(&id) {
        return Err("INVALID_PROFILE: Invalid ID".into());
    }
    state.store.lock().unwrap().delete_profile(&id)?;
    let mut credentials = state.credentials.lock().unwrap();
    credentials
        .forget(&id)
        .map_err(|_| "CREDENTIAL: Could not forget Redis password".to_string())?;
    state.disconnect_profile(&id);
    Ok(())
}
#[tauri::command]
pub fn redis_view_save(state: tauri::State<'_, State>, view: SavedView) -> Result<(), String> {
    state.store.lock().unwrap().save_view(view)
}
#[tauri::command]
pub fn redis_view_delete(state: tauri::State<'_, State>, id: String) -> Result<(), String> {
    state.store.lock().unwrap().delete_view(&id)
}
#[tauri::command]
pub fn redis_forget_password(state: tauri::State<'_, State>, id: String) -> Result<(), String> {
    state
        .credentials
        .lock()
        .unwrap()
        .forget(&id)
        .map_err(|_| "CREDENTIAL: Could not forget Redis password".into())
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connected {
    session_id: String,
}
async fn connect(
    state: &State,
    profile: Profile,
    password: Option<String>,
    remember: bool,
    test: bool,
) -> Result<Option<Connected>, String> {
    let mut password = zeroize::Zeroizing::new(password);
    profile.validate()?;
    let _permit = state
        .connecting
        .try_acquire()
        .map_err(|_| "BUSY: Too many connections in progress")?;
    if state.stopping.load(std::sync::atomic::Ordering::SeqCst) {
        password.zeroize();
        return Err("DISCONNECTED: Application is closing".into());
    }
    if password.as_ref().is_some_and(|p| p.len() > 8192) {
        password.zeroize();
        return Err("TOO_LARGE: Password exceeds budget".into());
    }
    let identity = profile.identity();
    let revision;
    {
        let credentials = state.credentials.lock().unwrap();
        revision = credentials.revision(&profile.id);
        if password.is_none() {
            *password = credentials
                .resolve(&profile.id, &identity)
                .map_err(|_| "CREDENTIAL: Could not load Redis password")?;
        }
    }
    let session = Arc::new(Session::new(profile.clone(), password.take()));
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut connection = session.open().await?;
        session.topology_verified.store(
            connection.verify_topology().await?,
            std::sync::atomic::Ordering::SeqCst,
        );
        match connection.command("INFO", &[b"server"]).await {
            Ok(v) => {
                let info = v.string()?;
                if info
                    .lines()
                    .any(|line| line.trim() == "redis_mode:sentinel")
                {
                    return Err("UNSUPPORTED: Redis Sentinel is not supported".into());
                }
                if let Some(version) = info.lines().find_map(|l| l.strip_prefix("redis_version:")) {
                    let mut parts = version
                        .trim()
                        .split('.')
                        .filter_map(|p| p.parse::<u32>().ok());
                    let major = parts.next().unwrap_or(0);
                    let minor = parts.next().unwrap_or(0);
                    if major < 6 || (major == 6 && minor < 2) {
                        return Err("UNSUPPORTED: Redis 6.2 or later is required".into());
                    }
                }
            }
            Err(e) if e.starts_with("FORBIDDEN") => {}
            Err(e) => return Err(e),
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|_| "TIMEOUT: Connection timed out")??;
    if test {
        return Ok(None);
    }
    if remember && !cfg!(windows) {
        return Err("UNSUPPORTED: Password vault is only supported on Windows".into());
    }
    let mut credentials = state.credentials.lock().unwrap();
    if credentials.revision(&profile.id) != revision
        || state.stopping.load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("CANCELLED: Connection was invalidated".into());
    }
    if let Some(password) = session.password() {
        if remember {
            credentials.remember(&profile.id, identity, password, true, revision)
        } else {
            credentials.cache(&profile.id, identity, password, revision)
        }
        .map_err(|_| "CREDENTIAL: Could not save Redis password")?;
    }
    let mut sessions = state.sessions.lock().unwrap();
    if sessions.len() >= 16 {
        return Err("BUSY: At most 16 Redis sessions may be open".into());
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    sessions.insert(session_id.clone(), session);
    Ok(Some(Connected { session_id }))
}
#[tauri::command]
pub async fn redis_connect(
    state: tauri::State<'_, State>,
    profile: Profile,
    password: Option<String>,
    remember: bool,
) -> Result<Connected, String> {
    connect(&state, profile, password, remember, false)
        .await?
        .ok_or("DISCONNECTED: Connection failed".into())
}
#[tauri::command]
pub async fn redis_test_connection(
    state: tauri::State<'_, State>,
    profile: Profile,
    password: Option<String>,
) -> Result<(), String> {
    connect(&state, profile, password, false, true)
        .await
        .map(|_| ())
}
#[tauri::command]
pub fn redis_disconnect(state: tauri::State<'_, State>, session_id: String) {
    if let Some(session) = state.sessions.lock().unwrap().remove(&session_id) {
        session.closed.send_replace(true);
    }
}
#[tauri::command]
pub fn redis_cancel(state: tauri::State<'_, State>, session_id: String, request_id: String) {
    if let Some(cancel) = state
        .requests
        .lock()
        .unwrap()
        .get(&(session_id, request_id))
    {
        cancel.send_replace(true);
    }
}
#[tauri::command]
pub async fn redis_scan(
    state: tauri::State<'_, State>,
    request: ReadRequest,
) -> Result<Scan, String> {
    run(&state, request, |mut c, s, r| async move {
        explorer::scan(&mut c, &s, &r).await
    })
    .await
}
#[tauri::command]
pub async fn redis_key_metadata(
    state: tauri::State<'_, State>,
    request: ReadRequest,
) -> Result<Meta, String> {
    run(&state, request, |mut c, _, r| async move {
        explorer::metadata(&mut c, &r.key()?).await
    })
    .await
}
#[tauri::command]
pub async fn redis_read_value(
    state: tauri::State<'_, State>,
    request: ReadRequest,
) -> Result<Value, String> {
    run(&state, request, |mut c, s, r| async move {
        values::read(&mut c, &s, &r).await
    })
    .await
}
#[tauri::command]
pub async fn redis_queue_inspect(
    state: tauri::State<'_, State>,
    request: ReadRequest,
) -> Result<Queue, String> {
    run(&state, request, |mut c, _, r| async move {
        queues::inspect(&mut c, &r).await
    })
    .await
}
#[tauri::command]
pub async fn redis_server_info(
    state: tauri::State<'_, State>,
    request: ReadRequest,
) -> Result<ServerInfo, String> {
    run(&state, request, |mut c, _, _| async move {
        queues::server(&mut c).await
    })
    .await
}
#[cfg(test)]
mod tests {
    #[test]
    fn rejects_huge_bulk_header_before_reading_body() {
        assert!(super::protocol::header_length(b"999999999", 65536).is_err());
    }
    #[test]
    fn rejects_nested_array_allocation_attack() {
        assert!(super::protocol::header_length(b"999999999", 4096).is_err());
    }
    #[test]
    fn rejects_write_and_consuming_commands() {
        for name in ["SET", "DEL", "XREADGROUP", "LPOP", "XACK", "EVAL", "SELECT"] {
            assert!(!super::protocol::allowed(name));
        }
    }
    #[test]
    fn accepts_readonly_commands() {
        for name in [
            "SCAN", "TYPE", "GETRANGE", "HSCAN", "LRANGE", "SSCAN", "ZRANGE", "XRANGE", "XINFO",
            "XPENDING",
        ] {
            assert!(super::protocol::allowed(name));
        }
    }
    #[test]
    fn profile_validation_rejects_uri_and_invalid_db() {
        let mut p = super::types::Profile {
            id: "profile".into(),
            name: "Valid profile".into(),
            host: "localhost".into(),
            port: 6379,
            separator: ":".into(),
            ..Default::default()
        };
        assert!(p.validate().is_ok());
        p.host = "redis://secret@localhost".into();
        assert!(p.validate().is_err());
        p.host = "localhost".into();
        p.db = -1;
        assert!(p.validate().is_err());
    }
}

#[cfg(test)]
mod integration_tests;
