use super::{
    connection::{Connection, Session},
    protocol::Resp,
    types::*,
};
use std::collections::HashSet;
pub fn length_command(t: &str) -> Option<&'static str> {
    match t {
        "string" => Some("STRLEN"),
        "hash" => Some("HLEN"),
        "list" => Some("LLEN"),
        "set" => Some("SCARD"),
        "zset" => Some("ZCARD"),
        "stream" => Some("XLEN"),
        _ => None,
    }
}
pub async fn metadata(c: &mut Connection, key: &[u8]) -> Result<Meta, String> {
    Ok(metadata_batch(c, &[key.to_vec()]).await?.remove(0))
}
pub fn decimal(s: &str) -> Result<(), String> {
    if s.is_empty()
        || s.len() > 20
        || !s.bytes().all(|v| v.is_ascii_digit())
        || s.parse::<u64>().is_err()
    {
        return Err("INVALID_CURSOR: Invalid decimal cursor".into());
    }
    Ok(())
}
pub async fn scan(c: &mut Connection, s: &Session, r: &ReadRequest) -> Result<Scan, String> {
    let mut cursor = s.cursor(r, "scan")?;
    decimal(&cursor)?;
    let pattern = r.pattern.as_deref().unwrap_or("*");
    if pattern.len() > 4096 {
        return Err("TOO_LARGE: Pattern exceeds budget".into());
    }
    let kind = r
        .type_filter
        .as_deref()
        .filter(|t| !t.is_empty() && *t != "all");
    if let Some(kind) = kind {
        if !["string", "hash", "list", "set", "zset", "stream"].contains(&kind) {
            return Err("UNSUPPORTED: Unknown type filter".into());
        }
    }
    let start = std::time::Instant::now();
    let mut keys = Vec::new();
    let mut seen = HashSet::new();
    for _ in 0..10 {
        let mut args = vec![
            cursor.as_bytes(),
            b"MATCH".as_slice(),
            pattern.as_bytes(),
            b"COUNT".as_slice(),
            b"200".as_slice(),
        ];
        if let Some(kind) = kind {
            args.extend([b"TYPE".as_slice(), kind.as_bytes()])
        }
        let mut result = c.command("SCAN", &args).await?.array()?.into_iter();
        cursor = result
            .next()
            .ok_or("PROTOCOL: Missing scan cursor")?
            .string()?;
        decimal(&cursor)?;
        let batch = result
            .next()
            .ok_or("PROTOCOL: Missing scan keys")?
            .array()?;
        for batch in batch.chunks(50) {
            let mut raw_keys = Vec::new();
            for key in batch {
                let raw = key.bytes()?;
                if seen.insert(raw.to_vec()) {
                    raw_keys.push(raw.to_vec());
                }
            }
            keys.extend(metadata_batch(c, &raw_keys).await?);
        }
        if cursor == "0" || !keys.is_empty() || start.elapsed() >= std::time::Duration::from_secs(1)
        {
            break;
        }
    }
    let db_size = match c.command("DBSIZE", &[]).await {
        Ok(v) => Some(v.string()?),
        Err(e) if e.starts_with("FORBIDDEN") => None,
        Err(e) => return Err(e),
    };
    let partial = cursor != "0";
    Ok(Scan {
        topology_verified: s
            .topology_verified
            .load(std::sync::atomic::Ordering::SeqCst),
        keys,
        next_cursor: s.next(r, "scan", cursor)?,
        observed_at: now(),
        partial,
        db_size,
    })
}

pub async fn metadata_batch(c: &mut Connection, keys: &[Vec<u8>]) -> Result<Vec<Meta>, String> {
    let types = c
        .pipeline(
            keys.iter()
                .map(|key| vec![b"TYPE".to_vec(), key.clone()])
                .collect(),
        )
        .await?;
    let ttls = c
        .pipeline(
            keys.iter()
                .map(|key| vec![b"PTTL".to_vec(), key.clone()])
                .collect(),
        )
        .await?;
    let mut metas = Vec::new();
    let mut lengths = Vec::new();
    let mut indices = Vec::new();
    for ((key, t), ttl) in keys.iter().zip(types).zip(ttls) {
        let mut error = None;
        let kind = match t {
            Ok(t) => t.string()?,
            Err(e) if e.starts_with("FORBIDDEN") => {
                error = Some(e);
                "unknown".into()
            }
            Err(e) => return Err(e),
        };
        let ttl_ms = match ttl {
            Ok(Resp::Int(-1)) => Some("-1".into()),
            Ok(Resp::Int(-2)) => {
                error = Some("KEY_MISSING: Key no longer exists".into());
                Some("-2".into())
            }
            Ok(v) => Some(v.string()?),
            Err(e) if e.starts_with("FORBIDDEN") => {
                error = Some(e);
                None
            }
            Err(e) => return Err(e),
        };
        if kind == "none" {
            error = Some("KEY_MISSING: Key no longer exists".into())
        }
        if let Some(cmd) = length_command(&kind) {
            indices.push(metas.len());
            lengths.push(vec![cmd.as_bytes().to_vec(), key.clone()]);
        }
        metas.push(Meta {
            key: Bytes::new(key),
            r#type: kind,
            ttl_ms,
            length: None,
            error,
        });
    }
    for (index, result) in indices.into_iter().zip(c.pipeline(lengths).await?) {
        match result {
            Ok(v) => metas[index].length = Some(v.string()?),
            Err(e)
                if e.starts_with("FORBIDDEN")
                    || e.starts_with("TYPE_CHANGED")
                    || e.starts_with("KEY_MISSING") =>
            {
                metas[index].error = Some(e)
            }
            Err(e) => return Err(e),
        }
    }
    Ok(metas)
}
#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{io::AsyncWriteExt, net::TcpListener};
    #[tokio::test]
    async fn metadata_sends_batch_before_waiting_for_replies() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            super::super::protocol::read(&mut socket).await.unwrap();
            socket.write_all(b"+OK\r\n").await.unwrap();
            for _ in 0..2 {
                let command = super::super::protocol::read(&mut socket)
                    .await
                    .unwrap()
                    .array()
                    .unwrap();
                assert_eq!(command[0].bytes().unwrap(), b"TYPE");
            }
            socket.write_all(b"+string\r\n+string\r\n").await.unwrap();
            loop {
                let Ok(_) = super::super::protocol::read(&mut socket).await else {
                    break;
                };
                socket.write_all(b":1\r\n").await.unwrap();
            }
        });
        let p = Profile {
            id: "test".into(),
            name: "test".into(),
            host: "127.0.0.1".into(),
            port,
            separator: ":".into(),
            ..Default::default()
        };
        let mut connection = Connection::open(&p, None).await.unwrap();
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(300),
            metadata_batch(&mut connection, &[b"a".to_vec(), b"b".to_vec()]),
        )
        .await;
        assert!(
            result.is_ok(),
            "Metadata must pipeline TYPE commands before reading replies"
        );
        drop(connection);
        server.abort();
    }
}
