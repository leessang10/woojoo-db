use super::{
    protocol::{self, Resp},
    types::*,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
};
use zeroize::Zeroize;
trait Socket: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Socket for T {}
pub struct Connection {
    socket: Box<dyn Socket>,
}
impl Connection {
    // Fixed internal commands only: never expose arbitrary CONFIG or Pub/Sub IPC.
    pub async fn notification_config(&mut self) -> Result<String, String> {
        let values = self
            .exchange(&[
                b"CONFIG".to_vec(),
                b"GET".to_vec(),
                b"notify-keyspace-events".to_vec(),
            ])
            .await?
            .array()?;
        values
            .get(1)
            .ok_or("PROTOCOL: Missing notification configuration")?
            .string()
    }
    pub async fn subscribe_keyevents(&mut self, db: i64) -> Result<(), String> {
        self.exchange(&[
            b"PSUBSCRIBE".to_vec(),
            format!("__keyevent@{db}__:*").into_bytes(),
        ])
        .await?;
        Ok(())
    }
    pub async fn notification(&mut self) -> Result<Resp, String> {
        match protocol::read(self.socket.as_mut()).await? {
            Resp::Error(error) => Err(error),
            value => Ok(value),
        }
    }
    pub async fn verify_topology(&mut self) -> Result<bool, String> {
        match self.command("INFO", &[b"cluster"]).await {
            Ok(v) => {
                let info = v.string()?;
                if info.lines().any(|l| l.trim() == "cluster_enabled:1") {
                    return Err("UNSUPPORTED: Redis Cluster is not supported".into());
                }
                if info.lines().any(|l| l.trim() == "cluster_enabled:0") {
                    return Ok(true);
                }
            }
            Err(e) if e.starts_with("FORBIDDEN") => {}
            Err(e) => return Err(e),
        }
        // This exact internal capability probe is never exposed through command IPC.
        match self
            .exchange(&[b"CLUSTER".to_vec(), b"INFO".to_vec()])
            .await
        {
            Ok(_) => Err("UNSUPPORTED: Redis Cluster is not supported".into()),
            Err(e) if e.starts_with("STANDALONE") => Ok(true),
            Err(e) if e.starts_with("FORBIDDEN") => Ok(false),
            Err(e) => Err(e),
        }
    }
    pub async fn open(profile: &Profile, password: Option<&str>) -> Result<Self, String> {
        let tcp = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            TcpStream::connect((profile.host.as_str(), profile.port)),
        )
        .await
        .map_err(|_| "TIMEOUT: Connection timed out")?
        .map_err(|_| "DISCONNECTED: Could not reach Redis")?;
        let _ = tcp.set_nodelay(true);
        let socket: Box<dyn Socket> = if profile.tls {
            use tokio_rustls::rustls;
            let roots =
                rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let config = rustls::ClientConfig::builder_with_provider(Arc::new(
                rustls::crypto::ring::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .map_err(|_| "TLS_FAILED: TLS configuration failed")?
            .with_root_certificates(roots)
            .with_no_client_auth();
            let name = rustls::pki_types::ServerName::try_from(profile.host.clone())
                .map_err(|_| "TLS_FAILED: Invalid TLS server name")?;
            let stream = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                tokio_rustls::TlsConnector::from(Arc::new(config)).connect(name, tcp),
            )
            .await
            .map_err(|_| "TIMEOUT: TLS handshake timed out")?
            .map_err(|_| "TLS_FAILED: Certificate or TLS handshake validation failed")?;
            Box::new(stream)
        } else {
            Box::new(tcp)
        };
        let mut c = Self { socket };
        if let Some(p) = password.filter(|s| !s.is_empty() || !profile.username.is_empty()) {
            let mut args = zeroize::Zeroizing::new(vec![b"AUTH".to_vec()]);
            if !profile.username.is_empty() {
                args.push(profile.username.as_bytes().to_vec())
            }
            args.push(p.as_bytes().to_vec());
            let result = c.exchange(&args).await;
            for arg in args.iter_mut() {
                arg.zeroize()
            }
            result?;
        } else if !profile.username.is_empty() {
            return Err("AUTH_FAILED: Password required for ACL user".into());
        }
        // No mutable shared connection: SELECT happens once on this operation's socket.
        match c
            .exchange(&[b"SELECT".to_vec(), profile.db.to_string().into_bytes()])
            .await
        {
            Err(e) if profile.db == 0 && e.starts_with("FORBIDDEN") => {}
            result => {
                result?;
            }
        }
        Ok(c)
    }
    async fn exchange(&mut self, args: &[Vec<u8>]) -> Result<Resp, String> {
        protocol::send(self.socket.as_mut(), args).await?;
        match protocol::read(self.socket.as_mut()).await? {
            Resp::Error(e) => Err(e),
            v => Ok(v),
        }
    }
    pub async fn command(&mut self, name: &str, args: &[&[u8]]) -> Result<Resp, String> {
        if !protocol::allowed(name) {
            return Err("FORBIDDEN: Command is not an allowed read".into());
        }
        let mut all = vec![name.as_bytes().to_vec()];
        all.extend(args.iter().map(|a| a.to_vec()));
        self.exchange(&all).await
    }
    pub async fn pipeline(
        &mut self,
        commands: Vec<Vec<Vec<u8>>>,
    ) -> Result<Vec<Result<Resp, String>>, String> {
        if commands.len() > 50 {
            return Err("TOO_LARGE: Metadata batch exceeds 50 keys".into());
        }
        for args in &commands {
            if !args
                .first()
                .and_then(|v| std::str::from_utf8(v).ok())
                .is_some_and(protocol::allowed)
            {
                return Err("FORBIDDEN: Command is not an allowed read".into());
            }
            protocol::send(self.socket.as_mut(), args).await?;
        }
        let mut results = Vec::new();
        for _ in commands {
            results.push(match protocol::read(self.socket.as_mut()).await? {
                Resp::Error(e) => Err(e),
                v => Ok(v),
            })
        }
        Ok(results)
    }
}
struct CursorEntry {
    scope: String,
    raw: String,
    generation: u64,
    touched: u64,
    buffer: Vec<Resp>,
}
pub struct Session {
    pub notifications: Mutex<Option<super::notifications::Subscription>>,
    cursor_generation: std::sync::atomic::AtomicU64,
    pub topology_verified: std::sync::atomic::AtomicBool,
    pub profile: Profile,
    password: Option<String>,
    pub closed: tokio::sync::watch::Sender<bool>,
    cursors: Mutex<HashMap<String, CursorEntry>>,
}
impl Drop for Session {
    fn drop(&mut self) {
        if let Some(p) = &mut self.password {
            p.zeroize()
        }
    }
}
impl Session {
    pub fn new(profile: Profile, password: Option<String>) -> Self {
        let (closed, _) = tokio::sync::watch::channel(false);
        Self {
            notifications: Mutex::new(None),
            cursor_generation: std::sync::atomic::AtomicU64::new(0),
            topology_verified: std::sync::atomic::AtomicBool::new(false),
            profile,
            password,
            closed,
            cursors: Mutex::new(HashMap::new()),
        }
    }
    pub fn password(&self) -> Option<&str> {
        self.password.as_deref()
    }
    pub async fn open(&self) -> Result<Connection, String> {
        Connection::open(&self.profile, self.password.as_deref()).await
    }
    fn scope(r: &ReadRequest, kind: &str) -> String {
        serde_json::json!([kind, r.generation, r.key_base64, r.pattern, r.type_filter]).to_string()
    }
    pub fn cursor(&self, r: &ReadRequest, kind: &str) -> Result<String, String> {
        match r.cursor.as_deref() {
            None | Some("0") | Some("") => Ok(r.offset.clone().unwrap_or_else(|| "0".into())),
            Some(token) => {
                let mut cursors = self.cursors.lock().unwrap();
                let e = cursors
                    .get_mut(token)
                    .filter(|e| e.scope == Self::scope(r, kind))
                    .ok_or("INVALID_CURSOR: Cursor does not belong to this query")?;
                e.touched = now();
                Ok(e.raw.clone())
            }
        }
    }
    pub fn page(&self, r: &ReadRequest) -> Result<Option<Vec<Resp>>, String> {
        let Some(token) = r.cursor.as_deref().filter(|v| *v != "0" && !v.is_empty()) else {
            return Ok(None);
        };
        let mut cursors = self.cursors.lock().unwrap();
        let e = cursors
            .get_mut(token)
            .filter(|e| e.scope == Self::scope(r, "value"))
            .ok_or("INVALID_CURSOR: Cursor does not belong to this query")?;
        e.touched = now();
        Ok((!e.buffer.is_empty()).then(|| e.buffer.clone()))
    }
    pub fn next(&self, r: &ReadRequest, kind: &str, raw: String) -> Result<String, String> {
        if raw == "0" {
            return Ok(raw);
        }
        self.save_cursor(r, kind, raw, vec![])
    }
    pub fn buffer_page(
        &self,
        r: &ReadRequest,
        raw: String,
        buffer: Vec<Resp>,
    ) -> Result<String, String> {
        self.save_cursor(r, "value", raw, buffer)
    }
    fn save_cursor(
        &self,
        r: &ReadRequest,
        kind: &str,
        raw: String,
        buffer: Vec<Resp>,
    ) -> Result<String, String> {
        let scope = Self::scope(r, kind);
        let mut cursors = self.cursors.lock().unwrap();
        if r.generation
            < self
                .cursor_generation
                .load(std::sync::atomic::Ordering::Relaxed)
        {
            return Err("CANCELLED: Query generation is outdated".into());
        }
        self.cursor_generation
            .store(r.generation, std::sync::atomic::Ordering::Relaxed);
        cursors.retain(|_, e| e.generation == r.generation);
        if buffer.is_empty() {
            if let Some((token, e)) = cursors
                .iter_mut()
                .find(|(_, e)| e.scope == scope && e.raw == raw && e.buffer.is_empty())
            {
                e.touched = now();
                return Ok(token.clone());
            }
        }
        // Each buffered RESP response is bounded to 1 MiB by the parser. Keep at most
        // four per session and 128 cursor tokens, evicting least recently used pages.
        if !buffer.is_empty() && cursors.values().filter(|e| !e.buffer.is_empty()).count() >= 4 {
            if let Some(old) = cursors
                .iter()
                .filter(|(_, e)| !e.buffer.is_empty())
                .min_by_key(|(_, e)| e.touched)
                .map(|(k, _)| k.clone())
            {
                cursors.remove(&old);
            }
        }
        if cursors.len() >= 128 {
            if let Some(old) = cursors
                .iter()
                .min_by_key(|(_, e)| e.touched)
                .map(|(k, _)| k.clone())
            {
                cursors.remove(&old);
            }
        }
        let token = uuid::Uuid::new_v4().to_string();
        cursors.insert(
            token.clone(),
            CursorEntry {
                scope,
                raw,
                generation: r.generation,
                touched: now(),
                buffer,
            },
        );
        Ok(token)
    }
}

