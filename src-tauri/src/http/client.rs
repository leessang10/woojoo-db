//! Sends one HTTP request from the desktop process (no browser CORS rules) and
//! records it in the local history. The UI resolves variables before sending.
use super::store::{Sent, Store};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::oneshot;

/// Responses larger than this are cut; the UI says so instead of freezing.
const BODY_LIMIT: usize = 20 * 1024 * 1024;
/// History keeps a shorter copy of each response body.
const HISTORY_BODY_LIMIT: usize = 512 * 1024;
const FILE_LIMIT: u64 = 100 * 1024 * 1024;
static RUNNING: LazyLock<Mutex<HashMap<String, oneshot::Sender<()>>>> = LazyLock::new(Default::default);
/// One client per option pair, so connections are reused between sends.
static CLIENTS: LazyLock<Mutex<HashMap<(bool, bool), reqwest::Client>>> = LazyLock::new(Default::default);

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Body {
    None,
    Text { text: String },
    Multipart { parts: Vec<Part> },
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    name: String,
    value: String,
    /// When set, `value` is a local file path sent as the part's content.
    #[serde(default)]
    file: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outgoing {
    request_id: Option<String>,
    #[serde(default)]
    name: String,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Body,
    timeout_ms: u64,
    follow_redirects: bool,
    verify_tls: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    status: u16,
    status_text: String,
    version: String,
    url: String,
    headers: Vec<(String, String)>,
    /// UTF-8 text, or base64 when the body is not valid UTF-8.
    body: String,
    base64: bool,
    size: usize,
    truncated: bool,
    duration_ms: i64,
    history_id: Option<String>,
}

fn client(follow: bool, verify: bool) -> Result<reqwest::Client, String> {
    let mut clients = CLIENTS.lock().unwrap();
    if let Some(client) = clients.get(&(follow, verify)) { return Ok(client.clone()); }
    let client = reqwest::Client::builder()
        .redirect(if follow { reqwest::redirect::Policy::limited(10) } else { reqwest::redirect::Policy::none() })
        .danger_accept_invalid_certs(!verify)
        .connect_timeout(Duration::from_secs(15))
        .build().map_err(|e| e.to_string())?;
    clients.insert((follow, verify), client.clone());
    Ok(client)
}
fn method(value: &str) -> Result<reqwest::Method, String> {
    let value = value.trim().to_ascii_uppercase();
    if value.is_empty() || value.len() > 32 { return Err("HTTP 메서드를 확인하세요.".into()); }
    reqwest::Method::from_bytes(value.as_bytes()).map_err(|_| "HTTP 메서드를 확인하세요.".into())
}
fn url(value: &str) -> Result<reqwest::Url, String> {
    let value = value.trim();
    // Like other API clients, a bare host means http://.
    let value = if value.contains("://") { value.to_string() } else { format!("http://{value}") };
    let parsed = reqwest::Url::parse(&value).map_err(|_| "URL을 확인하세요.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") { return Err("http 또는 https URL만 보낼 수 있습니다.".into()); }
    Ok(parsed)
}
/// Turns reqwest's chained errors into one readable line.
fn describe(error: &reqwest::Error) -> String {
    if error.is_timeout() { return "요청 시간이 초과되었습니다.".into(); }
    let mut text = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source { text = format!("{text}: {cause}"); source = cause.source(); }
    text
}
async fn multipart(parts: &[Part]) -> Result<reqwest::multipart::Form, String> {
    let mut form = reqwest::multipart::Form::new();
    for part in parts {
        if !part.file { form = form.text(part.name.clone(), part.value.clone()); continue; }
        let path = std::path::Path::new(&part.value);
        let size = tokio::fs::metadata(path).await.map_err(|_| format!("파일을 읽을 수 없습니다: {}", part.value))?.len();
        if size > FILE_LIMIT { return Err(format!("100 MB보다 큰 파일은 보낼 수 없습니다: {}", part.value)); }
        let data = tokio::fs::read(path).await.map_err(|_| format!("파일을 읽을 수 없습니다: {}", part.value))?;
        let file_name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        form = form.part(part.name.clone(), reqwest::multipart::Part::bytes(data).file_name(file_name));
    }
    Ok(form)
}

async fn send(outgoing: &Outgoing) -> Result<Response, String> {
    let target = url(&outgoing.url)?;
    let mut request = client(outgoing.follow_redirects, outgoing.verify_tls)?
        .request(method(&outgoing.method)?, target)
        .timeout(Duration::from_millis(outgoing.timeout_ms.clamp(1_000, 600_000)));
    let mut has_agent = false;
    for (name, value) in &outgoing.headers {
        if name.trim().is_empty() { continue; }
        has_agent |= name.trim().eq_ignore_ascii_case("user-agent");
        let name = reqwest::header::HeaderName::from_bytes(name.trim().as_bytes()).map_err(|_| format!("헤더 이름을 확인하세요: {name}"))?;
        let value = reqwest::header::HeaderValue::from_str(value).map_err(|_| format!("헤더 값을 확인하세요: {name}"))?;
        request = request.header(name, value);
    }
    if !has_agent { request = request.header(reqwest::header::USER_AGENT, concat!("Woojoo/", env!("CARGO_PKG_VERSION"))); }
    request = match &outgoing.body {
        Body::None => request,
        Body::Text { text } => request.body(text.clone()),
        Body::Multipart { parts } => request.multipart(multipart(parts).await?),
    };
    let started = Instant::now();
    let mut response = request.send().await.map_err(|e| describe(&e))?;
    let status = response.status();
    let version = format!("{:?}", response.version());
    let final_url = response.url().to_string();
    let headers = response.headers().iter().map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned())).collect();
    let mut data = Vec::new();
    let mut size = 0;
    while let Some(chunk) = response.chunk().await.map_err(|e| describe(&e))? {
        size += chunk.len();
        if data.len() < BODY_LIMIT { data.extend_from_slice(&chunk[..chunk.len().min(BODY_LIMIT - data.len())]); }
    }
    let duration_ms = started.elapsed().as_millis() as i64;
    let truncated = size > data.len();
    let (body, base64) = match String::from_utf8(data) {
        Ok(text) => (text, false),
        // A cut can split a UTF-8 character; keep the text readable.
        Err(error) if truncated && error.utf8_error().error_len().is_none() => {
            let valid = error.utf8_error().valid_up_to();
            let mut bytes = error.into_bytes(); bytes.truncate(valid);
            (String::from_utf8(bytes).unwrap_or_default(), false)
        }
        Err(error) => (base64::engine::general_purpose::STANDARD.encode(error.into_bytes()), true),
    };
    Ok(Response {
        status: status.as_u16(), status_text: status.canonical_reason().unwrap_or("").into(), version, url: final_url,
        headers, body, base64, size, truncated, duration_ms, history_id: None,
    })
}
/// A response copy small enough for the history table.
fn for_history(response: &Response) -> Value {
    let cut = response.body.len() > HISTORY_BODY_LIMIT;
    let body = if cut {
        let mut end = HISTORY_BODY_LIMIT;
        while !response.body.is_char_boundary(end) { end -= 1; }
        &response.body[..end]
    } else { &response.body };
    json!({
        "status": response.status, "statusText": response.status_text, "version": response.version, "url": response.url,
        "headers": response.headers, "body": body, "base64": response.base64, "size": response.size,
        "truncated": response.truncated || cut, "durationMs": response.duration_ms,
    })
}

