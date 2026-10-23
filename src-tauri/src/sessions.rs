use crate::db::{self, Column, DbResult, Pool, QueryResult, State};
use futures_util::TryStreamExt;
use serde::Serialize;
use sqlx::{Column as _, Either, Executor as _, Row as _, TypeInfo as _};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::Mutex;

enum Connection {
    Pg(sqlx::PgConnection),
    My(sqlx::MySqlConnection),
    Sqlite(sqlx::SqliteConnection),
}
pub(crate) struct Session {
    connection: Mutex<Connection>,
    control: Pool,
    server_id: i64,
    pub(crate) read_only: bool,
    cancelled: Arc<AtomicBool>,
    running: AtomicBool,
    manual: AtomicBool,
    transaction: AtomicBool,
    transaction_known: AtomicBool,
    /// Session default captured at connect: PostgreSQL search_path or MySQL database.
    default_schema: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionState {
    manual: bool,
    in_transaction: bool,
    transaction_state_known: bool,
    running: bool,
    read_only: bool,
}
impl Session {
    pub(crate) async fn external_schema_change<T>(&self, action: impl std::future::Future<Output=DbResult<T>>) -> DbResult<T> {
        let _guard = self.connection.lock().await;
        if self.manual.load(Ordering::SeqCst) || self.transaction.load(Ordering::SeqCst) || !self.transaction_known.load(Ordering::SeqCst) { return Err("먼저 SQL 세션의 트랜잭션을 완료하고 자동 커밋 모드로 전환하세요.".into()); }
        action.await
    }
    pub(crate) fn was_cancelled(&self) -> bool { self.cancelled.load(Ordering::SeqCst) }
    pub(crate) async fn new(pool: &Pool, read_only: bool) -> DbResult<Self> {
        let cancelled = Arc::new(AtomicBool::new(false));
        let (connection, server_id, default_schema) = match pool {
            Pool::Pg(p) => {
                let mut c = p.acquire().await.map_err(db::error)?.detach();
                sqlx::query("SET standard_conforming_strings=on")
                    .execute(&mut c)
                    .await
                    .map_err(db::error)?;
                let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
                    .fetch_one(&mut c)
                    .await
                    .map_err(db::error)?;
                let path: String = sqlx::query_scalar("SELECT current_setting('search_path')")
                    .fetch_one(&mut c)
                    .await
                    .map_err(db::error)?;
                (Connection::Pg(c), pid as i64, Some(path))
            }
            Pool::My(p) => {
                let mut c = p.acquire().await.map_err(db::error)?.detach();
                sqlx::query(
                    "SET SESSION sql_mode=CONCAT_WS(',',@@SESSION.sql_mode,'NO_BACKSLASH_ESCAPES')",
                )
                .execute(&mut c)
                .await
                .map_err(db::error)?;
                let pid: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
                    .fetch_one(&mut c)
                    .await
                    .map_err(db::error)?;
                let database: Option<String> = sqlx::query_scalar("SELECT DATABASE()")
                    .fetch_one(&mut c)
                    .await
                    .map_err(db::error)?;
                (Connection::My(c), pid as i64, database)
            }
            Pool::Sqlite(p) => {
                let mut c = p.acquire().await.map_err(db::error)?.detach();
                let flag = cancelled.clone();
                c.lock_handle()
                    .await
                    .map_err(db::error)?
                    .set_progress_handler(1000, move || !flag.load(Ordering::SeqCst));
                (Connection::Sqlite(c), 0, None)
            }
        };
        Ok(Self {
            connection: Mutex::new(connection),
            control: pool.clone(),
            server_id,
            read_only,
            cancelled,
            running: AtomicBool::new(false),
            manual: AtomicBool::new(false),
            transaction: AtomicBool::new(false),
            transaction_known: AtomicBool::new(true),
            default_schema,
        })
    }
    async fn set_manual(&self, manual: bool) -> DbResult<()> {
        let _guard = self.connection.lock().await;
        if self.read_only {
            return Err("읽기 전용 연결입니다.".into());
        }
        if !manual && self.state().in_transaction {
            return Err("먼저 커밋 또는 롤백하세요.".into());
        }
        self.manual.store(manual, Ordering::SeqCst);
        Ok(())
    }
    fn state(&self) -> ExecutionState {
        ExecutionState {
            manual: self.manual.load(Ordering::SeqCst),
            in_transaction: self.transaction.load(Ordering::SeqCst),
            transaction_state_known: self.transaction_known.load(Ordering::SeqCst),
            running: self.running.load(Ordering::SeqCst),
            read_only: self.read_only,
        }
    }
    pub(crate) async fn execute(&self, sql: String) -> DbResult<QueryResult> {
        self.execute_mode(sql, false, None).await
    }
    pub(crate) async fn execute_in(&self, sql: String, schema: Option<String>) -> DbResult<QueryResult> {
        self.execute_mode(sql, false, schema).await
    }
    async fn execute_object(&self, sql: String, schema: Option<String>) -> DbResult<QueryResult> {
        validate_object_sql(&sql, self.read_only, matches!(self.control, Pool::My(_)))?;
        self.execute_mode(sql, true, schema).await
    }
    /// Tabs share one session, so every run first selects its own schema (or restores the default).
    async fn select_schema(&self, conn: &mut Connection, schema: Option<&str>) -> DbResult<()> {
        match conn {
            Connection::Pg(c) => {
                let path = match schema {
                    Some(name) => format!("\"{}\"", name.replace('"', "\"\"")),
                    None => match &self.default_schema { Some(path) => path.clone(), None => return Ok(()) },
                };
                sqlx::query("SELECT set_config('search_path', $1, false)").bind(path).execute(&mut *c).await.map_err(db::error)?;
            }
            Connection::My(c) => {
                if let Some(name) = schema.map(str::to_owned).or_else(|| self.default_schema.clone()) {
                    // USE cannot be prepared; the identifier is quoted and backticks doubled.
                    (&mut *c).execute(format!("USE `{}`", name.replace('`', "``")).as_str()).await.map_err(db::error)?;
                }
            }
            Connection::Sqlite(_) => {}
        }
        Ok(())
    }
    #[allow(deprecated)]
    async fn execute_mode(&self, sql: String, object_sql: bool, schema: Option<String>) -> DbResult<QueryResult> {
        let words = if object_sql {
            scan_words(&sql, false)?
        } else {
            statement_words(&sql)?
        };
        let first = words
            .first()
            .map(String::as_str)
            .ok_or("SQL을 입력하세요.")?;
        if self.read_only && !matches!(first, "SELECT" | "WITH" | "EXPLAIN") {
            return Err("읽기 전용 연결: SELECT/WITH/EXPLAIN만 실행할 수 있습니다.".into());
        }
        let mut conn = self.connection.lock().await;
        self.select_schema(&mut conn, schema.as_deref()).await?;
        self.cancelled.store(false, Ordering::SeqCst);
        self.running.store(true, Ordering::SeqCst);
        let now = std::time::Instant::now();
        // Execute to completion even after the display cap, preserving connection protocol and write semantics.
        let result: DbResult<QueryResult> = async {
            if self.manual.load(Ordering::SeqCst)
                && !self.transaction.load(Ordering::SeqCst)
                && !matches!(first, "BEGIN" | "START" | "COMMIT" | "ROLLBACK" | "END")
            {
                match &mut *conn {
                    Connection::Pg(c) => {
                        sqlx::query("BEGIN")
                            .execute(&mut *c)
                            .await
                            .map_err(db::error)?;
                    }
                    Connection::My(c) => {
                        sqlx::query("BEGIN")
                            .execute(&mut *c)
                            .await
                            .map_err(db::error)?;
                    }
                    Connection::Sqlite(c) => {
                        sqlx::query("BEGIN")
                            .execute(&mut *c)
                            .await
                            .map_err(db::error)?;
                    }
                }
                self.transaction.store(true, Ordering::SeqCst);
            }
            let readonly = self.read_only;
            if readonly {
                match &mut *conn {
                    Connection::Pg(c) => {
                        sqlx::query("BEGIN READ ONLY")
                            .execute(&mut *c)
                            .await
                            .map_err(db::error)?;
                    }
                    Connection::My(c) => {
                        sqlx::query("START TRANSACTION READ ONLY")
                            .execute(&mut *c)
                            .await
                            .map_err(db::error)?;
                    }
                    Connection::Sqlite(c) => {
                        sqlx::query("PRAGMA query_only=ON")
                            .execute(&mut *c)
                            .await
                            .map_err(db::error)?;
                    }
                }
            }
            let mut output = QueryResult {
                columns: vec![],
                rows: vec![],
                elapsed_ms: 0,
                affected: 0,
                truncated: false,
            };
            macro_rules! run {
                ($c:expr,$value:path) => {{
                    if !object_sql {
                    let description = (&mut *$c).describe(&sql).await.map_err(db::error)?;
                    output.columns = description
                        .columns()
                        .iter()
                        .map(|c| Column {
                            name: c.name().into(),
                            data_type: c.type_info().name().into(),
                            primary: false,
                            editable: false,
                        })
                        .collect();
                    db::unique_columns(&output.columns)?;
                    }
                    // &str Executor uses COM_QUERY (no prepared describe). The explicit object command permits scripts.
                    let mut stream = if object_sql {(&mut *$c).fetch_many(sql.as_str())}else{sqlx::query(&sql).fetch_many(&mut *$c)};
                    while let Some(item) = stream.try_next().await.map_err(db::error)? {
                        match item {
                            Either::Left(r) => output.affected += r.rows_affected(),
                            Either::Right(r) => {
                                if object_sql {continue;} // DDL command drains incidental rowsets without presenting mixed schemas.
                                if output.columns.is_empty() {
                                    output.columns = r
                                        .columns()
                                        .iter()
                                        .map(|c| Column {
                                            name: c.name().into(),
                                            data_type: c.type_info().name().into(),
                                            primary: false,
                                            editable: false,
                                        })
                                        .collect();
                                    db::unique_columns(&output.columns)?;
                                }
                                if output.rows.len() >= db::result_limit() {
                                    output.truncated = true;
                                    continue;
                                }
                                output.rows.push(
                                    output
                                        .columns
                                        .iter()
                                        .enumerate()
                                        .map(|(i, c)| Ok((c.name.clone(), $value(&r, i)?)))
                                        .collect::<DbResult<_>>()?,
                                );
                            }
                        }
                    }
                }};
            }
            match &mut *conn {
                Connection::Pg(c) => run!(c, db::pg_value),
                Connection::My(c) => run!(c, db::my_value),
                Connection::Sqlite(c) => run!(c, db::sqlite_value),
            }
            output.elapsed_ms = now.elapsed().as_millis();
            Ok(output)
        }
        .await;
        if self.read_only {
            match &mut *conn {
                Connection::Pg(c) => {
                    let _ = sqlx::query("ROLLBACK").execute(&mut *c).await;
                }
                Connection::My(c) => {
                    let _ = sqlx::query("ROLLBACK").execute(&mut *c).await;
                }
                _ => {}
            }
        }
        if result.is_ok() && !self.read_only {
            if first == "BEGIN"
                || (first == "START" && words.get(1).map(String::as_str) == Some("TRANSACTION"))
            {
                self.transaction.store(true, Ordering::SeqCst);
            }
            if matches!(first, "COMMIT" | "END")
                || (first == "ROLLBACK" && words.get(1).map(String::as_str) != Some("TO"))
            {
                self.transaction.store(false, Ordering::SeqCst);
            }
            if matches!(&*conn, Connection::My(_))
                && matches!(
                    first,
                    "CREATE"
                        | "ALTER"
                        | "DROP"
                        | "TRUNCATE"
                        | "RENAME"
                        | "GRANT"
                        | "REVOKE"
                        | "LOCK"
                        | "UNLOCK"
                )
            {
                self.transaction.store(false, Ordering::SeqCst);
            }
        }
        if let Pool::Pg(p) = &self.control {
            if let Ok(Some(state)) =
                sqlx::query_scalar::<_, String>("SELECT state FROM pg_stat_activity WHERE pid=$1")
                    .bind(self.server_id as i32)
                    .fetch_optional(p)
                    .await
            {
                self.transaction
                    .store(state.starts_with("idle in transaction"), Ordering::SeqCst);
            }
        }
        if let Connection::My(c) = &mut *conn {
            let mut known = false;
            // MariaDB exposes an exact session flag; MySQL uses successful control statements and implicit-commit rules above.
            if let Ok(active) = sqlx::query_scalar::<_, i64>("SELECT @@session.in_transaction")
                .fetch_one(&mut *c)
                .await
            {
                self.transaction.store(active != 0, Ordering::SeqCst);
                known = true;
                self.transaction_known.store(true, Ordering::SeqCst);
            }
            if !known
                && !object_sql
                && matches!(
                    first,
                    "CREATE"
                        | "ALTER"
                        | "DROP"
                        | "TRUNCATE"
                        | "RENAME"
                        | "GRANT"
                        | "REVOKE"
                        | "LOCK"
                        | "UNLOCK"
                )
                && !words.iter().any(|w| w == "TEMPORARY")
            {
                self.transaction.store(false, Ordering::SeqCst);
            }
        }
        if object_sql && matches!(&*conn, Connection::My(_)) {
            // MySQL has no public SQLx transaction-status accessor. Arbitrary object scripts can change transaction state.
            // Require an explicit finish instead of presenting a guessed clean state.
            if let Connection::My(c) = &mut *conn {
                match sqlx::query_scalar::<_, i64>("SELECT @@session.in_transaction")
                    .fetch_one(&mut *c)
                    .await
                {
                    Ok(active) => {
                        self.transaction.store(active != 0, Ordering::SeqCst);
                        self.transaction_known.store(true, Ordering::SeqCst);
                    }
                    Err(_) => {
                        self.transaction.store(true, Ordering::SeqCst);
                        self.transaction_known.store(false, Ordering::SeqCst);
                    }
                }
            }
        } else if result.is_ok()
            && matches!(first, "COMMIT" | "ROLLBACK" | "END")
            && !words.iter().any(|w| w == "TO" || w == "CHAIN")
        {
            self.transaction_known.store(true, Ordering::SeqCst);
        }
        if let Connection::Sqlite(c) = &mut *conn {
            if let Ok(mut handle) = c.lock_handle().await {
                // Locked handle guarantees lifetime and exclusive access.
                let active = unsafe {
                    libsqlite3_sys::sqlite3_get_autocommit(handle.as_raw_handle().as_mut()) == 0
                };
                self.transaction.store(active, Ordering::SeqCst);
            }
        }
        self.running.store(false, Ordering::SeqCst);
        result
    }
    pub(crate) async fn cancel(&self) -> DbResult<()> {
        if !self.running.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.cancelled.store(true, Ordering::SeqCst);
        match &self.control {
            Pool::Pg(p) => {
                let ok: bool = sqlx::query_scalar("SELECT pg_cancel_backend($1)")
                    .bind(self.server_id as i32)
                    .fetch_one(p)
                    .await
                    .map_err(db::error)?;
                if !ok {
                    return Err("서버가 취소 요청을 거부했습니다.".into());
                }
            }
            Pool::My(p) => {
                sqlx::query(&format!("KILL QUERY {}", self.server_id))
                    .execute(p)
                    .await
                    .map_err(db::error)?;
            }
            Pool::Sqlite(_) => {}
        }
        Ok(())
    }
}
// Single statement lexer: strings, identifiers, dollar strings and comments are not SQL boundaries.
fn statement_words(sql: &str) -> DbResult<Vec<String>> {
    scan_words(sql, true)
}
fn scan_words(sql: &str, strict: bool) -> DbResult<Vec<String>> {
    let b = sql.as_bytes();
    let mut i = 0;
    let mut ended = false;
    let mut trigger_depth = 0usize;
    let mut words = vec![];
    while i < b.len() {
        if b[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if b[i..].starts_with(b"--") {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if b[i..].starts_with(b"/*") {
            if b.get(i + 2) == Some(&b'!') {
                return Err("Executable SQL comments are not supported".into());
            }
            i += 2;
            let mut depth = 1;
            while i < b.len() && depth > 0 {
                if b[i..].starts_with(b"/*") {
                    depth += 1;
                    i += 2;
                } else if b[i..].starts_with(b"*/") {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            if depth > 0 {
                return Err("Unterminated SQL comment".into());
            }
            continue;
        }
        if strict && ended {
            return Err("한 번에 한 SQL 문장을 실행하세요. 스크립트 실행을 사용하세요.".into());
        }
        if b[i] == b';' {
            ended = trigger_depth == 0;
            i += 1;
            continue;
        }
        if matches!(b[i], b'\'' | b'"' | b'`' | b'[') {
            let escape = i > 0
                && matches!(b[i - 1], b'E' | b'e')
                && (i == 1 || !b[i - 2].is_ascii_alphanumeric());
            let q = if b[i] == b'[' { b']' } else { b[i] };
            i += 1;
            let mut closed = false;
            while i < b.len() {
                if b[i] == q {
                    i += 1;
                    if i < b.len() && b[i] == q {
                        i += 1;
                    } else {
                        closed = true;
                        break;
                    }
                } else if escape && b[i] == b'\\' {
                    i = (i + 2).min(b.len());
                } else {
                    i += 1;
                }
            }
            if !closed {
                return Err("Unterminated SQL quote".into());
            }
            continue;
        }
        if b[i] == b'$' {
            let start = i;
            i += 1;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
                i += 1;
            }
            if i < b.len() && b[i] == b'$' {
                i += 1;
                let tag = &sql[start..i];
                if let Some(end) = sql[i..].find(tag) {
                    i += end + tag.len();
                    continue;
                } else {
                    return Err("Unterminated dollar string".into());
                }
            }
            i = start;
        }
        if b[i].is_ascii_alphabetic() {
            let start = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
                i += 1;
            }
            let word = sql[start..i].to_ascii_uppercase();
            if words.first().map(String::as_str) == Some("CREATE")
                && words.iter().any(|w| w == "TRIGGER")
            {
                if word == "BEGIN" || word == "CASE" && trigger_depth > 0 {
                    trigger_depth += 1;
                }
                if word == "END" && trigger_depth > 0 {
                    trigger_depth -= 1;
                }
            }
            words.push(word);
        } else {
            i += 1;
        }
    }
    Ok(words)
}
pub(crate) async fn session(state: &State, id: &str) -> DbResult<Arc<Session>> {
    state
        .sessions
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| "연결이 닫혔습니다.".into())
}
#[cfg(test)]
pub(crate) async fn execute(state: &State, id: &str, sql: String) -> DbResult<QueryResult> {
    session(state, id).await?.execute(sql).await
}
pub(crate) async fn execute_in(state: &State, id: &str, sql: String, schema: Option<String>) -> DbResult<QueryResult> {
    session(state, id).await?.execute_in(sql, schema).await
}
#[tauri::command]
pub async fn execution_state(
    state: tauri::State<'_, State>,
    id: String,
) -> DbResult<ExecutionState> {
    Ok(session(&state, &id).await?.state())
}
#[tauri::command]
pub async fn cancel_query(state: tauri::State<'_, State>, id: String) -> DbResult<()> {
    session(&state, &id).await?.cancel().await
}
#[tauri::command]
pub async fn transaction_mode(
    state: tauri::State<'_, State>,
    id: String,
    manual: bool,
) -> DbResult<ExecutionState> {
    let s = session(&state, &id).await?;
    s.set_manual(manual).await?;
    Ok(s.state())
}
#[tauri::command]
pub async fn transaction_finish(
    app: tauri::AppHandle,
    store: tauri::State<'_, crate::journal::Journal>,
    state: tauri::State<'_, State>,
    id: String,
    commit: bool,
) -> DbResult<ExecutionState> {
    let s = session(&state, &id).await?;
    let sql=if commit { "COMMIT" } else { "ROLLBACK" };
    crate::journal::record(&app, &store, &state, &id, sql, "transaction", s.execute(sql.into())).await?;
    Ok(s.state())
}
#[cfg(test)]
mod tests {
    use super::*;
    async fn fixture(readonly: bool) -> (Pool, Arc<Session>, std::path::PathBuf) {
        let path =
            std::env::temp_dir().join(format!("woojoo-session-{}.sqlite", uuid::Uuid::new_v4()));
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        let p = Pool::Sqlite(pool);
        let s = Arc::new(Session::new(&p, readonly).await.unwrap());
        (p, s, path)
    }
    async fn cleanup(p: Pool, s: Arc<Session>, path: std::path::PathBuf) {
        drop(s);
        if let Pool::Sqlite(p) = p {
            p.close().await;
        }
        // Detached SQLx SQLite workers release their file handles asynchronously.
        for attempt in 0..20 {
            match std::fs::remove_file(&path) {
                Ok(()) => return,
                Err(error) if attempt < 19 && error.raw_os_error() == Some(32) => {
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
                Err(error) => panic!("SQLite fixture cleanup failed: {error}"),
            }
        }
    }
    #[tokio::test]
    async fn manual_mode_begins_lazily_and_can_exit_after_finish() {
        let (p, s, path) = fixture(false).await;
        s.set_manual(true).await.unwrap();
        assert!(!s.state().in_transaction);
        s.execute("INSERT INTO sample VALUES(1,'first')".into())
            .await
            .unwrap();
        assert!(s.state().in_transaction);
        assert!(s.set_manual(false).await.is_err());
        s.execute("COMMIT".into()).await.unwrap();
        assert!(!s.state().in_transaction);
        assert!(s.state().manual);
        s.set_manual(false).await.unwrap();
        assert!(!s.state().manual);
        s.set_manual(true).await.unwrap();
        s.execute("SELECT * FROM sample".into()).await.unwrap();
        assert!(s.state().in_transaction);
        s.execute("ROLLBACK".into()).await.unwrap();
        s.set_manual(false).await.unwrap();
        cleanup(p, s, path).await;
    }
    #[tokio::test]
    async fn persistent_temp_tables_transactions_and_automatic_rollback() {
        let (p, s, path) = fixture(false).await;
        s.execute("CREATE TEMP TABLE scratch(value TEXT)".into())
            .await
            .unwrap();
        s.execute("INSERT INTO scratch VALUES('retained')".into())
            .await
            .unwrap();
        assert_eq!(
            s.execute("SELECT value FROM scratch".into())
                .await
                .unwrap()
                .rows[0]["value"],
            "retained"
        );
        s.execute("BEGIN".into()).await.unwrap();
        assert!(s.state().in_transaction);
        s.execute("INSERT INTO sample VALUES(1,'rollback')".into())
            .await
            .unwrap();
        s.execute("ROLLBACK".into()).await.unwrap();
        assert!(!s.state().in_transaction);
        assert_eq!(
            s.execute("SELECT count(*) AS n FROM sample".into())
                .await
                .unwrap()
                .rows[0]["n"],
            "0"
        );
        s.execute("BEGIN".into()).await.unwrap();
        s.execute("INSERT INTO sample VALUES(1,'first')".into())
            .await
            .unwrap();
        assert!(s
            .execute("INSERT OR ROLLBACK INTO sample VALUES(1,'conflict')".into())
            .await
            .is_err());
        assert!(!s.state().in_transaction);
        cleanup(p, s, path).await;
    }
    #[tokio::test]
    async fn readonly_rejects_writes_including_cte() {
        let (p, s, path) = fixture(true).await;
        assert!(s
            .execute("INSERT INTO sample VALUES(1,'bad')".into())
            .await
            .is_err());
        assert!(s
            .execute("WITH src AS (SELECT 1) INSERT INTO sample SELECT 1,'bad' FROM src".into())
            .await
            .is_err());
        assert!(s.execute("PRAGMA query_only=OFF".into()).await.is_err());
        assert_eq!(
            s.execute("SELECT count(*) AS n FROM sample".into())
                .await
                .unwrap()
                .rows[0]["n"],
            "0"
        );
        cleanup(p, s, path).await;
    }
    #[tokio::test]
    async fn sqlite_cancel_interrupts_worker_and_session_remains_usable() {
        let (p, s, path) = fixture(false).await;
        let running = s.clone();
        let task = tokio::spawn(async move {
            running.execute("WITH RECURSIVE cnt(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM cnt WHERE x<1000000000) SELECT sum(x) AS total FROM cnt".into()).await
        });
        while !s.state().running {
            tokio::task::yield_now().await;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        s.cancel().await.unwrap();
        let result = tokio::time::timeout(std::time::Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap();
        assert!(result.is_err());
        assert!(!s.state().running);
        assert_eq!(
            s.execute("SELECT 42 AS n".into()).await.unwrap().rows[0]["n"],
            "42"
        );
        cleanup(p, s, path).await;
    }
    #[test]
    fn statement_lexer_rejects_multiple_and_accepts_literals() {
        assert!(statement_words("SELECT 1; DELETE FROM sample").is_err());
        assert!(statement_words("SELECT ';' AS text; -- tail").is_ok());
        assert!(statement_words("SELECT E'escaped\\\'quote;still string'").is_ok());
        assert!(statement_words(
            "CREATE FUNCTION x() RETURNS text AS $$ SELECT ';'; $$ LANGUAGE sql"
        )
        .is_ok());
        assert!(statement_words("SELECT 1 /*! ; DROP TABLE x */").is_err());
        assert!(statement_words("CREATE TRIGGER t AFTER INSERT ON sample BEGIN SELECT 1; SELECT CASE WHEN 1 THEN 2 END; END;").is_ok());
        assert!(statement_words(
            "CREATE TRIGGER t AFTER INSERT ON sample BEGIN SELECT 1; END; DROP TABLE sample"
        )
        .is_err());
    }
}

fn validate_object_sql(sql: &str, read_only: bool, mysql: bool) -> DbResult<()> {
    if read_only {
        return Err("읽기 전용 연결에서는 객체 SQL을 실행할 수 없습니다.".into());
    }
    if !mysql {
        return Err("Object script execution is only available for MySQL/MariaDB.".into());
    }
    let words = scan_words(sql, false)?;
    if words.first().map(String::as_str) != Some("CREATE") {
        return Err("Object script must start with CREATE.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn run_object_sql(
    app: tauri::AppHandle,
    store: tauri::State<'_, crate::journal::Journal>,
    state: tauri::State<'_, State>,
    id: String,
    sql: String,
    schema: Option<String>,
) -> DbResult<QueryResult> {
    crate::journal::record(&app, &store, &state, &id, &sql, "object", async { session(&state, &id).await?.execute_object(sql.clone(), schema).await }).await
}

#[cfg(test)]
mod object_command_tests {
    use super::*;
    #[test]
    fn explicit_object_scripts_validate_policy_and_leading_create() {
        let sql="/* reviewed */ CREATE PROCEDURE p() BEGIN IF 1 THEN SELECT 1; END IF; END; CREATE VIEW v AS SELECT 1";
        assert!(validate_object_sql(sql, false, true).is_ok());
        assert!(validate_object_sql(sql, true, true).is_err());
        assert!(validate_object_sql(sql, false, false).is_err());
        assert!(validate_object_sql("SELECT 1; CREATE VIEW v AS SELECT 1", false, true).is_err());
        assert!(validate_object_sql(
            "CREATE PROCEDURE p() BEGIN SELECT 'unterminated",
            false,
            true
        )
        .is_err());
        assert!(validate_object_sql("/* CREATE */", false, true).is_err());
        assert!(statement_words(sql).is_err());
        assert!(statement_words("SELECT 1; SELECT 2").is_err());
    }
}
