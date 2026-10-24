use super::{connection::Connection, protocol::Resp, types::*};
fn field<'a>(v: &'a [Resp], name: &[u8]) -> Option<&'a Resp> {
    v.chunks_exact(2)
        .find(|pair| pair[0].bytes().ok() == Some(name))
        .map(|p| &p[1])
}
fn scalar(v: &[Resp], name: &[u8]) -> Result<String, String> {
    field(v, name)
        .ok_or("PROTOCOL: Missing queue field")?
        .string()
}
fn optional_failure(e: &str) -> bool {
    e.starts_with("FORBIDDEN")
        || e.starts_with("REDIS_ERROR")
        || e.starts_with("KEY_MISSING")
        || e.starts_with("TYPE_CHANGED")
}
pub async fn inspect(c: &mut Connection, r: &ReadRequest) -> Result<Queue, String> {
    let key = r.key()?;
    let mut q = Queue {
        groups: vec![],
        consumers: vec![],
        pending: vec![],
        errors: vec![],
        observed_at: now(),
    };
    match c.command("XINFO", &[b"GROUPS", &key]).await {
        Ok(v) => {
            let rows = v.array()?;
            if rows.len() > 100 {
                return Err("TOO_LARGE: Group preview exceeds 100 items".into());
            }
            for row in rows {
                let fields = row.array()?;
                q.groups.push(Group {
                    name: scalar(&fields, b"name")?,
                    pending: scalar(&fields, b"pending")?,
                    consumers: scalar(&fields, b"consumers")?,
                    lag: field(&fields, b"lag")
                        .filter(|v| !matches!(v, Resp::Nil))
                        .map(Resp::string)
                        .transpose()?,
                });
            }
        }
        Err(e) if optional_failure(&e) => q.errors.push(e),
        Err(e) => return Err(e),
    };
    if let Some(group) = r.group.as_deref() {
        if group.len() > 4096 {
            return Err("TOO_LARGE: Group name exceeds budget".into());
        }
        match c
            .command("XINFO", &[b"CONSUMERS", &key, group.as_bytes()])
            .await
        {
            Ok(v) => {
                let rows = v.array()?;
                if rows.len() > 100 {
                    return Err("TOO_LARGE: Consumer preview exceeds 100 items".into());
                }
                for row in rows {
                    let fields = row.array()?;
                    q.consumers.push(Consumer {
                        name: scalar(&fields, b"name")?,
                        pending: scalar(&fields, b"pending")?,
                        idle: scalar(&fields, b"idle")?,
                    });
                }
            }
            Err(e) if optional_failure(&e) => q.errors.push(e),
            Err(e) => return Err(e),
        }
        match c
            .command("XPENDING", &[&key, group.as_bytes(), b"-", b"+", b"100"])
            .await
        {
            Ok(v) => {
                let rows = v.array()?;
                if rows.len() > 100 {
                    return Err("TOO_LARGE: Pending preview exceeds 100 items".into());
                }
                for row in rows {
                    let fields = row.array()?;
                    if fields.len() != 4 {
                        return Err("PROTOCOL: Invalid pending row".into());
                    }
                    q.pending.push(Pending {
                        id: fields[0].string()?,
                        consumer: fields[1].string()?,
                        idle: fields[2].string()?,
                        deliveries: fields[3].string()?,
                    });
                }
            }
            Err(e) if optional_failure(&e) => q.errors.push(e),
            Err(e) => return Err(e),
        }
    }
    Ok(q)
}
pub async fn server(c: &mut Connection) -> Result<ServerInfo, String> {
    let mut out = ServerInfo {
        info: None,
        db_size: None,
        errors: vec![],
    };
    match c.command("INFO", &[]).await {
        Ok(v) => out.info = Some(v.string()?),
        Err(e) if optional_failure(&e) => out.errors.push(e),
        Err(e) => return Err(e),
    }
    match c.command("DBSIZE", &[]).await {
        Ok(v) => out.db_size = Some(v.string()?),
        Err(e) if optional_failure(&e) => out.errors.push(e),
        Err(e) => return Err(e),
    }
    Ok(out)
}