#[tauri::command]
pub async fn http_send(store: tauri::State<'_, Store>, request: Outgoing, ticket: String) -> Result<Response, String> {
    let (tx, rx) = oneshot::channel();
    RUNNING.lock().unwrap().insert(ticket.clone(), tx);
    let started = Instant::now();
    let result = tokio::select! {
        result = send(&request) => result,
        _ = rx => Err("HTTP_CANCELLED".into()),
    };
    RUNNING.lock().unwrap().remove(&ticket);
    if matches!(&result, Err(error) if error == "HTTP_CANCELLED") { return result; }
    let sent = serde_json::to_value(&request).unwrap_or(Value::Null);
    let response = result.as_ref().ok().map(for_history);
    let recorded = store.record(Sent {
        request_id: request.request_id.as_deref(), name: &request.name, method: &request.method.trim().to_ascii_uppercase(), url: request.url.trim(),
        status: result.as_ref().ok().map(|r| r.status),
        duration_ms: result.as_ref().map(|r| r.duration_ms).unwrap_or_else(|_| started.elapsed().as_millis() as i64),
        size: result.as_ref().map(|r| r.size as i64).unwrap_or(0), error: result.as_ref().err().map(String::as_str),
        request: &sent, response: response.as_ref(),
    }).await.ok();
    result.map(|response| Response { history_id: recorded, ..response })
}
#[tauri::command]
pub fn http_cancel(ticket: String) {
    if let Some(cancel) = RUNNING.lock().unwrap().remove(&ticket) { let _ = cancel.send(()); }
}
#[tauri::command]
pub async fn http_pick_file() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new().pick_file().map(|path| path.to_string_lossy().into_owned()))
        .await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};

    #[test]
    fn validates_methods_and_urls() {
        assert_eq!(method(" patch ").unwrap(), reqwest::Method::PATCH);
        assert!(method("BAD METHOD").is_err());
        assert_eq!(url("localhost:8080/health").unwrap().as_str(), "http://localhost:8080/health");
        assert!(url("file:///etc/passwd").is_err());
    }

    #[tokio::test]
    async fn sends_headers_and_body_and_reads_the_response() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = vec![0; 4096];
            let read = socket.read(&mut buffer).await.unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
            socket.write_all(b"HTTP/1.1 201 Created\r\ncontent-type: application/json\r\nx-trace: abc\r\ncontent-length: 11\r\nconnection: close\r\n\r\n{\"ok\":true}").await.unwrap();
            request
        });
        let response = send(&Outgoing {
            request_id: None, name: String::new(), method: "post".into(), url: format!("http://{address}/users?page=1"),
            headers: vec![("X-Token".into(), "secret".into()), ("".into(), "ignored".into())],
            body: Body::Text { text: "{\"name\":\"woojoo\"}".into() }, timeout_ms: 5_000, follow_redirects: true, verify_tls: true,
        }).await.unwrap();
        let request = server.await.unwrap();
        assert!(request.starts_with("POST /users?page=1 HTTP/1.1"));
        assert!(request.to_lowercase().contains("x-token: secret"));
        assert!(request.to_lowercase().contains("user-agent: woojoo/"));
        assert!(request.ends_with("{\"name\":\"woojoo\"}"));
        assert_eq!(response.status, 201);
        assert_eq!(response.body, "{\"ok\":true}");
        assert!(response.headers.iter().any(|(k, v)| k == "x-trace" && v == "abc"));
        assert!(!response.base64 && !response.truncated);
    }
}
