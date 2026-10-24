use super::{
    connection::{Connection, Session},
    explorer,
    protocol::Resp,
    types::*,
};
fn cell(v: &Resp) -> Result<Bytes, String> {
    Ok(Bytes::new(v.bytes()?))
}
fn index(r: &ReadRequest, s: &Session) -> Result<u64, String> {
    let raw = s.cursor(r, "value")?;
    explorer::decimal(&raw)?;
    raw.parse()
        .map_err(|_| "INVALID_CURSOR: Invalid offset".into())
}
pub async fn read(c: &mut Connection, s: &Session, r: &ReadRequest) -> Result<Value, String> {
    let key = r.key()?;
    let meta = explorer::metadata(c, &key).await?;
    if meta.r#type == "none"
        || meta
            .error
            .as_deref()
            .is_some_and(|e| e.starts_with("KEY_MISSING"))
    {
        return Err("KEY_MISSING: Key no longer exists".into());
    }
    let mut kinds = vec![meta.r#type.as_str()];
    if meta.r#type == "unknown" {
        kinds = vec!["string", "hash", "list", "set", "zset", "stream"]
    }
    let mut last = "FORBIDDEN: No permitted value reader".to_string();
    for kind in kinds {
        match read_kind(c, s, r, &key, kind, &meta).await {
            Err(e)
                if meta.r#type == "unknown"
                    && (e.starts_with("TYPE_CHANGED") || e.starts_with("FORBIDDEN")) =>
            {
                last = e;
                continue;
            }
            result => return result,
        }
    }
    Err(last)
}
async fn read_kind(
    c: &mut Connection,
    s: &Session,
    r: &ReadRequest,
    key: &[u8],
    kind: &str,
    meta: &Meta,
) -> Result<Value, String> {
    let mut value = Value {
        key: Bytes::new(key),
        r#type: kind.into(),
        length: meta.length.clone(),
        ttl_ms: meta.ttl_ms.clone(),
        rows: vec![],
        text: None,
        next_cursor: None,
        observed_at: now(),
        truncated: false,
    };
    match kind {
        "string" => {
            let start = index(r, s)?;
            let end = start
                .checked_add(65535)
                .ok_or("INVALID_CURSOR: Offset overflow")?;
            let v = c
                .command(
                    "GETRANGE",
                    &[
                        key,
                        start.to_string().as_bytes(),
                        end.to_string().as_bytes(),
                    ],
                )
                .await?;
            let bytes = v.bytes()?;
            value.text = Some(Bytes::new(bytes));
            let next = start + bytes.len() as u64;
            value.truncated = start > 0;
            let more = meta
                .length
                .as_deref()
                .and_then(|v| v.parse::<u64>().ok())
                .map(|len| next < len)
                .unwrap_or(bytes.len() == 65536);
            if more {
                value.next_cursor = Some(s.next(r, "value", next.to_string())?);
                value.truncated = true
            }
        }
        "hash" | "set" => {
            let cursor = s.cursor(r, "value")?;
            explorer::decimal(&cursor)?;
            let (next, mut items) = if let Some(page) = s.page(r)? {
                (cursor, page)
            } else {
                let cmd = if kind == "hash" { "HSCAN" } else { "SSCAN" };
                let mut all = c
                    .command(cmd, &[key, cursor.as_bytes(), b"COUNT", b"50"])
                    .await?
                    .array()?
                    .into_iter();
                let next = all
                    .next()
                    .ok_or("PROTOCOL: Missing scan cursor")?
                    .string()?;
                explorer::decimal(&next)?;
                let items = all.next().ok_or("PROTOCOL: Missing scan values")?.array()?;
                (next, items)
            };
            let width = if kind == "hash" { 2 } else { 1 };
            if items.len() % width != 0 {
                return Err("PROTOCOL: Invalid hash pairs".into());
            }
            let mut count = 0;
            let mut budget = 65536;
            for row in items.chunks(width).take(100) {
                let size = row
                    .iter()
                    .try_fold(0usize, |n, v| v.bytes().map(|b| n + b.len()))?;
                if size > budget {
                    break;
                }
                budget -= size;
                count += width;
                value.rows.push(Row {
                    id: (value.rows.len()).to_string(),
                    cells: row.iter().map(cell).collect::<Result<_, _>>()?,
                });
            }
            if count == 0 && !items.is_empty() {
                return Err("TOO_LARGE: One item exceeds 64 KiB preview budget".into());
            }
            if count < items.len() {
                let rest = items.split_off(count);
                value.next_cursor = Some(s.buffer_page(r, next, rest)?);
                value.truncated = true;
            } else if next != "0" {
                value.next_cursor = Some(s.next(r, "value", next)?)
            }
        }
        "list" | "zset" => {
            let start = index(r, s)?;
            if start > i64::MAX as u64 - 99 {
                return Err("INVALID_CURSOR: Offset overflow".into());
            }
            let end = start + 99;
            let first = start.to_string();
            let last = end.to_string();
            let raw = if kind == "list" {
                c.command("LRANGE", &[key, first.as_bytes(), last.as_bytes()])
                    .await?
            } else {
                c.command(
                    "ZRANGE",
                    &[key, first.as_bytes(), last.as_bytes(), b"WITHSCORES"],
                )
                .await?
            };
            let items = raw.array()?;
            let width = if kind == "zset" { 2 } else { 1 };
            if items.len() % width != 0 || items.len() / width > 100 {
                return Err("PROTOCOL: Invalid range response".into());
            }
            let mut budget = 65536;
            for (i, row) in items.chunks(width).enumerate() {
                let size = row
                    .iter()
                    .try_fold(0usize, |n, v| v.bytes().map(|b| n + b.len()))?;
                if size > budget {
                    if value.rows.is_empty() {
                        return Err("TOO_LARGE: One item exceeds 64 KiB preview budget".into());
                    }
                    value.truncated = true;
                    break;
                }
                budget -= size;
                value.rows.push(Row {
                    id: (start + i as u64).to_string(),
                    cells: row.iter().map(cell).collect::<Result<_, _>>()?,
                })
            }
            let next = start + value.rows.len() as u64;
            value.truncated |= start > 0;
            let more = meta
                .length
                .as_deref()
                .and_then(|v| v.parse::<u64>().ok())
                .map(|len| next < len)
                .unwrap_or(value.rows.len() < items.len() / width || value.rows.len() == 100);
            if more {
                value.next_cursor = Some(s.next(r, "value", next.to_string())?)
            }
        }
        "stream" => {
            let cursor = s.cursor(r, "value")?;
            let from = if cursor == "0" {
                "-".into()
            } else {
                validate_stream_id(&cursor)?;
                format!("({cursor}")
            };
            let entries = c
                .command("XRANGE", &[key, from.as_bytes(), b"+", b"COUNT", b"100"])
                .await?
                .array()?;
            if entries.len() > 100 {
                return Err("TOO_LARGE: Too many stream entries".into());
            }
            let count = entries.len();
            let mut budget = 65536;
            for entry in entries {
                let mut row = entry.array()?.into_iter();
                let id = row.next().ok_or("PROTOCOL: Missing stream ID")?.string()?;
                validate_stream_id(&id)?;
                let fields = row
                    .next()
                    .ok_or("PROTOCOL: Missing stream fields")?
                    .array()?;
                let size = fields
                    .iter()
                    .try_fold(0usize, |n, v| v.bytes().map(|b| n + b.len()))?;
                if size > budget {
                    if value.rows.is_empty() {
                        return Err("TOO_LARGE: One message exceeds 64 KiB preview budget".into());
                    }
                    value.truncated = true;
                    break;
                }
                budget -= size;
                let cells = fields.iter().map(cell).collect::<Result<Vec<_>, _>>()?;
                value.rows.push(Row { id, cells });
            }
            if count == 100 || value.rows.len() < count {
                value.next_cursor =
                    Some(s.next(r, "value", value.rows.last().unwrap().id.clone())?)
            }
        }
        _ => return Err("UNSUPPORTED: This Redis module type has no preview reader".into()),
    }
    Ok(value)
}
fn validate_stream_id(id: &str) -> Result<(), String> {
    let Some((a, b)) = id.split_once('-') else {
        return Err("INVALID_CURSOR: Invalid stream ID".into());
    };
    explorer::decimal(a)?;
    explorer::decimal(b)
}