#[cfg(test)]
mod cursor_tests {
    use super::*;
    fn request() -> ReadRequest {
        ReadRequest {
            session_id: "s".into(),
            request_id: "r".into(),
            generation: 1,
            key_base64: None,
            pattern: None,
            type_filter: None,
            cursor: None,
            offset: None,
            group: None,
        }
    }
    #[test]
    fn repeated_refresh_does_not_exhaust_cursor_budget() {
        let s = Session::new(Profile::default(), None);
        let r = request();
        for _ in 0..2000 {
            assert!(s.next(&r, "value", "100".into()).is_ok())
        }
    }
    #[test]
    fn cursor_cannot_cross_generation_or_key() {
        let s = Session::new(Profile::default(), None);
        let mut r = request();
        r.cursor = Some(s.next(&r, "value", "100".into()).unwrap());
        assert_eq!(s.cursor(&r, "value").unwrap(), "100");
        r.generation = 2;
        assert!(s.cursor(&r, "value").is_err());
    }
}

#[cfg(test)]
mod generation_race_tests {
    use super::*;
    #[test]
    fn late_old_generation_cannot_evict_new_cursor() {
        let s = Session::new(Profile::default(), None);
        let mut newer = ReadRequest {
            session_id: "s".into(),
            request_id: "r".into(),
            generation: 2,
            key_base64: None,
            pattern: None,
            type_filter: None,
            cursor: None,
            offset: None,
            group: None,
        };
        let token = s.next(&newer, "scan", "200".into()).unwrap();
        let mut old = newer.clone();
        old.generation = 1;
        let stale = s.next(&old, "scan", "100".into());
        newer.cursor = Some(token);
        assert_eq!(s.cursor(&newer, "scan").unwrap(), "200");
        assert!(stale.is_err());
    }
}
