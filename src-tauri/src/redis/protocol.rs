use std::{future::Future, pin::Pin};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
pub const BULK_LIMIT: usize = 65536;
pub const RESPONSE_LIMIT: usize = 1024 * 1024;
#[derive(Debug, Clone)]
pub enum Resp {
    Data(Vec<u8>),
    Int(i64),
    Array(Vec<Resp>),
    Nil,
    Error(String),
}
impl Resp {
    pub fn bytes(&self) -> Result<&[u8], String> {
        match self {
            Self::Data(v) => Ok(v),
            _ => Err("PROTOCOL: Expected bytes".into()),
        }
    }
    pub fn string(&self) -> Result<String, String> {
        match self {
            Self::Int(v) => Ok(v.to_string()),
            Self::Data(v) => {
                String::from_utf8(v.clone()).map_err(|_| "PROTOCOL: Expected UTF-8 token".into())
            }
            _ => Err("PROTOCOL: Expected scalar".into()),
        }
    }
    pub fn array(self) -> Result<Vec<Resp>, String> {
        match self {
            Self::Array(v) => Ok(v),
            _ => Err("PROTOCOL: Expected array".into()),
        }
    }
}
pub fn header_length(s: &[u8], limit: usize) -> Result<Option<usize>, String> {
    if s == b"-1" {
        return Ok(None);
    }
    let s = std::str::from_utf8(s).map_err(|_| "PROTOCOL: Invalid length")?;
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err("PROTOCOL: Invalid length".into());
    }
    let n = s
        .parse::<usize>()
        .map_err(|_| "TOO_LARGE: Response length overflow")?;
    if n > limit {
        return Err("TOO_LARGE: Response exceeds receive budget".into());
    }
    Ok(Some(n))
}
pub fn allowed(s: &str) -> bool {
    matches!(
        s,
        "SCAN"
            | "TYPE"
            | "PTTL"
            | "STRLEN"
            | "GETRANGE"
            | "HLEN"
            | "HSCAN"
            | "LLEN"
            | "LRANGE"
            | "SCARD"
            | "SSCAN"
            | "ZCARD"
            | "ZRANGE"
            | "XLEN"
            | "XRANGE"
            | "XREVRANGE"
            | "XINFO"
            | "XPENDING"
            | "INFO"
            | "DBSIZE"
    )
}
pub fn server_error(s: &[u8]) -> String {
    let text = String::from_utf8_lossy(s);
    if text.contains("cluster support disabled") {
        return "STANDALONE: Cluster support disabled".into();
    }
    if text.starts_with("NOAUTH") || text.starts_with("WRONGPASS") {
        "AUTH_FAILED: Authentication failed"
    } else if text.starts_with("NOPERM") {
        "FORBIDDEN: Command denied by Redis ACL"
    } else if text.starts_with("MOVED") || text.starts_with("ASK") {
        "UNSUPPORTED: Redis Cluster is not supported"
    } else if text.starts_with("WRONGTYPE") {
        "TYPE_CHANGED: Key type changed; refresh"
    } else if text.contains("no such key") {
        "KEY_MISSING: Key no longer exists"
    } else {
        "REDIS_ERROR: Redis rejected this read"
    }
    .into()
}
async fn line<S: AsyncRead + Unpin + ?Sized>(
    s: &mut S,
    budget: &mut usize,
) -> Result<Vec<u8>, String> {
    let mut v = Vec::new();
    loop {
        let b = s
            .read_u8()
            .await
            .map_err(|_| "DISCONNECTED: Redis connection closed")?;
        charge(budget, 1)?;
        if b == b'\r' {
            if s.read_u8()
                .await
                .map_err(|_| "DISCONNECTED: Redis connection closed")?
                != b'\n'
            {
                return Err("PROTOCOL: Invalid line ending".into());
            }
            charge(budget, 1)?;
            return Ok(v);
        }
        if v.len() >= 4096 {
            return Err("TOO_LARGE: Protocol line exceeds budget".into());
        }
        v.push(b)
    }
}
fn charge(budget: &mut usize, n: usize) -> Result<(), String> {
    *budget = budget
        .checked_sub(n)
        .ok_or("TOO_LARGE: Response exceeds receive budget")?;
    Ok(())
}
fn frame<'a, S: AsyncRead + Unpin + Send + ?Sized + 'a>(
    s: &'a mut S,
    budget: &'a mut usize,
    depth: usize,
) -> Pin<Box<dyn Future<Output = Result<Resp, String>> + Send + 'a>> {
    Box::pin(async move {
        if depth > 16 {
            return Err("TOO_LARGE: Response nesting exceeds budget".into());
        }
        charge(budget, 32)?;
        let tag = s
            .read_u8()
            .await
            .map_err(|_| "DISCONNECTED: Redis connection closed")?;
        let head = line(s, budget).await?;
        match tag {
            b'+' => Ok(Resp::Data(head)),
            b'-' => Ok(Resp::Error(server_error(&head))),
            b':' => Ok(Resp::Int(
                std::str::from_utf8(&head)
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .ok_or("PROTOCOL: Invalid integer")?,
            )),
            b'$' => {
                let Some(n) = header_length(&head, BULK_LIMIT)? else {
                    return Ok(Resp::Nil);
                };
                charge(budget, n + 2)?;
                let mut v = vec![0; n];
                s.read_exact(&mut v)
                    .await
                    .map_err(|_| "DISCONNECTED: Redis connection closed")?;
                let mut end = [0; 2];
                s.read_exact(&mut end)
                    .await
                    .map_err(|_| "DISCONNECTED: Redis connection closed")?;
                if end != *b"\r\n" {
                    return Err("PROTOCOL: Invalid bulk ending".into());
                }
                Ok(Resp::Data(v))
            }
            b'*' => {
                let Some(n) = header_length(&head, 8192)? else {
                    return Ok(Resp::Nil);
                };
                if n > *budget / 32 {
                    return Err("TOO_LARGE: Array exceeds receive budget".into());
                }
                let mut v = Vec::with_capacity(n);
                for _ in 0..n {
                    v.push(frame(s, budget, depth + 1).await?)
                }
                Ok(Resp::Array(v))
            }
            _ => Err("PROTOCOL: Unsupported RESP response".into()),
        }
    })
}
pub async fn read<S: AsyncRead + Unpin + Send + ?Sized>(s: &mut S) -> Result<Resp, String> {
    frame(s, &mut RESPONSE_LIMIT.clone(), 0).await
}
pub async fn send<S: AsyncWrite + Unpin + ?Sized>(
    s: &mut S,
    args: &[Vec<u8>],
) -> Result<(), String> {
    let total: usize = args.iter().map(Vec::len).sum();
    if total > 131072 || args.len() > 16 {
        return Err("TOO_LARGE: Request exceeds budget".into());
    }
    let mut buf = zeroize::Zeroizing::new(format!("*{}\r\n", args.len()).into_bytes());
    for a in args {
        buf.extend_from_slice(format!("${}\r\n", a.len()).as_bytes());
        buf.extend_from_slice(a);
        buf.extend_from_slice(b"\r\n");
    }
    let result = s
        .write_all(&buf)
        .await
        .map_err(|_| "DISCONNECTED: Could not send Redis request".into());
    use zeroize::Zeroize;
    buf.zeroize();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn rejects_bulk_header_without_waiting_for_body() {
        let mut input = &b"$999999999\r\n"[..];
        assert!(read(&mut input).await.unwrap_err().starts_with("TOO_LARGE"));
    }
    #[tokio::test]
    async fn rejects_many_small_items_before_allocating_array() {
        let mut input = &b"*9999999\r\n"[..];
        assert!(read(&mut input).await.unwrap_err().starts_with("TOO_LARGE"));
    }
    #[tokio::test]
    async fn preserves_binary_and_large_integer() {
        let mut input = &b"*2\r\n$2\r\n\xff\0\r\n:9007199254740993\r\n"[..];
        let v = read(&mut input).await.unwrap().array().unwrap();
        assert_eq!(v[0].bytes().unwrap(), &[255, 0]);
        assert_eq!(v[1].string().unwrap(), "9007199254740993");
    }
    #[test]
    fn never_echoes_server_secrets() {
        assert_eq!(
            server_error(b"ERR redis://secret@host password"),
            "REDIS_ERROR: Redis rejected this read"
        );
    }
}

#[cfg(test)]
mod cumulative_tests {
    use super::*;
    #[tokio::test]
    async fn many_small_bulk_values_exceed_cumulative_budget() {
        let mut input = b"*8192\r\n".to_vec();
        for _ in 0..8192 {
            input.extend(b"$128\r\n");
            input.extend([b'x'; 128]);
            input.extend(b"\r\n");
        }
        assert!(read(&mut input.as_slice())
            .await
            .unwrap_err()
            .starts_with("TOO_LARGE"));
    }
    #[tokio::test]
    async fn nested_arrays_are_bounded() {
        let mut input = b"*1\r\n".repeat(18);
        input.extend(b"+OK\r\n");
        assert!(read(&mut input.as_slice())
            .await
            .unwrap_err()
            .starts_with("TOO_LARGE"));
    }
}
