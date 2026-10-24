use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub db: i64,
    pub tls: bool,
    pub environment: String,
    pub separator: String,
}
impl Profile {
    pub fn validate(&self) -> Result<(), String> {
        if !valid_id(&self.id)
            || self.name.trim().is_empty()
            || self.name.len() > 256
            || self.host.is_empty()
            || self.host.len() > 253
            || self.host.contains(['/', '@', ':', '\\'])
                && self.host.parse::<std::net::Ipv6Addr>().is_err()
            || self
                .host
                .chars()
                .any(|c| c.is_whitespace() || c.is_control())
            || self.port == 0
            || !(0..=2147483647).contains(&self.db)
            || self.username.len() > 1024
            || self.environment.len() > 256
            || self.separator.is_empty()
            || self.separator.len() > 16
        {
            return Err("INVALID_PROFILE: Check profile fields".into());
        }
        Ok(())
    }
    pub fn identity(&self) -> crate::credentials::Identity {
        crate::credentials::Identity {
            engine: "redis".into(),
            host: self.host.clone(),
            port: self.port,
            database: self.db.to_string(),
            username: self.username.clone(),
            tls: self.tls,
        }
    }
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedView {
    pub id: String,
    pub profile_id: String,
    pub db: i64,
    pub name: String,
    pub kind: String,
    pub pattern: String,
    pub key_base64: String,
    pub direction: String,
}
impl SavedView {
    pub fn validate(&self) -> Result<(), String> {
        if !valid_id(&self.id)
            || !valid_id(&self.profile_id)
            || self.db < 0
            || self.name.is_empty()
            || self.name.len() > 256
            || !["cache", "list", "stream", "favorite"].contains(&self.kind.as_str())
            || !["unknown", "left", "right"].contains(&self.direction.as_str())
            || self.pattern.len() > 4096
        {
            return Err("INVALID_VIEW: Check view fields".into());
        }
        decode_key(&self.key_base64)?;
        Ok(())
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub profiles: Vec<Profile>,
    pub views: Vec<SavedView>,
    pub credential_supported: bool,
}
#[derive(Clone, Serialize)]
pub struct Bytes {
    pub base64: String,
    pub text: String,
    pub utf8: bool,
}
impl Bytes {
    pub fn new(raw: &[u8]) -> Self {
        Self {
            base64: STANDARD.encode(raw),
            text: String::from_utf8_lossy(raw).into_owned(),
            utf8: std::str::from_utf8(raw).is_ok(),
        }
    }
}
pub fn decode_key(s: &str) -> Result<Vec<u8>, String> {
    if s.len() > 87384 {
        return Err("TOO_LARGE: Key exceeds 64 KiB".into());
    }
    let raw = STANDARD
        .decode(s)
        .map_err(|_| "INVALID_KEY: Invalid base64".to_string())?;
    if raw.len() > 65536 {
        return Err("TOO_LARGE: Key exceeds 64 KiB".into());
    }
    Ok(raw)
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub key: Bytes,
    pub r#type: String,
    pub ttl_ms: Option<String>,
    pub length: Option<String>,
    pub error: Option<String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadRequest {
    pub session_id: String,
    pub request_id: String,
    pub generation: u64,
    pub key_base64: Option<String>,
    pub pattern: Option<String>,
    pub type_filter: Option<String>,
    pub cursor: Option<String>,
    pub offset: Option<String>,
    pub group: Option<String>,
}
impl ReadRequest {
    pub fn key(&self) -> Result<Vec<u8>, String> {
        decode_key(
            self.key_base64
                .as_deref()
                .ok_or("INVALID_KEY: Key required")?,
        )
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub topology_verified: bool,
    pub keys: Vec<Meta>,
    pub next_cursor: String,
    pub observed_at: u64,
    pub partial: bool,
    pub db_size: Option<String>,
}
#[derive(Serialize)]
pub struct Row {
    pub id: String,
    pub cells: Vec<Bytes>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Value {
    pub key: Bytes,
    pub r#type: String,
    pub length: Option<String>,
    pub ttl_ms: Option<String>,
    pub rows: Vec<Row>,
    pub text: Option<Bytes>,
    pub next_cursor: Option<String>,
    pub observed_at: u64,
    pub truncated: bool,
}
#[derive(Serialize)]
pub struct Group {
    pub name: String,
    pub pending: String,
    pub consumers: String,
    pub lag: Option<String>,
}
#[derive(Serialize)]
pub struct Consumer {
    pub name: String,
    pub pending: String,
    pub idle: String,
}
#[derive(Serialize)]
pub struct Pending {
    pub id: String,
    pub consumer: String,
    pub idle: String,
    pub deliveries: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Queue {
    pub groups: Vec<Group>,
    pub consumers: Vec<Consumer>,
    pub pending: Vec<Pending>,
    pub errors: Vec<String>,
    pub observed_at: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub info: Option<String>,
    pub db_size: Option<String>,
    pub errors: Vec<String>,
}
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn ipc<T: Serialize>(value: T) -> Result<T, String> {
    let n = serde_json::to_vec(&value)
        .map_err(|_| "PROTOCOL: Could not encode response".to_string())?
        .len();
    if n > 2 * 1024 * 1024 {
        Err("TOO_LARGE: Response exceeds IPC budget".into())
    } else {
        Ok(value)
    }
}
