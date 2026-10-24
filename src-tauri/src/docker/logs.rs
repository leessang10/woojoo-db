use super::cli;
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tauri::ipc::Channel;
use tokio::{io::AsyncReadExt, sync::oneshot};

struct StreamControl {
    cancel: Option<oneshot::Sender<()>>,
    finished: oneshot::Receiver<()>,
}
#[derive(Default)]
struct StreamRegistry {
    closing: bool,
    entries: HashMap<String, StreamControl>,
}
impl StreamRegistry {
    fn register(
        &mut self,
        id: String,
    ) -> Result<(oneshot::Receiver<()>, oneshot::Sender<()>), String> {
        if self.closing || self.entries.len() >= 4 || self.entries.contains_key(&id) {
            return Err("DOCKER_LOGS_BUSY".into());
        }
        let (cancel, rx) = oneshot::channel();
        let (finished, done) = oneshot::channel();
        self.entries.insert(
            id,
            StreamControl {
                cancel: Some(cancel),
                finished: done,
            },
        );
        Ok((rx, finished))
    }
}
static STREAMS: LazyLock<Mutex<StreamRegistry>> = LazyLock::new(Default::default);

async fn shutdown_registry(registry: &Mutex<StreamRegistry>) {
    let pending: Vec<_> = {
        let mut streams = registry.lock().unwrap();
        streams.closing = true;
        streams
            .entries
            .drain()
            .map(|(_, mut stream)| {
                if let Some(cancel) = stream.cancel.take() {
                    let _ = cancel.send(());
                }
                stream.finished
            })
            .collect()
    };
    // The completion signal is emitted only after kill().await has reaped the child.
    for finished in pending {
        let _ = finished.await;
    }
}
pub async fn shutdown() {
    shutdown_registry(&STREAMS).await;
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEvent {
    subscription: String,
    lines: Vec<String>,
    truncated: bool,
    done: bool,
    error: Option<String>,
}

// Keep bytes until a line boundary to avoid corrupting a UTF-8 sequence split across reads.
fn feed(partial: &mut Vec<u8>, bytes: &[u8], lines: &mut Vec<String>, truncated: &mut bool) {
    for &b in bytes {
        if b == b'\n' {
            lines.push(
                String::from_utf8_lossy(partial)
                    .trim_end_matches('\r')
                    .to_owned(),
            );
            partial.clear();
        } else {
            partial.push(b);
        }
        if partial.len() >= 16384 {
            partial.clear();
            *truncated = true;
        }
        if lines.len() > 200 {
            lines.remove(0);
            *truncated = true;
        }
    }
}
#[tauri::command]
pub fn docker_logs_stop(subscription: String) -> Result<(), String> {
    if let Some(stream) = STREAMS
        .lock()
        .map_err(|_| "DOCKER_BUSY")?
        .entries
        .get_mut(&subscription)
    {
        if let Some(tx) = stream.cancel.take() {
            let _ = tx.send(());
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn docker_logs_start(
    context: String,
    id: String,
    subscription: String,
    on_event: Channel<LogEvent>,
) -> Result<(), String> {
    let _operation = super::storage::operation().await?;
    cli::validate(&context)?;
    cli::id(&id)?;
    cli::validate(&subscription)?;
    let (mut rx, finished) = STREAMS
        .lock()
        .map_err(|_| "DOCKER_BUSY")?
        .register(subscription.clone())?;
    let spawned = cli::command(
        Some(&context),
        &[
            "container",
            "logs",
            "--follow",
            "--tail",
            "200",
            "--timestamps",
            &id,
        ],
    )
    .and_then(|mut c| c.spawn().map_err(|_| "DOCKER_CLI_START_FAILED".into()));
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            STREAMS.lock().unwrap().entries.remove(&subscription);
            return Err(e);
        }
    };
    let mut stdout = child.stdout.take().ok_or("DOCKER_PIPE_FAILED")?;
    let mut stderr = child.stderr.take().ok_or("DOCKER_PIPE_FAILED")?;
    tauri::async_runtime::spawn(async move {
        let mut out = [0u8; 8192];
        let mut err = [0u8; 8192];
        let mut out_partial = Vec::new();
        let mut err_partial = Vec::new();
        let mut out_open = true;
        let mut err_open = true;
        let mut lines = Vec::new();
        let mut truncated = false;
        let mut tick = tokio::time::interval(Duration::from_millis(100));
        let mut cancelled = false;
        let mut error = None;
        loop {
            if !out_open && !err_open {
                break;
            }
            tokio::select! {
                _ = &mut rx => {cancelled=true; break;},
                read=stdout.read(&mut out), if out_open => match read {
                    Ok(0)=>out_open=false, Ok(n)=>feed(&mut out_partial,&out[..n],&mut lines,&mut truncated), Err(_)=>{error=Some("DOCKER_LOG_READ_FAILED".into());break;}
                },
                read=stderr.read(&mut err), if err_open => match read {
                    Ok(0)=>err_open=false, Ok(n)=>feed(&mut err_partial,&err[..n],&mut lines,&mut truncated), Err(_)=>{error=Some("DOCKER_LOG_READ_FAILED".into());break;}
                },
                _=tick.tick()=> {
                    if (!lines.is_empty() || truncated) && on_event.send(LogEvent {subscription:subscription.clone(),lines:std::mem::take(&mut lines),truncated:std::mem::take(&mut truncated),done:false,error:None}).is_err() {cancelled=true;break;}
                }
            }
        }
        if cancelled || error.is_some() {
            let _ = child.kill().await;
        } else {
            let status = tokio::select! { _=&mut rx=>{cancelled=true;None}, result=tokio::time::timeout(Duration::from_secs(5),child.wait())=>Some(result) };
            match status {
                Some(Ok(Ok(status))) if status.success() => {}
                Some(Ok(Ok(status))) => {
                    error = Some(format!(
                    "DOCKER_LOGS_FAILED: {status}. Log driver may not support reading; see output."
                ))
                }
                _ => {
                    let _ = child.kill().await;
                    if !cancelled {
                        error = Some("DOCKER_LOGS_TIMEOUT".into());
                    }
                }
            }
        }
        if !cancelled {
            if !out_partial.is_empty() {
                lines.push(String::from_utf8_lossy(&out_partial).into_owned());
            }
            if !err_partial.is_empty() {
                lines.push(String::from_utf8_lossy(&err_partial).into_owned());
            }
            let _ = on_event.send(LogEvent {
                subscription: subscription.clone(),
                lines,
                truncated,
                done: true,
                error,
            });
        }
        STREAMS.lock().unwrap().entries.remove(&subscription);
        let _ = finished.send(());
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[tokio::test]
    async fn shutdown_waits_for_a_quiet_child_to_be_reaped_and_rejects_new_streams() {
        let registry = Mutex::new(StreamRegistry::default());
        let (cancel, finished) = registry.lock().unwrap().register("test".into()).unwrap();
        let mut command = tokio::process::Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 5",
            ])
            .creation_flags(0x08000000)
            .kill_on_drop(true);
        let mut child = command.spawn().unwrap();
        let worker = tokio::spawn(async move {
            let _ = cancel.await;
            child.kill().await.unwrap();
            let reaped = child.try_wait().unwrap().is_some();
            let _ = finished.send(());
            reaped
        });
        shutdown_registry(&registry).await;
        assert!(worker.await.unwrap());
        assert!(registry.lock().unwrap().register("late".into()).is_err());
    }
    #[test]
    fn frames_preserve_split_utf8_and_bound_memory() {
        let mut partial = Vec::new();
        let mut lines = Vec::new();
        let mut truncated = false;
        let bytes = "한글\n".as_bytes();
        feed(&mut partial, &bytes[..2], &mut lines, &mut truncated);
        feed(&mut partial, &bytes[2..], &mut lines, &mut truncated);
        assert_eq!(lines, vec!["한글"]);
        feed(
            &mut partial,
            &vec![b'a'; 100000],
            &mut lines,
            &mut truncated,
        );
        assert!(partial.len() < 16384);
        assert!(truncated);
        feed(
            &mut partial,
            &b"x\n".repeat(1000),
            &mut lines,
            &mut truncated,
        );
        assert!(lines.len() <= 200);
    }
}
