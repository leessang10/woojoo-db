use crate::plan::{quote_ident, validate_edit};
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{
    mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow, MySqlSslMode},
    postgres::{PgConnectOptions, PgPoolOptions, PgRow, PgSslMode},
    Column as _, MySqlPool, PgPool, Row as _, TypeInfo, ValueRef,
};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use zeroize::Zeroize;

pub(crate) type Row = Map<String, Value>;
pub(crate) type DbResult<T> = Result<T, String>;
#[derive(Clone)]
pub(crate) enum Pool {
    Pg(PgPool),
    My(MySqlPool),
    Sqlite(sqlx::SqlitePool),
}
#[derive(Default)]
pub struct State {
    credentials: Mutex<crate::credentials::Store>,
    pub(crate) journal_contexts: Mutex<HashMap<String, crate::journal::Context>>,
    pools: Mutex<HashMap<String, Pool>>,
    identities: Mutex<HashMap<String, (String, String, u16, String, String, bool)>>,
    pub(crate) sessions: Mutex<HashMap<String, std::sync::Arc<crate::sessions::Session>>>,
}
#[derive(Deserialize)]
pub struct Profile {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    engine: String,
    host: String,
    port: u16,
    database: String,
    username: String,
    password: String,
    tls: bool,
    #[serde(default, rename = "readOnly")]
    read_only: bool,
    #[serde(default, rename = "rememberPassword")]
    remember_password: bool,
    /// PostgreSQL statement_timeout in seconds; 0 disables it.
    #[serde(default, rename = "queryTimeoutSeconds")]
    query_timeout_seconds: Option<u32>,
}
impl Profile {
    fn credential_identity(&self) -> crate::credentials::Identity {
        crate::credentials::Identity {
            engine: self.engine.clone(), host: self.host.clone(), port: self.port,
            database: self.database.clone(), username: self.username.clone(), tls: self.tls,
        }
    }
}
impl Drop for Profile {
    fn drop(&mut self) { self.password.zeroize(); }
}
#[derive(Deserialize, Serialize, Clone)]
pub struct Table {
    pub(crate) schema: String,
    pub(crate) name: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub(crate) name: String,
    pub(crate) data_type: String,
    pub(crate) primary: bool,
    pub(crate) editable: bool,
}
#[derive(Serialize)]
pub struct ErdTable {
    table: Table,
    pub(crate) columns: Vec<Column>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKey {
    id: String,
    pub(crate) name: String,
    source: Table,
    target: Table,
    source_columns: Vec<String>,
    target_columns: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErdSchema {
    tables: Vec<ErdTable>,
    foreign_keys: Vec<ForeignKey>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub(crate) columns: Vec<Column>,
    pub(crate) rows: Vec<Row>,
    pub(crate) elapsed_ms: u128,
    pub(crate) affected: u64,
    pub(crate) truncated: bool,
}
#[derive(Deserialize)]
pub struct Edit {
    original: Value,
    changes: Value,
}

pub(crate) fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn rds_ca(host: &str, tls: bool) -> Option<&'static [u8]> {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    // This bundle covers commercial regions only. Keep default trust roots for
    // other endpoints; never weaken certificate or hostname verification.
    (tls
        && host.ends_with(".rds.amazonaws.com")
        && !host.ends_with(".us-gov-east-1.rds.amazonaws.com")
        && !host.ends_with(".us-gov-west-1.rds.amazonaws.com"))
    .then_some(include_bytes!("../certs/aws-rds-global-bundle.pem").as_slice())
}
pub(crate) async fn pool(state: &State, id: &str) -> DbResult<Pool> {
    state
        .pools
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| "연결이 닫혔습니다. 다시 연결해 주세요.".into())
}
pub(crate) fn qualified(table: &Table, pg: bool) -> String {
    format!(
        "{}.{}",
        quote_ident(&table.schema, pg),
        quote_ident(&table.name, pg)
    )
}
#[tauri::command]
pub async fn connect_db(state: tauri::State<'_, State>, profile: Profile) -> DbResult<String> {
    connect(&state, profile).await
}
#[tauri::command]
pub async fn credential_status(state: tauri::State<'_, State>, profile: Profile) -> DbResult<crate::credentials::Status> {
    state.credentials.lock().await.status(&profile.id, &profile.credential_identity())
}
#[tauri::command]
pub async fn forget_password(state: tauri::State<'_, State>, profile_id: String) -> DbResult<()> {
    state.credentials.lock().await.forget(&profile_id)
}
async fn connect(state: &State, mut profile: Profile) -> DbResult<String> {
    if profile.engine == "sqlite" && profile.database.trim().is_empty() {
        return Err("데이터베이스 또는 SQLite 파일 경로를 입력하세요.".into());
    }
    if profile.engine != "sqlite"
        && (profile.host.trim().is_empty()
            || profile.username.trim().is_empty()
            || profile.port == 0)
    {
        return Err("호스트, 사용자 및 포트를 확인하세요.".into());
    }
    let revision = if profile.engine != "sqlite" {
        let credentials = state.credentials.lock().await;
        if profile.password.is_empty() {
            if let Some(password) = credentials.resolve(&profile.id, &profile.credential_identity())? {
                profile.password = password;
            }
        }
        credentials.revision(&profile.id)
    } else { 0 };
    let result = tokio::time::timeout(Duration::from_secs(12), async {
        match profile.engine.as_str() {
            "postgres" => {
                let options = PgConnectOptions::new()
                    .host(&profile.host)
                    .port(profile.port)
                    .database(if profile.database.trim().is_empty() { "postgres" } else { &profile.database })
                    .username(&profile.username)
                    .password(&profile.password)
                    .ssl_mode(if profile.tls {
                        PgSslMode::VerifyFull
                    } else {
                        PgSslMode::Disable
                    })
                    .options([("statement_timeout", (profile.query_timeout_seconds.unwrap_or(30) as u64 * 1000).to_string())]);
                let options = match rds_ca(&profile.host, profile.tls) {
                    Some(ca) => options.ssl_root_cert_from_pem(ca.to_vec()),
                    None => options,
                };
                PgPoolOptions::new()
                    .max_connections(3)
                    .acquire_timeout(Duration::from_secs(10))
                    .connect_with(options)
                    .await
                    .map(Pool::Pg)
                    .map_err(error)
            }
            "mysql" | "mariadb" => {
                let options = MySqlConnectOptions::new()
                    .host(&profile.host)
                    .port(profile.port)
                    .username(&profile.username)
                    .password(&profile.password)
                    .ssl_mode(if profile.tls {
                        MySqlSslMode::VerifyIdentity
                    } else {
                        MySqlSslMode::Disabled
                    });
                let options = if profile.database.trim().is_empty() { options } else { options.database(&profile.database) };
                let options = match rds_ca(&profile.host, profile.tls) {
                    Some(ca) => options.ssl_ca_from_pem(ca.to_vec()),
                    None => options,
                };
                MySqlPoolOptions::new()
                    .max_connections(3)
                    .acquire_timeout(Duration::from_secs(10))
                    .connect_with(options)
                    .await
                    .map(Pool::My)
                    .map_err(error)
            }
            "sqlite" => sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(3)
                .connect_with(
                    sqlx::sqlite::SqliteConnectOptions::new()
                        .filename(&profile.database)
                        .create_if_missing(!profile.read_only)
                        .read_only(profile.read_only)
                        .foreign_keys(true),
                )
                .await
                .map(Pool::Sqlite)
                .map_err(error),
            _ => Err("지원하지 않는 데이터베이스입니다.".into()),
        }
    })
    .await
    .map_err(|_| "연결 제한 시간(12초)을 초과했습니다.".to_string())??;
    let id = uuid::Uuid::new_v4().to_string();
    let session = crate::sessions::Session::new(&result, profile.read_only).await?;
    if profile.engine != "sqlite" {
        if let Err(e) = state.credentials.lock().await.remember(
            &profile.id, profile.credential_identity(), &profile.password, profile.remember_password, revision,
        ) {
            drop(session);
            match &result { Pool::Pg(p) => p.close().await, Pool::My(p) => p.close().await, Pool::Sqlite(p) => p.close().await }
            return Err(format!("비밀번호 저장 설정을 적용하지 못했습니다. 연결을 닫았습니다: {e}"));
        }
    }
    state
        .sessions
        .lock()
        .await
        .insert(id.clone(), std::sync::Arc::new(session));
    state.identities.lock().await.insert(
        id.clone(),
        (
            profile.engine.clone(),
            profile.host.clone(),
            profile.port,
            profile.database.clone(),
            profile.username.clone(),
            profile.tls,
        ),
    );
    state.journal_contexts.lock().await.insert(id.clone(), crate::journal::Context {profile_id:profile.id.clone(),connection_name:profile.name.clone(),engine:profile.engine.clone(),database:profile.database.clone()});
    state.pools.lock().await.insert(id.clone(), result);
    Ok(id)
}
#[tauri::command]
pub async fn disconnect_db(state: tauri::State<'_, State>, id: String) -> DbResult<()> {
    if let Some(session) = state.sessions.lock().await.remove(&id) {
        session.cancel().await?;
    }
    state.identities.lock().await.remove(&id);
    state.journal_contexts.lock().await.remove(&id);
    let connection = state.pools.lock().await.remove(&id);
    match connection {
        Some(Pool::Pg(p)) => p.close().await,
        Some(Pool::My(p)) => p.close().await,
        Some(Pool::Sqlite(p)) => p.close().await,
        None => (),
    };
    Ok(())
}
#[tauri::command]
pub async fn list_schemas(state: tauri::State<'_, State>, id: String) -> DbResult<Vec<String>> {
    match pool(&state, &id).await? {
        Pool::Sqlite(_) => Ok(vec!["main".into()]),
        Pool::Pg(p) => sqlx::query_scalar("SELECT nspname::text FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%' AND has_schema_privilege(oid, 'USAGE') ORDER BY nspname").fetch_all(&p).await.map_err(error),
        Pool::My(p) => sqlx::query("SELECT SCHEMA_NAME FROM information_schema.schemata WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys') ORDER BY SCHEMA_NAME").fetch_all(&p).await.map_err(error)?.into_iter().map(|row| row.try_get_unchecked(0).map_err(error)).collect(),
    }
}
#[tauri::command]
pub async fn list_tables(state: tauri::State<'_, State>, id: String) -> DbResult<Vec<Table>> {
    tables(&state, id).await
}
async fn tables(state: &State, id: String) -> DbResult<Vec<Table>> {
    match pool(&state, &id).await? {
        Pool::Sqlite(p) => sqlx::query("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetch_all(&p).await.map_err(error)?.into_iter().map(|r| Ok(Table {schema:"main".into(),name:r.try_get(0).map_err(error)?})).collect(),
        Pool::Pg(p) => sqlx::query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema,table_name")
            .fetch_all(&p).await.map_err(error)?.into_iter().map(|r| Ok(Table {schema:r.try_get(0).map_err(error)?,name:r.try_get(1).map_err(error)?})).collect(),
        Pool::My(p) => sqlx::query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('information_schema','mysql','performance_schema','sys') ORDER BY table_schema,table_name")
            .fetch_all(&p).await.map_err(error)?.into_iter().map(|r| Ok(Table {schema:r.try_get_unchecked(0).map_err(error)?,name:r.try_get_unchecked(1).map_err(error)?})).collect(),
    }
}
fn editable_type(kind: &str) -> bool {
    matches!(
        kind.to_lowercase().as_str(),
        "text"
            | "character varying"
            | "character"
            | "varchar"
            | "char"
            | "tinytext"
            | "mediumtext"
            | "longtext"
            | "smallint"
            | "integer"
            | "bigint"
            | "tinyint"
            | "int"
            | "mediumint"
            | "decimal"
            | "numeric"
            | "boolean"
            | "date"
            | "timestamp without time zone"
            | "timestamp with time zone"
            | "timestamp"
            | "datetime"
            | "uuid"
            | "json"
            | "jsonb"
    )
}
pub(crate) async fn metadata(pool: &Pool, table: &Table) -> DbResult<Vec<Column>> {
    let columns = match pool {
        Pool::Sqlite(p) => {
            sqlx::query("SELECT name,type,pk,hidden FROM pragma_table_xinfo(?,?) ORDER BY cid")
                .bind(&table.name)
                .bind(&table.schema)
                .fetch_all(p)
                .await
                .map_err(error)?
                .into_iter()
                .map(|r| {
                    let primary = r.get::<i64, _>("pk") != 0;
                    Ok(Column {
                        name: r.get("name"),
                        data_type: r.get("type"),
                        primary,
                        editable: !primary && r.get::<i64, _>("hidden") == 0,
                    })
                })
                .collect::<DbResult<Vec<_>>>()?
        }
        Pool::Pg(p) => {
            let rows = sqlx::query("SELECT c.column_name,c.data_type,c.is_generated,c.is_identity,EXISTS(SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k ON tc.constraint_name=k.constraint_name AND tc.constraint_schema=k.constraint_schema AND tc.table_name=k.table_name WHERE tc.constraint_type='PRIMARY KEY' AND k.table_schema=c.table_schema AND k.table_name=c.table_name AND k.column_name=c.column_name) AS pk FROM information_schema.columns c WHERE c.table_schema=$1 AND c.table_name=$2 ORDER BY c.ordinal_position")
                .bind(&table.schema).bind(&table.name).fetch_all(p).await.map_err(error)?;
            rows.into_iter()
                .map(|r| {
                    let data_type: String = r.try_get(1).map_err(error)?;
                    let primary: bool = r.try_get(4).map_err(error)?;
                    let generated: String = r.try_get(2).map_err(error)?;
                    let identity: String = r.try_get(3).map_err(error)?;
                    Ok(Column {
                        name: r.try_get(0).map_err(error)?,
                        editable: !primary
                            && generated == "NEVER"
                            && identity == "NO"
                            && data_type != "json"
                            && editable_type(&data_type),
                        data_type,
                        primary,
                    })
                })
                .collect::<DbResult<Vec<_>>>()?
        }
        Pool::My(p) => {
            let rows = sqlx::query("SELECT COLUMN_NAME,DATA_TYPE,COLUMN_KEY,EXTRA FROM information_schema.columns WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION")
                .bind(&table.schema).bind(&table.name).fetch_all(p).await.map_err(error)?;
            rows.into_iter()
                .map(|r| {
                    let data_type: String = r.try_get_unchecked(1).map_err(error)?;
                    let primary = r.try_get_unchecked::<String, _>(2).map_err(error)? == "PRI";
                    let extra: String = r.try_get_unchecked(3).map_err(error)?;
                    Ok(Column {
                        name: r.try_get_unchecked(0).map_err(error)?,
                        editable: !primary
                            && !extra.contains("GENERATED")
                            && !extra.contains("auto_increment")
                            && editable_type(&data_type),
                        data_type,
                        primary,
                    })
                })
                .collect::<DbResult<Vec<_>>>()?
        }
    };
    if columns.is_empty() {
        return Err("테이블이 없거나 메타데이터를 읽을 권한이 없습니다.".into());
    }
    Ok(columns)
}
#[tauri::command]
pub async fn read_erd(
    state: tauri::State<'_, State>,
    id: String,
    schema: String,
) -> DbResult<ErdSchema> {
    let p = pool(&state, &id).await?;
    let rows: Vec<(String, String, String, String, String, String, String)> = match &p {
        Pool::Sqlite(p) => { let mut result = vec![]; for t in tables(&state,id.clone()).await?.into_iter().filter(|t|t.schema==schema) { for r in sqlx::query(r#"SELECT id,seq,"table","from","to" FROM pragma_foreign_key_list(?,?) ORDER BY id,seq"#).bind(&t.name).bind(&schema).fetch_all(p).await.map_err(error)? { result.push((format!("fk_{}",r.get::<i64,_>(0)),schema.clone(),t.name.clone(),r.get(3),schema.clone(),r.get(2),r.try_get::<Option<String>,_>(4).map_err(error)?.unwrap_or_default())); } } result },
        Pool::Pg(p) => sqlx::query(
            "SELECT con.conname, ns.nspname, src.relname, sa.attname, nt.nspname, dst.relname, ta.attname
             FROM pg_catalog.pg_constraint con
             JOIN pg_catalog.pg_class src ON src.oid=con.conrelid
             JOIN pg_catalog.pg_namespace ns ON ns.oid=src.relnamespace
             JOIN pg_catalog.pg_class dst ON dst.oid=con.confrelid
             JOIN pg_catalog.pg_namespace nt ON nt.oid=dst.relnamespace
             JOIN LATERAL unnest(con.conkey) WITH ORDINALITY sk(attnum, ord) ON true
             JOIN LATERAL unnest(con.confkey) WITH ORDINALITY tk(attnum, ord) ON sk.ord=tk.ord
             JOIN pg_catalog.pg_attribute sa ON sa.attrelid=src.oid AND sa.attnum=sk.attnum
             JOIN pg_catalog.pg_attribute ta ON ta.attrelid=dst.oid AND ta.attnum=tk.attnum
             WHERE con.contype='f' AND ns.nspname=$1
             ORDER BY ns.nspname,src.relname,con.conname,sk.ord")
            .bind(&schema).fetch_all(p).await.map_err(error)?
            .into_iter().map(|r| Ok((r.try_get(0).map_err(error)?,r.try_get(1).map_err(error)?,r.try_get(2).map_err(error)?,r.try_get(3).map_err(error)?,r.try_get(4).map_err(error)?,r.try_get(5).map_err(error)?,r.try_get(6).map_err(error)?))).collect::<DbResult<_>>()?,
        Pool::My(p) => sqlx::query(
            "SELECT CONSTRAINT_NAME,TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_SCHEMA,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME
             FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL
             ORDER BY TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION")
            .bind(&schema).fetch_all(p).await.map_err(error)?
            .into_iter().map(|r| Ok((r.try_get_unchecked(0).map_err(error)?,r.try_get_unchecked(1).map_err(error)?,r.try_get_unchecked(2).map_err(error)?,r.try_get_unchecked(3).map_err(error)?,r.try_get_unchecked(4).map_err(error)?,r.try_get_unchecked(5).map_err(error)?,r.try_get_unchecked(6).map_err(error)?))).collect::<DbResult<_>>()?,
    };
    let mut foreign_keys: Vec<ForeignKey> = vec![];
    for (name, ss, st, sc, ts, tt, tc) in rows {
        let key = serde_json::to_string(&(&ss, &st, &name)).map_err(error)?;
        if let Some(fk) = foreign_keys.iter_mut().find(|fk| fk.id == key) {
            fk.source_columns.push(sc);
            fk.target_columns.push(tc);
        } else {
            foreign_keys.push(ForeignKey {
                id: key,
                name,
                source: Table {
                    schema: ss,
                    name: st,
                },
                target: Table {
                    schema: ts,
                    name: tt,
                },
                source_columns: vec![sc],
                target_columns: vec![tc],
            });
        }
    }
    let mut selected: Vec<Table> = tables(&state, id)
        .await?
        .into_iter()
        .filter(|table| table.schema == schema)
        .collect();
    for fk in &foreign_keys {
        if !selected
            .iter()
            .any(|table| table.schema == fk.target.schema && table.name == fk.target.name)
        {
            selected.push(fk.target.clone());
        }
    }
    use futures_util::StreamExt;
    let tables = futures_util::stream::iter(selected)
        .map(|table| {
            let p = p.clone();
            async move {
                Ok::<ErdTable, String>(ErdTable {
                    columns: metadata(&p, &table).await?,
                    table,
                })
            }
        })
        .buffered(3)
        .try_collect::<Vec<_>>()
        .await?;
    Ok(ErdSchema {
        tables,
        foreign_keys,
    })
}
#[tauri::command]
pub async fn describe_table(
    state: tauri::State<'_, State>,
    id: String,
    table: Table,
) -> DbResult<Vec<Value>> {
    crate::structure::columns(&pool(&state, &id).await?, &table).await
}
#[tauri::command]
pub async fn read_table(
    state: tauri::State<'_, State>,
    id: String,
    table: Table,
) -> DbResult<QueryResult> {
    read(&state, id, table).await
}
async fn read(state: &State, id: String, table: Table) -> DbResult<QueryResult> {
    let now = Instant::now();
    let p = pool(&state, &id).await?;
    let columns = metadata(&p, &table).await?;
    let pg = matches!(p, Pool::Pg(_));
    let projection = columns
        .iter()
        .map(|c| {
            let q = quote_ident(&c.name, pg);
            if pg {
                format!("CAST({q} AS TEXT) AS {q}")
            } else if matches!(
                c.data_type.as_str(),
                "blob" | "binary" | "varbinary" | "tinyblob" | "mediumblob" | "longblob" | "bit"
            ) {
                format!("HEX({q}) AS {q}")
            } else {
                format!("CAST({q} AS CHAR) AS {q}")
            }
        })
        .collect::<Vec<_>>()
        .join(",");
    let order = columns
        .iter()
        .filter(|c| c.primary)
        .map(|c| quote_ident(&c.name, pg))
        .collect::<Vec<_>>();
    let sql = format!(
        "SELECT {projection} FROM {}{} LIMIT 501",
        qualified(&table, pg),
        if order.is_empty() {
            String::new()
        } else {
            format!(" ORDER BY {}", order.join(","))
        }
    );
    let mut rows = match p {
        Pool::Sqlite(p) => sqlx::query(&sql)
            .fetch_all(&p)
            .await
            .map_err(error)?
            .into_iter()
            .map(|r| {
                columns
                    .iter()
                    .enumerate()
                    .map(|(i, c)| Ok((c.name.clone(), sqlite_value(&r, i)?)))
                    .collect::<DbResult<Row>>()
            })
            .collect::<DbResult<Vec<_>>>()?,
        Pool::Pg(p) => sqlx::query(&sql)
            .fetch_all(&p)
            .await
            .map_err(error)?
            .into_iter()
            .map(|r| {
                columns
                    .iter()
                    .enumerate()
                    .map(|(i, c)| {
                        Ok((
                            c.name.clone(),
                            r.try_get::<Option<String>, _>(i)
                                .map_err(error)?
                                .map(Value::String)
                                .unwrap_or(Value::Null),
                        ))
                    })
                    .collect::<DbResult<Row>>()
            })
            .collect::<DbResult<Vec<_>>>()?,
        Pool::My(p) => sqlx::query(&sql)
            .fetch_all(&p)
            .await
            .map_err(error)?
            .into_iter()
            .map(|r| {
                // These expressions are CAST(... AS CHAR) or HEX, even when MySQL reports binary collation.
                columns
                    .iter()
                    .enumerate()
                    .map(|(i, c)| {
                        Ok((
                            c.name.clone(),
                            r.try_get_unchecked::<Option<String>, _>(i)
                                .map_err(error)?
                                .map(Value::String)
                                .unwrap_or(Value::Null),
                        ))
                    })
                    .collect::<DbResult<Row>>()
            })
            .collect::<DbResult<Vec<_>>>()?,
    };
    let truncated = rows.len() > 500;
    rows.truncate(500);
    Ok(QueryResult {
        columns,
        rows,
        elapsed_ms: now.elapsed().as_millis(),
        affected: 0,
        truncated,
    })
}
pub(crate) fn pg_value(r: &PgRow, i: usize) -> DbResult<Value> {
    if r.try_get_raw(i).map_err(error)?.is_null() {
        return Ok(Value::Null);
    }
    macro_rules! attempt {
        ($ty:ty) => {
            if let Ok(v) = r.try_get::<$ty, _>(i) {
                return Ok(Value::String(v.to_string()));
            }
        };
    }
    attempt!(String);
    attempt!(i64);
    attempt!(i32);
    attempt!(i16);
    attempt!(bool);
    if let Ok(v) = r.try_get::<bigdecimal::BigDecimal, _>(i) {
        return Ok(Value::String(v.normalized().to_string()));
    }
    attempt!(f64);
    attempt!(f32);
    attempt!(chrono::NaiveDate);
    attempt!(chrono::NaiveDateTime);
    attempt!(chrono::DateTime<chrono::Utc>);
    attempt!(chrono::NaiveTime);
    attempt!(uuid::Uuid);
    attempt!(Value);
    if let Ok(bytes) = r.try_get::<Vec<u8>, _>(i) {
        return Ok(Value::String(format!(
            "0x{}",
            bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
        )));
    }
    Ok(Value::String(format!(
        "[{} · 테이블 보기에서 확인]",
        r.columns()[i].type_info().name()
    )))
}
pub(crate) fn my_value(r: &MySqlRow, i: usize) -> DbResult<Value> {
    if r.try_get_raw(i).map_err(error)?.is_null() {
        return Ok(Value::Null);
    }
    macro_rules! attempt {
        ($ty:ty) => {
            if let Ok(v) = r.try_get::<$ty, _>(i) {
                return Ok(Value::String(v.to_string()));
            }
        };
    }
    attempt!(String);
    attempt!(i64);
    attempt!(u64);
    attempt!(i32);
    attempt!(u32);
    attempt!(i16);
    attempt!(i8);
    if let Ok(v) = r.try_get::<bigdecimal::BigDecimal, _>(i) {
        return Ok(Value::String(v.normalized().to_string()));
    }
    attempt!(f64);
    attempt!(f32);
    attempt!(bool);
    attempt!(chrono::NaiveDate);
    attempt!(chrono::NaiveDateTime);
    attempt!(chrono::NaiveTime);
    attempt!(Value);
    if let Ok(bytes) = r.try_get::<Vec<u8>, _>(i) {
        return Ok(Value::String(format!(
            "0x{}",
            bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
        )));
    }
    Ok(Value::String(format!(
        "[{} · 지원하지 않는 표시 형식]",
        r.columns()[i].type_info().name()
    )))
}
pub(crate) fn unique_columns(columns: &[Column]) -> DbResult<()> {
    let mut names = std::collections::HashSet::new();
    if columns.iter().any(|c| !names.insert(&c.name)) {
        return Err("중복된 결과 열 이름이 있습니다. SQL의 AS 별칭으로 구분하세요.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn run_query(
    app: tauri::AppHandle,
    store: tauri::State<'_, crate::journal::Journal>,
    state: tauri::State<'_, State>,
    id: String,
    sql: String,
    schema: Option<String>,
) -> DbResult<QueryResult> {
    crate::journal::record(&app, &store, &state, &id, &sql, "sql", crate::sessions::execute_in(&state, &id, sql.clone(), schema)).await
}
#[cfg(test)]
async fn execute_query(pool: Pool, sql: String) -> DbResult<QueryResult> {
    let session = crate::sessions::Session::new(&pool, false).await?;
    session.execute(sql).await
}
pub(crate) fn sqlite_value(r: &sqlx::sqlite::SqliteRow, i: usize) -> DbResult<Value> {
    if r.try_get_raw(i).map_err(error)?.is_null() {
        return Ok(Value::Null);
    }
    if let Ok(v) = r.try_get::<String, _>(i) {
        return Ok(Value::String(v));
    }
    if let Ok(v) = r.try_get::<i64, _>(i) {
        return Ok(Value::String(v.to_string()));
    }
    if let Ok(v) = r.try_get::<f64, _>(i) {
        return Ok(Value::String(v.to_string()));
    }
    if let Ok(v) = r.try_get::<Vec<u8>, _>(i) {
        return Ok(Value::String(format!(
            "0x{}",
            v.iter().map(|b| format!("{b:02x}")).collect::<String>()
        )));
    }
    Err("Unsupported SQLite value".into())
}
pub(crate) async fn ensure_writable(state: &State, id: &str) -> DbResult<()> {
    if crate::sessions::session(state, id).await?.read_only {
        Err("읽기 전용 연결에서는 변경할 수 없습니다.".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn apply_edits(
    state: tauri::State<'_, State>,
    id: String,
    table: Table,
    edits: Vec<Edit>,
) -> DbResult<usize> {
    apply(&state, id, table, edits).await
}
async fn apply(state: &State, id: String, table: Table, edits: Vec<Edit>) -> DbResult<usize> {
    ensure_writable(state, &id).await?;
    if edits.is_empty() || edits.len() > 500 {
        return Err("1~500개의 변경 행이 필요합니다.".into());
    }
    let p = pool(&state, &id).await?;
    let columns = metadata(&p, &table).await?;
    let keys: Vec<String> = columns
        .iter()
        .filter(|c| c.primary)
        .map(|c| c.name.clone())
        .collect();
    let allowed: Vec<String> = columns
        .iter()
        .filter(|c| c.editable)
        .map(|c| c.name.clone())
        .collect();
    for edit in &edits {
        validate_edit(&allowed, &keys, &edit.original, &edit.changes)?;
    }
    let count = edits.len();
    match p {
        Pool::Sqlite(p) => {
            let mut tx = p.begin().await.map_err(error)?;
            for edit in &edits {
                let changes = edit.changes.as_object().unwrap();
                let condition_keys: Vec<&String> = keys.iter().chain(changes.keys()).collect();
                let assignments = changes
                    .keys()
                    .map(|k| format!("{}=?", quote_ident(k, true)))
                    .collect::<Vec<_>>()
                    .join(",");
                let conditions = condition_keys
                    .iter()
                    .map(|k| format!("CAST({} AS TEXT) IS ?", quote_ident(k, true)))
                    .collect::<Vec<_>>()
                    .join(" AND ");
                let sql = format!(
                    "UPDATE {} SET {assignments} WHERE {conditions}",
                    qualified(&table, true)
                );
                let mut q = sqlx::query(&sql);
                for v in changes.values() {
                    q = q.bind(v.as_str());
                }
                for k in condition_keys {
                    q = q.bind(edit.original[k].as_str());
                }
                if q.execute(&mut *tx).await.map_err(error)?.rows_affected() != 1 {
                    return Err("행 변경 충돌: 전체 변경을 취소했습니다.".into());
                }
            }
            tx.commit().await.map_err(error)?;
        }
        Pool::Pg(p) => {
            let mut tx = p.begin().await.map_err(error)?;
            let table_name = qualified(&table, true);
            for edit in &edits {
                let changes = edit.changes.as_object().unwrap();
                let assignments = changes
                    .keys()
                    .map(|k| {
                        let q = quote_ident(k, true);
                        format!("{q}=(json_populate_record(NULL::{table_name},$1::json)).{q}")
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                let condition=keys.iter().chain(changes.keys()).map(|k|{let q=quote_ident(k,true);format!("{q} IS NOT DISTINCT FROM (json_populate_record(NULL::{table_name},$2::json)).{q}")}).collect::<Vec<_>>().join(" AND ");
                let sql = format!("UPDATE {table_name} SET {assignments} WHERE {condition}");
                let affected = sqlx::query(&sql)
                    .bind(sqlx::types::Json(&edit.changes))
                    .bind(sqlx::types::Json(&edit.original))
                    .execute(&mut *tx)
                    .await
                    .map_err(error)?
                    .rows_affected();
                if affected != 1 {
                    return Err("다른 사용자가 행을 수정했거나 삭제했습니다. 전체 변경을 취소했습니다. 새로고침 후 다시 시도하세요.".into());
                }
            }
            tx.commit().await.map_err(error)?;
        }
        Pool::My(p) => {
            // Non-transactional engines cannot promise batch rollback.
            let engine:Option<String>=sqlx::query_scalar("SELECT ENGINE FROM information_schema.tables WHERE TABLE_SCHEMA=? AND TABLE_NAME=?")
                .bind(&table.schema).bind(&table.name).fetch_optional(&p).await.map_err(error)?;
            if engine.as_deref() != Some("InnoDB") {
                return Err("안전한 일괄 편집은 InnoDB 테이블에서만 지원합니다.".into());
            }
            let mut tx = p.begin().await.map_err(error)?;
            for edit in &edits {
                let changes = edit.changes.as_object().unwrap();
                let assignments = changes
                    .keys()
                    .map(|k| format!("{}=?", quote_ident(k, false)))
                    .collect::<Vec<_>>()
                    .join(",");
                let condition_keys: Vec<&String> = keys.iter().chain(changes.keys()).collect();
                let condition = condition_keys
                    .iter()
                    .map(|k| {
                        format!(
                            "CAST({} AS BINARY) <=> CAST(? AS BINARY)",
                            quote_ident(k, false)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(" AND ");
                let sql = format!(
                    "UPDATE {} SET {assignments} WHERE {condition}",
                    qualified(&table, false)
                );
                let mut query = sqlx::query(&sql);
                for val in changes.values() {
                    query = query.bind(val.as_str());
                }
                for key in condition_keys {
                    query = query.bind(edit.original[key].as_str());
                }
                let affected = query
                    .execute(&mut *tx)
                    .await
                    .map_err(error)?
                    .rows_affected();
                if affected != 1 {
                    return Err("행 변경 충돌이 발생했습니다. 전체 변경을 취소했습니다. 새로고침 후 다시 시도하세요.".into());
                }
            }
            tx.commit().await.map_err(error)?;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use serde_json::json;

    // Only explicitly requested, disposable local DBs are used. Never reads user profiles.
    #[tokio::test]
    #[ignore = "requires the three documented disposable Docker containers"]
    async fn postgres_mysql_mariadb_roundtrip_and_atomic_conflict() {
        for (engine, port) in [("postgres", 55439), ("mysql", 53309), ("mariadb", 53310)] {
            let state = State::default();
            let id = connect(
                &state,
                Profile {
                    id:"test".into(), name:"Test".into(),
                    engine: engine.into(),
                    host: "127.0.0.1".into(),
                    port,
                    database: "woojoo_test".into(),
                    username: if engine == "postgres" {
                        "postgres".into()
                    } else {
                        "root".into()
                    },
                    password: "woojoo-local-test".into(),
                    tls: false,
                    read_only: false,
                    remember_password: false,
                    query_timeout_seconds: None,
                },
            )
            .await
            .unwrap();
            let p = pool(&state, &id).await.unwrap();
            execute_query(p.clone(), "DROP TABLE IF EXISTS woojoo_roundtrip".into())
                .await
                .unwrap();
            execute_query(p.clone(),"CREATE TABLE woojoo_roundtrip (id BIGINT PRIMARY KEY, name VARCHAR(100), amount DECIMAL(30,5))".into()).await.unwrap();
            execute_query(p.clone(),"INSERT INTO woojoo_roundtrip VALUES (9007199254740993,'Original',12345678901234567890.12345),(2,NULL,0)".into()).await.unwrap();
            let table = Table {
                schema: if engine == "postgres" {
                    "public".into()
                } else {
                    "woojoo_test".into()
                },
                name: "woojoo_roundtrip".into(),
            };
            assert!(tables(&state, id.clone())
                .await
                .unwrap()
                .iter()
                .any(|t| t.name == table.name));
            let result = read(&state, id.clone(), table.clone()).await.unwrap();
            let original = result
                .rows
                .iter()
                .find(|r| r["id"] == "9007199254740993")
                .unwrap()
                .clone();
            assert_eq!(original["amount"], "12345678901234567890.12345");
            assert!(result
                .columns
                .iter()
                .any(|c| c.name == "id" && c.primary && !c.editable));
            let old = Value::Object(original.clone());
            apply(
                &state,
                id.clone(),
                table.clone(),
                vec![Edit {
                    original: old.clone(),
                    changes: json!({"name":"Edited"}),
                }],
            )
            .await
            .unwrap();
            // A stale second edit must roll back an earlier successful row edit in the same batch.
            let other = Value::Object(result.rows.iter().find(|r| r["id"] == "2").unwrap().clone());
            assert!(apply(
                &state,
                id.clone(),
                table.clone(),
                vec![
                    Edit {
                        original: other,
                        changes: json!({"name":"Must rollback"})
                    },
                    Edit {
                        original: old,
                        changes: json!({"name":"Stale write"})
                    },
                ]
            )
            .await
            .is_err());
            let after = read(&state, id.clone(), table.clone()).await.unwrap();
            assert!(after.rows.iter().find(|r| r["id"] == "2").unwrap()["name"].is_null());
            let changed = after
                .rows
                .iter()
                .find(|r| r["id"] == "9007199254740993")
                .unwrap()
                .clone();
            assert_eq!(changed["name"], "Edited");
            apply(
                &state,
                id.clone(),
                table.clone(),
                vec![Edit {
                    original: Value::Object(changed),
                    changes: json!({"name":null}),
                }],
            )
            .await
            .unwrap();
            let query = execute_query(
                p.clone(),
                "SELECT id,amount FROM woojoo_roundtrip WHERE id=9007199254740993".into(),
            )
            .await
            .unwrap();
            assert_eq!(query.rows[0]["id"], "9007199254740993");
            assert_eq!(query.rows[0]["amount"], "12345678901234567890.12345");
            assert!(
                execute_query(p.clone(), "SELECT 1 AS duplicate, 2 AS duplicate".into())
                    .await
                    .is_err()
            );
            execute_query(p.clone(), "DROP TABLE woojoo_roundtrip".into())
                .await
                .unwrap();
            match p {
                Pool::Pg(p) => p.close().await,
                Pool::My(p) => p.close().await,
                Pool::Sqlite(p) => p.close().await,
            };
        }
    }
}
#[tauri::command]
pub async fn choose_sqlite_file(create: bool) -> DbResult<Option<String>> {
    let dialog = rfd::AsyncFileDialog::new()
        .add_filter("SQLite", &["db", "sqlite", "sqlite3"])
        .add_filter("All files", &["*"]);
    let selected = if create {
        dialog.set_file_name("database.sqlite").save_file().await
    } else {
        dialog.pick_file().await
    };
    Ok(selected.map(|f| f.path().to_string_lossy().into_owned()))
}
#[cfg(test)]
mod sqlite_tests {
    use super::*;
    #[tokio::test]
    async fn file_profile_read_edit_and_readonly_guard() {
        let path = std::env::temp_dir().join(format!("woojoo-db-{}.sqlite", uuid::Uuid::new_v4()));
        let state = State::default();
        let profile = |read_only| Profile {
            id:"test".into(), name:"Test".into(),
            engine: "sqlite".into(),
            host: "".into(),
            port: 0,
            database: path.to_string_lossy().into_owned(),
            username: "".into(),
            password: "".into(),
            tls: false,
            read_only,
            remember_password: false,
            query_timeout_seconds: None,
        };
        let id = connect(&state, profile(false)).await.unwrap();
        crate::sessions::execute(
            &state,
            &id,
            "CREATE TABLE sample(id INTEGER PRIMARY KEY,value TEXT)".into(),
        )
        .await
        .unwrap();
        crate::sessions::execute(
            &state,
            &id,
            "INSERT INTO sample VALUES(1,'original')".into(),
        )
        .await
        .unwrap();
        let table = Table {
            schema: "main".into(),
            name: "sample".into(),
        };
        let result = read(&state, id.clone(), table.clone()).await.unwrap();
        assert_eq!(result.rows[0]["id"], "1");
        assert!(result.columns[0].primary);
        apply(
            &state,
            id.clone(),
            table.clone(),
            vec![Edit {
                original: Value::Object(result.rows[0].clone()),
                changes: serde_json::json!({"value":"edited"}),
            }],
        )
        .await
        .unwrap();
        assert_eq!(
            read(&state, id.clone(), table.clone()).await.unwrap().rows[0]["value"],
            "edited"
        );
        assert_eq!(
            crate::structure::columns(&pool(&state, &id).await.unwrap(), &table)
                .await
                .unwrap()
                .len(),
            2
        );
        let ro = connect(&state, profile(true)).await.unwrap();
        assert!(ensure_writable(&state, &ro).await.is_err());
        assert!(apply(
            &state,
            ro.clone(),
            table,
            vec![Edit {
                original: serde_json::json!({"id":"1","value":"edited"}),
                changes: serde_json::json!({"value":"forbidden"})
            }]
        )
        .await
        .is_err());
        state.sessions.lock().await.clear();
        for (_, pool) in state.pools.lock().await.drain() {
            if let Pool::Sqlite(p) = pool {
                p.close().await;
            }
        }
        std::fs::remove_file(path).unwrap();
    }
}

// Native maintenance must target the authenticated connection whose policy was checked.
pub(crate) async fn validate_connection_profile(
    state: &State,
    id: &str,
    engine: &str,
    host: &str,
    port: u16,
    database: &str,
    username: &str,
    tls: bool,
) -> DbResult<()> {
    let identities = state.identities.lock().await;
    let saved = identities.get(id).ok_or("Connection is closed")?;
    if saved
        != &(
            engine.into(),
            host.into(),
            port,
            database.into(),
            username.into(),
            tls,
        )
    {
        return Err(
            "Maintenance target does not match the connected profile. Reconnect before continuing."
                .into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod rds_tls_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires an authorized RDS Profile JSON on stdin and Windows Credential Manager"]
    async fn remembered_password_survives_new_state() {
        let mut input: Value = serde_json::from_reader(std::io::stdin()).expect("Profile JSON on stdin");
        input["id"] = Value::String(format!("credential-smoke-{}", uuid::Uuid::new_v4()));
        input["rememberPassword"] = Value::Bool(true);
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) { let _ = crate::credentials::Store::default().forget(&self.0); }
        }
        let _cleanup = Cleanup(input["id"].as_str().unwrap().into());
        let first = State::default();
        let profile: Profile = serde_json::from_value(input.clone()).unwrap();
        assert!(profile.read_only && profile.tls);
        let id = connect(&first, profile).await.expect("initial authenticated connection");
        first.sessions.lock().await.clear();
        if let Pool::My(p) = pool(&first, &id).await.unwrap() { p.close().await; }
        drop(first);
        input["password"] = Value::String(String::new());
        let restarted = State::default();
        let id = connect(&restarted, serde_json::from_value(input).unwrap())
            .await.expect("reconnect without entering a password after restart");
        let result = crate::sessions::execute(&restarted, &id, "SELECT 1 AS ok".into()).await.unwrap();
        assert_eq!(result.rows[0]["ok"], "1");
        restarted.sessions.lock().await.clear();
        if let Pool::My(p) = pool(&restarted, &id).await.unwrap() { p.close().await; }
    }

    #[test]
    fn rds_bundle_is_scoped_to_tls_and_commercial_rds_hosts() {
        for host in [
            "db.example.ap-northeast-2.rds.amazonaws.com",
            "DB.EXAMPLE.US-EAST-1.RDS.AMAZONAWS.COM.",
        ] {
            assert!(rds_ca(host, true).is_some());
            assert!(rds_ca(host, false).is_none());
        }
        for host in [
            "localhost",
            "db.example.com",
            "db.rds.amazonaws.com.attacker.example",
            "notrds.amazonaws.com",
            "db.example.cn-north-1.rds.amazonaws.com.cn",
            "db.example.us-gov-west-1.rds.amazonaws.com",
            "db.example.us-gov-east-1.rds.amazonaws.com",
        ] {
            assert!(rds_ca(host, true).is_none(), "unexpected RDS trust for {host}");
        }
    }

    // Opt-in, read-only smoke test. Supply a Profile JSON on stdin so credentials
    // never appear in source, command arguments, environment dumps, or test logs.
    #[tokio::test]
    #[ignore = "requires an authorized RDS Profile JSON on stdin"]
    async fn rds_verified_tls_connection() {
        let input: Value = serde_json::from_reader(std::io::stdin()).expect("Profile JSON on stdin");
        for engine in ["mysql", "mariadb"] {
            let mut profile: Profile = serde_json::from_value(input.clone()).expect("valid Profile");
            assert!(profile.tls, "TLS verification must be enabled");
            assert!(profile.read_only, "Smoke test requires read-only mode");
            profile.engine = engine.into();
            let state = State::default();
            let id = connect(&state, profile).await.expect("verified RDS connection");
            let result = crate::sessions::execute(&state, &id, "SELECT 1 AS ok".into())
                .await.unwrap();
            assert_eq!(result.rows[0]["ok"], "1");
            if let Pool::My(p) = pool(&state, &id).await.unwrap() {
                let row = sqlx::query("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
                    .fetch_one(&p).await.unwrap();
                let cipher: String = row.try_get_unchecked(1).unwrap();
                assert!(!cipher.is_empty(), "Connection must be encrypted");
                println!("{engine}: verified TLS, SELECT 1 passed, cipher={cipher}");
                state.sessions.lock().await.clear();
                p.close().await;
            } else {
                panic!("Expected MySQL/MariaDB pool");
            }
        }
    }
}
