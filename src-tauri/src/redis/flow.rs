use super::{connection::Connection, protocol::Resp, types::*};
use std::collections::BTreeMap;

#[derive(serde::Serialize)]
pub struct EventRecord {
    pub id: String,
    pub fields: BTreeMap<String, String>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventBatch {
    pub records: Vec<EventRecord>,
    pub last_id: String,
    pub gap: bool,
    pub observed_at: u64,
    pub baseline: bool,
}
fn stream_id(value: &str) -> Result<(u64, u64), String> {
    let (ms, seq) = value
        .split_once('-')
        .ok_or("INVALID_CURSOR: Expected stream ID")?;
    if value.len() > 41
        || ms.is_empty()
        || seq.is_empty()
        || !ms.bytes().all(|b| b.is_ascii_digit())
        || !seq.bytes().all(|b| b.is_ascii_digit())
    {
        return Err("INVALID_CURSOR: Expected stream ID".into());
    }
    Ok((
        ms.parse()
            .map_err(|_| "INVALID_CURSOR: Stream ID overflow")?,
        seq.parse()
            .map_err(|_| "INVALID_CURSOR: Stream ID overflow")?,
    ))
}
fn records(reply: Resp) -> Result<Vec<EventRecord>, String> {
    let mut out = Vec::new();
    let entries = reply.array()?;
    if entries.len() > 100 {
        return Err("TOO_LARGE: Observation batch exceeds 100 entries".into());
    }
    for entry in entries {
        let mut parts = entry.array()?.into_iter();
        let id = parts
            .next()
            .ok_or("PROTOCOL: Missing stream ID")?
            .string()?;
        stream_id(&id)?;
        let fields = parts
            .next()
            .ok_or("PROTOCOL: Missing stream fields")?
            .array()?;
        if parts.next().is_some() || fields.len() % 2 != 0 {
            return Err("PROTOCOL: Invalid stream entry".into());
        }
        let mut map = BTreeMap::new();
        for pair in fields.chunks_exact(2) {
            map.insert(pair[0].string()?, pair[1].string()?);
        }
        out.push(EventRecord { id, fields: map });
    }
    Ok(out)
}
pub async fn read(
    c: &mut Connection,
    request: &ReadRequest,
    after: Option<&str>,
) -> Result<EventBatch, String> {
    let key = request.key()?;
    if let Some(id) = after {
        stream_id(id)?;
    }
    let latest = records(
        c.command("XREVRANGE", &[&key, b"+", b"-", b"COUNT", b"1"])
            .await?,
    )?;
    let latest = latest
        .first()
        .map(|r| r.id.clone())
        .unwrap_or_else(|| "0-0".into());
    let Some(after) = after else {
        return Ok(EventBatch {
            records: vec![],
            last_id: latest,
            gap: false,
            observed_at: now(),
            baseline: true,
        });
    };
    // A lost cursor conservatively signals a gap, including trim/deletion or recreation.
    let anchor = if after != "0-0" {
        records(
            c.command(
                "XRANGE",
                &[&key, after.as_bytes(), after.as_bytes(), b"COUNT", b"1"],
            )
            .await?,
        )?
    } else {
        vec![]
    };
    let gap = after != "0-0" && (anchor.is_empty() || stream_id(&latest)? < stream_id(after)?);
    let start = if stream_id(&latest)? < stream_id(after)? {
        "-".into()
    } else {
        format!("({after}")
    };
    let result = records(
        c.command("XRANGE", &[&key, start.as_bytes(), b"+", b"COUNT", b"100"])
            .await?,
    )?;
    let last_id =
        result
            .last()
            .map(|r| r.id.clone())
            .unwrap_or_else(|| if gap { latest } else { after.into() });
    Ok(EventBatch {
        records: result,
        last_id,
        gap,
        observed_at: now(),
        baseline: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ids_preserve_large_integers_and_reject_injection() {
        assert_eq!(
            stream_id("9007199254740993-2").unwrap(),
            (9007199254740993, 2)
        );
        for value in [
            "1",
            "(1-0",
            "1-*",
            "-1-0",
            "1-0\r\n",
            "18446744073709551616-0",
        ] {
            assert!(stream_id(value).is_err());
        }
    }
}
