use super::{connection::Session, protocol::Resp, types::*};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub key_base64: String,
    pub operation: String,
    pub observed_at: u64,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub subscription_id: String,
    pub configuration: Option<String>,
    pub coverage: String,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub records: Vec<Record>,
    pub gap: bool,
    pub connected: bool,
    pub error: Option<String>,
    pub observed_at: u64,
}
struct Buffer {
    records: VecDeque<Record>,
    bytes: usize,
    gap: bool,
    connected: bool,
    error: Option<String>,
    touched: std::time::Instant,
}
impl Buffer {
    fn push(&mut self, record: Record) {
        let size = record.key_base64.len() + record.operation.len() + record.id.len() + 64;
        while !self.records.is_empty()
            && (self.records.len() >= 512 || self.bytes + size > 512 * 1024)
        {
            let old = self.records.pop_front().unwrap();
            self.bytes -= old.key_base64.len() + old.operation.len() + old.id.len() + 64;
            self.gap = true;
        }
        self.bytes += size;
        self.records.push_back(record);
    }
}
pub struct Subscription {
    id: String,
    buffer: Arc<Mutex<Buffer>>,
    stop: tokio::sync::watch::Sender<bool>,
}
impl Drop for Subscription {
    fn drop(&mut self) {
        self.stop.send_replace(true);
    }
}
fn record(value: Resp, db: i64, id: String) -> Result<Record, String> {
    let parts = value.array()?;
    if parts.len() != 4 || parts[0].bytes()? != b"pmessage" {
        return Err("PROTOCOL: Invalid keyevent notification".into());
    }
    let prefix = format!("__keyevent@{db}__:");
    let channel = parts[2].string()?;
    let operation = channel
        .strip_prefix(&prefix)
        .ok_or("PROTOCOL: Wrong notification database")?;
    if operation.len() > 128 {
        return Err("TOO_LARGE: Invalid operation".into());
    }
    Ok(Record {
        id,
        key_base64: Bytes::new(parts[3].bytes()?).base64,
        operation: operation.into(),
        observed_at: now(),
    })
}
pub async fn start(session: &Arc<Session>) -> Result<Started, String> {
    let mut closed = session.closed.subscribe();
    if *closed.borrow() {
        return Err("DISCONNECTED: Session closed".into());
    }
    let mut connection = session.open().await?;
    let configuration = match connection.notification_config().await {
        Ok(value) => Some(value),
        Err(error) if error.starts_with("FORBIDDEN") || error.starts_with("REDIS_ERROR") => None,
        Err(error) => return Err(error),
    };
    if configuration.as_ref().is_some_and(|v| !v.contains('E')) {
        return Err("UNSUPPORTED: Keyevent notifications are not enabled on this server".into());
    }
    connection.subscribe_keyevents(session.profile.db).await?;
    if *closed.borrow() {
        return Err("DISCONNECTED: Session closed".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let buffer = Arc::new(Mutex::new(Buffer {
        records: VecDeque::new(),
        bytes: 0,
        gap: false,
        connected: true,
        error: None,
        touched: std::time::Instant::now(),
    }));
    let (stop, mut stopped) = tokio::sync::watch::channel(false);
    *session.notifications.lock().unwrap() = Some(Subscription {
        id: id.clone(),
        buffer: buffer.clone(),
        stop,
    });
    let db = session.profile.db;
    let task_id = id.clone();
    tokio::spawn(async move {
        let mut sequence = 0u64;
        // One persistent read future: polling the lease must not discard partial RESP frames.
        let mut lease = tokio::time::interval(Duration::from_secs(5));
        let error = 'outer: loop {
            let pending = connection.notification();
            tokio::pin!(pending);
            loop {
                tokio::select! {
                    _ = closed.changed() => break 'outer None,
                    _ = stopped.changed() => break 'outer None,
                    _ = lease.tick() => {
                        if buffer.lock().unwrap().touched.elapsed() > Duration::from_secs(30) {
                            break 'outer Some("DISCONNECTED: Notification observation expired".into());
                        }
                    }
                    value = &mut pending => {
                        sequence += 1;
                        match value.and_then(|v| record(v, db, format!("{task_id}:{sequence}"))) {
                            Ok(record) => buffer.lock().unwrap().push(record),
                            Err(error) => break 'outer Some(error),
                        }
                        break;
                    }
                }
            }
        };
        let mut state = buffer.lock().unwrap();
        state.connected = false;
        state.gap = true;
        state.error = error;
    });
    Ok(Started {
        subscription_id: id,
        coverage: if configuration.is_some() {
            "keyevent"
        } else {
            "unknown"
        }
        .into(),
        configuration,
    })
}
pub fn poll(session: &Session, id: &str) -> Result<Batch, String> {
    let subscriptions = session.notifications.lock().unwrap();
    let subscription = subscriptions
        .as_ref()
        .filter(|s| s.id == id)
        .ok_or("DISCONNECTED: Notification subscription expired")?;
    let mut buffer = subscription.buffer.lock().unwrap();
    buffer.touched = std::time::Instant::now();
    let records = buffer.records.drain(..).collect();
    buffer.bytes = 0;
    Ok(Batch {
        records,
        gap: std::mem::take(&mut buffer.gap),
        connected: buffer.connected,
        error: buffer.error.clone(),
        observed_at: now(),
    })
}
pub fn stop(session: &Session, id: &str) {
    let mut subscriptions = session.notifications.lock().unwrap();
    if subscriptions.as_ref().is_some_and(|s| s.id == id) {
        subscriptions.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn buffer_is_bounded_and_reports_loss() {
        let mut buffer = Buffer {
            records: VecDeque::new(),
            bytes: 0,
            gap: false,
            connected: true,
            error: None,
            touched: std::time::Instant::now(),
        };
        for i in 0..2000 {
            buffer.push(Record {
                id: i.to_string(),
                key_base64: "x".repeat(4096),
                operation: "set".into(),
                observed_at: 0,
            });
        }
        assert!(buffer.records.len() <= 512);
        assert!(buffer.bytes <= 512 * 1024);
        assert!(buffer.gap);
        assert_eq!(buffer.records.back().unwrap().id, "1999");
    }
}
