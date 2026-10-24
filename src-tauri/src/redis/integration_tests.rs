use super::*;
use protocol::Resp;
use tokio::{io::AsyncWriteExt, net::TcpListener};
fn profile(port: u16) -> Profile {
    Profile {
        id: "fixture".into(),
        name: "Fixture".into(),
        host: "127.0.0.1".into(),
        port,
        separator: ":".into(),
        ..Default::default()
    }
}
fn request(key: &[u8]) -> ReadRequest {
    ReadRequest {
        session_id: "fixture".into(),
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: 1,
        key_base64: Some(Bytes::new(key).base64),
        pattern: None,
        type_filter: None,
        cursor: None,
        offset: None,
        group: None,
    }
}
fn bulk(data: &[u8]) -> Vec<u8> {
    let mut out = format!("${}\r\n", data.len()).into_bytes();
    out.extend(data);
    out.extend(b"\r\n");
    out
}
fn array(items: Vec<Vec<u8>>) -> Vec<u8> {
    let mut out = format!("*{}\r\n", items.len()).into_bytes();
    for v in items {
        out.extend(v)
    }
    out
}
async fn server(
    handler: impl Fn(Vec<Vec<u8>>) -> Vec<u8> + Send + Sync + 'static,
) -> (Profile, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let p = profile(listener.local_addr().unwrap().port());
    let handler = Arc::new(handler);
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            let handler = handler.clone();
            tokio::spawn(async move {
                loop {
                    let Ok(Resp::Array(parts)) = protocol::read(&mut socket).await else {
                        break;
                    };
                    let args = parts
                        .into_iter()
                        .map(|v| v.bytes().unwrap().to_vec())
                        .collect();
                    if socket.write_all(&handler(args)).await.is_err() {
                        break;
                    }
                }
            });
        }
    });
    (p, task)
}
#[tokio::test]
async fn compact_hash_pages_one_hundred_without_losing_fields() {
    let (p, task) = server(|a| match a[0].as_slice() {
        b"SELECT" => b"+OK\r\n".to_vec(),
        b"TYPE" => b"+hash\r\n".to_vec(),
        b"PTTL" => b":-1\r\n".to_vec(),
        b"HLEN" => b":125\r\n".to_vec(),
        b"HSCAN" => {
            let mut rows = vec![];
            for i in 0..125 {
                rows.push(bulk(format!("field{i}").as_bytes()));
                rows.push(bulk(b"value"))
            }
            array(vec![bulk(b"0"), array(rows)])
        }
        _ => panic!("unexpected command"),
    })
    .await;
    let session = Session::new(p, None);
    let mut c = session.open().await.unwrap();
    let mut r = request(b"hash");
    let first = values::read(&mut c, &session, &r).await.unwrap();
    assert_eq!(first.rows.len(), 100);
    r.cursor = first.next_cursor;
    let second = values::read(&mut c, &session, &r).await.unwrap();
    assert_eq!(second.rows.len(), 25);
    assert_eq!(second.rows[0].cells[0].text, "field100");
    assert!(second.next_cursor.is_none());
    task.abort();
}
#[tokio::test]
async fn persistent_and_missing_ttls_stay_distinct() {
    let (p, task) = server(|a| match a[0].as_slice() {
        b"SELECT" => b"+OK\r\n".to_vec(),
        b"TYPE" => b"+string\r\n".to_vec(),
        b"PTTL" => {
            if a[1] == b"missing" {
                b":-2\r\n".to_vec()
            } else {
                b":-1\r\n".to_vec()
            }
        }
        b"STRLEN" => b":1\r\n".to_vec(),
        _ => panic!(),
    })
    .await;
    let mut c = Connection::open(&p, None).await.unwrap();
    assert_eq!(
        explorer::metadata(&mut c, b"persistent")
            .await
            .unwrap()
            .ttl_ms
            .as_deref(),
        Some("-1")
    );
    assert_eq!(
        explorer::metadata(&mut c, b"missing")
            .await
            .unwrap()
            .ttl_ms
            .as_deref(),
        Some("-2")
    );
    task.abort();
}
#[tokio::test]
async fn six_types_and_binary_key_use_only_original_key_bytes() {
    let seen = Arc::new(Mutex::new(Vec::<Vec<Vec<u8>>>::new()));
    let seen2 = seen.clone();
    let (p, task) = server(move |a| {
        seen2.lock().unwrap().push(a.clone());
        match a[0].as_slice() {
            b"SELECT" => b"+OK\r\n".to_vec(),
            b"TYPE" => {
                let t = if a[1] == [255, 0] {
                    b"string".to_vec()
                } else {
                    a[1].clone()
                };
                bulk(&t)
            }
            b"PTTL" => b":1000\r\n".to_vec(),
            b"STRLEN" | b"HLEN" | b"LLEN" | b"SCARD" | b"ZCARD" | b"XLEN" => b":1\r\n".to_vec(),
            b"GETRANGE" => bulk(&[255, 0]),
            b"HSCAN" => array(vec![
                bulk(b"0"),
                array(vec![bulk(b"field"), bulk(b"value")]),
            ]),
            b"SSCAN" => array(vec![bulk(b"0"), array(vec![bulk(b"member")])]),
            b"LRANGE" => array(vec![bulk(b"item")]),
            b"ZRANGE" => array(vec![bulk(b"member"), bulk(b"1.5")]),
            b"XRANGE" => array(vec![array(vec![
                bulk(b"9007199254740993-0"),
                array(vec![bulk(b"f"), bulk(b"v")]),
            ])]),
            _ => panic!("unexpected command"),
        }
    })
    .await;
    let session = Session::new(p, None);
    for key in [
        &[255u8, 0][..],
        b"hash",
        b"list",
        b"set",
        b"zset",
        b"stream",
    ] {
        let mut c = session.open().await.unwrap();
        let value = values::read(&mut c, &session, &request(key)).await.unwrap();
        assert_eq!(value.key.base64, Bytes::new(key).base64);
        if key == [255, 0] {
            assert_eq!(value.text.unwrap().base64, "/wA=")
        } else {
            assert_eq!(value.rows.len(), 1);
            if key == b"stream" {
                assert_eq!(value.rows[0].id, "9007199254740993-0")
            }
        }
    }
    let commands = seen.lock().unwrap();
    assert!(commands
        .iter()
        .any(|a| a[0] == b"GETRANGE" && a[1] == [255, 0]));
    assert!(commands
        .iter()
        .all(|a| a[0] == b"SELECT" || protocol::allowed(std::str::from_utf8(&a[0]).unwrap())));
    task.abort();
}
#[tokio::test]
async fn denied_optional_metadata_does_not_hide_readable_value() {
    let (p, task) = server(|a| match a[0].as_slice() {
        b"SELECT" | b"TYPE" | b"PTTL" => b"-NOPERM blocked\r\n".to_vec(),
        b"GETRANGE" => bulk(b"visible"),
        _ => panic!(),
    })
    .await;
    let session = Session::new(p, None);
    let mut c = session.open().await.unwrap();
    let value = values::read(&mut c, &session, &request(b"key"))
        .await
        .unwrap();
    assert_eq!(value.text.unwrap().text, "visible");
    task.abort();
}
#[tokio::test]
async fn queue_inspection_uses_no_consuming_commands() {
    let observed = Arc::new(Mutex::new(vec![]));
    let obs = observed.clone();
    let (p, task) = server(move |a| {
        obs.lock().unwrap().push(a[0].clone());
        match a[0].as_slice() {
            b"SELECT" => b"+OK\r\n".to_vec(),
            b"XINFO" if a[1] == b"GROUPS" => array(vec![array(vec![
                bulk(b"name"),
                bulk(b"workers"),
                bulk(b"pending"),
                b":1\r\n".to_vec(),
                bulk(b"consumers"),
                b":1\r\n".to_vec(),
                bulk(b"lag"),
                b"$-1\r\n".to_vec(),
            ])]),
            b"XINFO" => array(vec![array(vec![
                bulk(b"name"),
                bulk(b"worker-1"),
                bulk(b"pending"),
                b":1\r\n".to_vec(),
                bulk(b"idle"),
                b":20\r\n".to_vec(),
            ])]),
            b"XPENDING" => array(vec![array(vec![
                bulk(b"1-0"),
                bulk(b"worker-1"),
                b":20\r\n".to_vec(),
                b":1\r\n".to_vec(),
            ])]),
            _ => panic!("non-observation command"),
        }
    })
    .await;
    let mut c = Connection::open(&p, None).await.unwrap();
    let mut r = request(b"stream");
    r.group = Some("workers".into());
    let before = queues::inspect(&mut c, &r).await.unwrap();
    let after = queues::inspect(&mut c, &r).await.unwrap();
    assert_eq!(before.pending[0].id, after.pending[0].id);
    assert_eq!(after.groups[0].pending, "1");
    assert!(after.groups[0].lag.is_none());
    assert!(observed
        .lock()
        .unwrap()
        .iter()
        .all(|c| [b"SELECT".as_slice(), b"XINFO", b"XPENDING"].contains(&c.as_slice())));
    task.abort();
}
#[tokio::test]
async fn cancellation_drops_socket_and_cleans_request() {
    let (p, task) = server(|a| {
        if a[0] == b"SELECT" {
            b"+OK\r\n".to_vec()
        } else {
            vec![]
        }
    })
    .await;
    let state = Arc::new(
        State::new(std::env::temp_dir().join(format!("redis-{}.json", uuid::Uuid::new_v4())))
            .unwrap(),
    );
    state
        .sessions
        .lock()
        .unwrap()
        .insert("fixture".into(), Arc::new(Session::new(p, None)));
    let state2 = state.clone();
    let r = request(b"key");
    let id = r.request_id.clone();
    let work = tokio::spawn(async move {
        run(&state2, r, |mut c, _, _| async move {
            c.command("GETRANGE", &[b"key", b"0", b"10"]).await?;
            Ok(())
        })
        .await
    });
    for _ in 0..100 {
        if state
            .requests
            .lock()
            .unwrap()
            .contains_key(&("fixture".into(), id.clone()))
        {
            break;
        }
        tokio::task::yield_now().await;
    }
    state
        .requests
        .lock()
        .unwrap()
        .get(&("fixture".into(), id))
        .unwrap()
        .send_replace(true);
    assert!(work.await.unwrap().unwrap_err().starts_with("CANCELLED"));
    assert!(state.requests.lock().unwrap().is_empty());
    state.shutdown().await;
    assert!(state.sessions.lock().unwrap().is_empty());
    task.abort();
}
#[tokio::test]
async fn huge_tcp_bulk_is_rejected_without_body() {
    let (p, task) = server(|a| {
        if a[0] == b"SELECT" {
            b"+OK\r\n".to_vec()
        } else {
            b"$500000000\r\n".to_vec()
        }
    })
    .await;
    let mut c = Connection::open(&p, None).await.unwrap();
    let err = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        c.command("GETRANGE", &[b"key", b"0", b"1"]),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert!(err.starts_with("TOO_LARGE"));
    task.abort();
}
#[tokio::test]
async fn range_types_page_by_bytes_without_dropping_items() {
    for kind in ["list", "zset", "stream"] {
        let k = kind.to_string();
        let (p, task) = server(move |a| match a[0].as_slice() {
            b"SELECT" => b"+OK\r\n".to_vec(),
            b"TYPE" => bulk(k.as_bytes()),
            b"PTTL" => b":-1\r\n".to_vec(),
            b"LLEN" | b"ZCARD" | b"XLEN" => b":100\r\n".to_vec(),
            b"LRANGE" | b"ZRANGE" => {
                let start = std::str::from_utf8(&a[2])
                    .unwrap()
                    .parse::<usize>()
                    .unwrap();
                let mut rows = vec![];
                for i in start..100 {
                    let mut data = vec![b'x'; 1024];
                    data[0] = i as u8;
                    rows.push(bulk(&data));
                    if a[0] == b"ZRANGE" {
                        rows.push(bulk(b"1"))
                    }
                }
                array(rows)
            }
            b"XRANGE" => {
                let from = std::str::from_utf8(&a[2]).unwrap();
                let start = if from == "-" {
                    0
                } else {
                    from.trim_start_matches('(')
                        .split('-')
                        .next()
                        .unwrap()
                        .parse::<usize>()
                        .unwrap()
                        + 1
                };
                let mut rows = vec![];
                for i in start..100 {
                    rows.push(array(vec![
                        bulk(format!("{i}-0").as_bytes()),
                        array(vec![bulk(b"f"), bulk(&vec![b'x'; 1024])]),
                    ]))
                }
                array(rows)
            }
            _ => panic!(),
        })
        .await;
        let session = Session::new(p, None);
        let mut c = session.open().await.unwrap();
        let mut r = request(kind.as_bytes());
        let mut total = 0;
        loop {
            let value = values::read(&mut c, &session, &r).await.unwrap();
            assert!(!value.rows.is_empty());
            if kind == "list" || kind == "zset" {
                assert_eq!(value.rows[0].id, total.to_string())
            }
            total += value.rows.len();
            if let Some(next) = value.next_cursor {
                r.cursor = Some(next)
            } else {
                break;
            }
        }
        assert_eq!(total, 100);
        task.abort();
    }
}
#[tokio::test]
async fn verifies_standalone_rejects_cluster_and_preserves_acl_unknown() {
    for mode in ["standalone", "cluster", "fallback", "unknown"] {
        let m = mode.to_string();
        let (p, task) = server(move |a| match a[0].as_slice() {
            b"SELECT" => b"+OK\r\n".to_vec(),
            b"INFO" => match m.as_str() {
                "standalone" => bulk(b"cluster_enabled:0\r\n"),
                "cluster" => bulk(b"cluster_enabled:1\r\n"),
                _ => b"-NOPERM denied\r\n".to_vec(),
            },
            b"CLUSTER" => {
                if m == "fallback" {
                    b"-ERR This instance has cluster support disabled\r\n".to_vec()
                } else {
                    b"-NOPERM denied\r\n".to_vec()
                }
            }
            _ => panic!(),
        })
        .await;
        let mut c = Connection::open(&p, None).await.unwrap();
        let result = c.verify_topology().await;
        match mode {
            "cluster" => assert!(result.unwrap_err().starts_with("UNSUPPORTED")),
            "unknown" => assert!(!result.unwrap()),
            _ => assert!(result.unwrap()),
        }
        task.abort();
    }
}
#[tokio::test]
async fn fixed_database_sockets_do_not_share_select_state() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let mut db = b"0".to_vec();
                loop {
                    let Ok(Resp::Array(a)) = protocol::read(&mut socket).await else {
                        break;
                    };
                    let reply = if a[0].bytes().unwrap() == b"SELECT" {
                        db = a[1].bytes().unwrap().to_vec();
                        b"+OK\r\n".to_vec()
                    } else {
                        bulk(&db)
                    };
                    if socket.write_all(&reply).await.is_err() {
                        break;
                    }
                }
            });
        }
    });
    let mut p1 = profile(port);
    p1.db = 1;
    let mut p2 = p1.clone();
    p2.db = 2;
    let mut c1 = Connection::open(&p1, None).await.unwrap();
    let mut c2 = Connection::open(&p2, None).await.unwrap();
    for index in 0..3 {
        let (c, want) = if index == 1 {
            (&mut c2, "2")
        } else {
            (&mut c1, "1")
        };
        assert_eq!(
            c.command("GETRANGE", &[b"key", b"0", b"10"])
                .await
                .unwrap()
                .string()
                .unwrap(),
            want
        )
    }
    task.abort();
}
#[tokio::test]
async fn auth_failure_is_sanitized_and_tls_never_falls_back() {
    let (p, task) = server(|_| b"-WRONGPASS secret-in-server-reply\r\n".to_vec()).await;
    let err = Connection::open(&p, Some("local-secret"))
        .await
        .err()
        .unwrap();
    assert_eq!(err, "AUTH_FAILED: Authentication failed");
    task.abort();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut p = profile(listener.local_addr().unwrap().port());
    p.tls = true;
    let task = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        drop(socket)
    });
    let err = Connection::open(&p, None).await.err().unwrap();
    assert!(err.starts_with("TLS_FAILED"));
    task.await.unwrap();
}
#[test]
fn persisted_workspace_roundtrips_and_profile_delete_cascades() {
    let path =
        std::env::temp_dir().join(format!("woojoo-redis-store-{}.json", uuid::Uuid::new_v4()));
    let mut store = store::Store::open(path.clone()).unwrap();
    store.save_profile(profile(6379)).unwrap();
    store
        .save_view(SavedView {
            id: "cache".into(),
            profile_id: "fixture".into(),
            db: 0,
            name: "Cache".into(),
            kind: "cache".into(),
            pattern: "cache:*".into(),
            key_base64: "".into(),
            direction: "unknown".into(),
        })
        .unwrap();
    drop(store);
    let mut store = store::Store::open(path.clone()).unwrap();
    assert_eq!(store.workspace().profiles.len(), 1);
    assert_eq!(store.workspace().views[0].pattern, "cache:*");
    let disk = std::fs::read_to_string(&path).unwrap();
    assert!(!disk.contains("password"));
    store.delete_profile("fixture").unwrap();
    drop(store);
    let store = store::Store::open(path.clone()).unwrap();
    assert!(store.workspace().profiles.is_empty());
    assert!(store.workspace().views.is_empty());
    std::fs::remove_file(path).unwrap();
}
#[tokio::test]
async fn query_timeout_releases_active_request() {
    let (p, task) = server(|a| {
        if a[0] == b"SELECT" {
            b"+OK\r\n".to_vec()
        } else {
            vec![]
        }
    })
    .await;
    let state =
        State::new(std::env::temp_dir().join(format!("redis-{}.json", uuid::Uuid::new_v4())))
            .unwrap();
    state
        .sessions
        .lock()
        .unwrap()
        .insert("fixture".into(), Arc::new(Session::new(p, None)));
    let err = run(&state, request(b"key"), |mut c, _, _| async move {
        c.command("GETRANGE", &[b"key", b"0", b"1"]).await?;
        Ok(())
    })
    .await
    .unwrap_err();
    assert!(err.starts_with("TIMEOUT"));
    assert!(state.requests.lock().unwrap().is_empty());
    task.abort();
}

#[tokio::test]
async fn set_accepts_exact_65536_raw_bytes_despite_base64_padding() {
    let (p, task) = server(|a| match a[0].as_slice() {
        b"SELECT" => b"+OK\r\n".to_vec(),
        b"TYPE" => b"+set\r\n".to_vec(),
        b"PTTL" => b":-1\r\n".to_vec(),
        b"SCARD" => b":1\r\n".to_vec(),
        b"SSCAN" => array(vec![bulk(b"0"), array(vec![bulk(&vec![b'x'; 65536])])]),
        _ => panic!(),
    })
    .await;
    let session = Session::new(p, None);
    let mut c = session.open().await.unwrap();
    let value = values::read(&mut c, &session, &request(b"set"))
        .await
        .unwrap();
    assert_eq!(value.rows.len(), 1);
    assert_eq!(value.rows[0].cells[0].text.len(), 65536);
    assert!(value.next_cursor.is_none());
    task.abort();
}

#[tokio::test]
async fn flow_stream_baselines_and_detects_trim_without_consuming() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let seen = calls.clone();
    let (p, task) = server(move |args| {
        seen.lock().unwrap().push(args.clone());
        let entry = || {
            array(vec![
                bulk(b"9007199254740993-0"),
                array(vec![bulk(b"kind"), bulk(b"cache.hit")]),
            ])
        };
        match args[0].as_slice() {
            b"SELECT" => b"+OK\r\n".to_vec(),
            b"XREVRANGE" => array(vec![entry()]),
            b"XRANGE" if args[2] == args[3] => array(vec![]),
            b"XRANGE" => array(vec![entry()]),
            _ => panic!("not an observation read"),
        }
    })
    .await;
    let mut c = Connection::open(&p, None).await.unwrap();
    let baseline = flow::read(&mut c, &request(b"events"), None).await.unwrap();
    assert!(baseline.baseline);
    assert!(baseline.records.is_empty());
    assert_eq!(baseline.last_id, "9007199254740993-0");
    let batch = flow::read(&mut c, &request(b"events"), Some("1-0"))
        .await
        .unwrap();
    assert!(batch.gap);
    assert_eq!(batch.records[0].fields["kind"], "cache.hit");
    assert!(calls
        .lock()
        .unwrap()
        .iter()
        .all(|a| [b"SELECT".as_slice(), b"XRANGE", b"XREVRANGE"].contains(&a[0].as_slice())));
    task.abort();
}

#[tokio::test]
async fn notifications_are_binary_safe_and_disconnect_closes_subscriber() {
    let (p, task) = server(|args| match args[0].as_slice() {
        b"SELECT" => b"+OK\r\n".to_vec(),
        b"CONFIG" => array(vec![bulk(b"notify-keyspace-events"), bulk(b"KEA")]),
        b"PSUBSCRIBE" => {
            let mut reply = array(vec![
                bulk(b"psubscribe"),
                bulk(b"__keyevent@0__:*"),
                b":1\r\n".to_vec(),
            ]);
            reply.extend(array(vec![
                bulk(b"pmessage"),
                bulk(b"__keyevent@0__:*"),
                bulk(b"__keyevent@0__:set"),
                bulk(&[255, 0]),
            ]));
            reply
        }
        _ => panic!("unexpected command"),
    })
    .await;
    let session = Arc::new(Session::new(p, None));
    let started = notifications::start(&session).await.unwrap();
    let mut received = vec![];
    for _ in 0..100 {
        let batch = notifications::poll(&session, &started.subscription_id).unwrap();
        received.extend(batch.records);
        if !received.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    }
    assert_eq!(received[0].key_base64, "/wA=");
    assert_eq!(received[0].operation, "set");
    session.closed.send_replace(true);
    for _ in 0..100 {
        if !notifications::poll(&session, &started.subscription_id)
            .unwrap()
            .connected
        {
            task.abort();
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    }
    panic!("subscriber did not close");
}

/// Run only against an isolated disposable Redis with keyevent notifications enabled.
#[tokio::test]
#[ignore]
async fn live_flow_observation_transport() {
    let port = std::env::var("WOOJOO_FLOW_TEST_PORT")
        .expect("isolated Redis port required")
        .parse()
        .unwrap();
    let session = Arc::new(Session::new(profile(port), None));
    let mut c = session.open().await.unwrap();
    let key = format!("woojoo-flow-test:{}", uuid::Uuid::new_v4());
    let r = request(key.as_bytes());
    let initial = flow::read(&mut c, &r, None).await.unwrap();
    assert!(initial.baseline && initial.records.is_empty());
    let sub = notifications::start(&session).await.unwrap();
    // Test producer writes only to this randomly named stream in the disposable fixture.
    let mut producer = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    for index in 0..105 {
        protocol::send(
            &mut producer,
            &[
                b"XADD".to_vec(),
                key.as_bytes().to_vec(),
                b"*".to_vec(),
                b"kind".to_vec(),
                b"queue.enqueued".to_vec(),
                b"jobId".to_vec(),
                index.to_string().into_bytes(),
            ],
        )
        .await
        .unwrap();
        protocol::read(&mut producer).await.unwrap();
    }
    let first = flow::read(&mut c, &r, Some(&initial.last_id))
        .await
        .unwrap();
    assert_eq!(first.records.len(), 100);
    let second = flow::read(&mut c, &r, Some(&first.last_id)).await.unwrap();
    assert_eq!(second.records.len(), 5);
    assert!(!second.gap);
    let mut notifications_seen = 0;
    for _ in 0..100 {
        notifications_seen += notifications::poll(&session, &sub.subscription_id)
            .unwrap()
            .records
            .iter()
            .filter(|e| e.key_base64 == Bytes::new(key.as_bytes()).base64 && e.operation == "xadd")
            .count();
        if notifications_seen == 105 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    assert_eq!(notifications_seen, 105);
    protocol::send(
        &mut producer,
        &[
            b"XTRIM".to_vec(),
            key.as_bytes().to_vec(),
            b"MAXLEN".to_vec(),
            b"1".to_vec(),
        ],
    )
    .await
    .unwrap();
    protocol::read(&mut producer).await.unwrap();
    assert!(
        flow::read(&mut c, &r, Some(&first.last_id))
            .await
            .unwrap()
            .gap
    );
    assert_eq!(
        c.command("XLEN", &[key.as_bytes()])
            .await
            .unwrap()
            .string()
            .unwrap(),
        "1"
    );
    notifications::stop(&session, &sub.subscription_id);
    assert!(notifications::poll(&session, &sub.subscription_id).is_err());
    session.closed.send_replace(true);
}
