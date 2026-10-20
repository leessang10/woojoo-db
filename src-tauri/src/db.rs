use crate::plan::{quote_ident, validate_edit};
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{
    mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow, MySqlSslMode},
    postgres::{PgConnectOptions, PgPoolOptions, PgRow, PgSslMode},
    Column as _, Either, Executor, MySqlPool, PgPool, Row as _, TypeInfo, ValueRef,
};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

type Row = Map<String, Value>;
type DbResult<T> = Result<T, String>;
#[derive(Clone)]
pub(crate) enum Pool {
    Pg(PgPool),
    My(MySqlPool),
}
#[derive(Default)]
pub struct State {
    pools: Mutex<HashMap<String, Pool>>,
}
#[derive(Deserialize)]
pub struct Profile {
    engine: String,
    host: String,
    port: u16,
    database: String,
    username: String,
    password: String,
    tls: bool,
}
#[derive(Deserialize, Serialize, Clone)]
pub struct Table {
    pub(crate) schema: String,
    pub(crate) name: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    name: String,
    data_type: String,
    primary: bool,
    editable: bool,
}
#[derive(Serialize)]
pub struct ErdTable {
    table: Table,
    columns: Vec<Column>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKey {
    id: String,
    name: String,
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
    columns: Vec<Column>,
    rows: Vec<Row>,
    elapsed_ms: u128,
    affected: u64,
    truncated: bool,
}
#[derive(Deserialize)]
pub struct Edit {
    original: Value,
    changes: Value,
}

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
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
fn qualified(table: &Table, pg: bool) -> String {
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
async fn connect(state: &State, profile: Profile) -> DbResult<String> {
    if profile.host.trim().is_empty()
        || profile.database.trim().is_empty()
        || profile.username.trim().is_empty()
        || profile.port == 0
    {
        return Err("호스트, 데이터베이스, 사용자 및 포트를 확인하세요.".into());
    }
    let result = tokio::time::timeout(Duration::from_secs(12), async {
        match profile.engine.as_str() {
            "postgres" => {
                let options = PgConnectOptions::new()
                    .host(&profile.host)
                    .port(profile.port)
                    .database(&profile.database)
                    .username(&profile.username)
                    .password(&profile.password)
                    .ssl_mode(if profile.tls {
                        PgSslMode::VerifyFull
                    } else {
                        PgSslMode::Disable
                    })
                    .options([("statement_timeout", "30000")]);
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
                    .database(&profile.database)
                    .username(&profile.username)
                    .password(&profile.password)
                    .ssl_mode(if profile.tls {
                        MySqlSslMode::VerifyIdentity
                    } else {
                        MySqlSslMode::Disabled
                    });
                MySqlPoolOptions::new()
                    .max_connections(3)
                    .acquire_timeout(Duration::from_secs(10))
                    .connect_with(options)
                    .await
                    .map(Pool::My)
                    .map_err(error)
            }
            _ => Err("지원하지 않는 데이터베이스입니다.".into()),
        }
    })
    .await
    .map_err(|_| "연결 제한 시간(12초)을 초과했습니다.".to_string())??;
    let id = uuid::Uuid::new_v4().to_string();
    state.pools.lock().await.insert(id.clone(), result);
    Ok(id)
}
#[tauri::command]
pub async fn disconnect_db(state: tauri::State<'_, State>, id: String) -> DbResult<()> {
    let connection = state.pools.lock().await.remove(&id);
    match connection {
        Some(Pool::Pg(p)) => p.close().await,
        Some(Pool::My(p)) => p.close().await,
        None => (),
    };
    Ok(())
}
#[tauri::command]
pub async fn list_tables(state: tauri::State<'_, State>, id: String) -> DbResult<Vec<Table>> {
    tables(&state, id).await
}
async fn tables(state: &State, id: String) -> DbResult<Vec<Table>> {
    match pool(&state, &id).await? {
        Pool::Pg(p) => sqlx::query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema,table_name")
            .fetch_all(&p).await.map_err(error)?.into_iter().map(|r| Ok(Table {schema:r.try_get(0).map_err(error)?,name:r.try_get(1).map_err(error)?})).collect(),
        Pool::My(p) => sqlx::query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema=DATABASE() ORDER BY table_name")
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
async fn metadata(pool: &Pool, table: &Table) -> DbResult<Vec<Column>> {
    let columns = match pool {
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
fn pg_value(r: &PgRow, i: usize) -> DbResult<Value> {
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
fn my_value(r: &MySqlRow, i: usize) -> DbResult<Value> {
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
fn unique_columns(columns: &[Column]) -> DbResult<()> {
    let mut names = std::collections::HashSet::new();
    if columns.iter().any(|c| !names.insert(&c.name)) {
        return Err("중복된 결과 열 이름이 있습니다. SQL의 AS 별칭으로 구분하세요.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn run_query(
    state: tauri::State<'_, State>,
    id: String,
    sql: String,
) -> DbResult<QueryResult> {
    if sql.trim().is_empty() {
        return Err("SQL을 입력하세요.".into());
    }
    let p = pool(&state, &id).await?;
    tokio::time::timeout(Duration::from_secs(35), execute_query(p, sql))
        .await
        .map_err(|_| {
            "35초 응답 제한을 초과해 연결을 닫았습니다. 쓰기 쿼리는 DB에서 반영되었는지 확인하세요."
                .to_string()
        })?
}
#[allow(deprecated)]
async fn execute_query(pool: Pool, sql: String) -> DbResult<QueryResult> {
    let now = Instant::now();
    let mut output = QueryResult {
        columns: vec![],
        rows: vec![],
        elapsed_ms: 0,
        affected: 0,
        truncated: false,
    };
    match pool {
        Pool::Pg(p) => {
            let mut conn = p.acquire().await.map_err(error)?;
            conn.close_on_drop();
            let desc = (&mut *conn).describe(&sql).await.map_err(error)?;
            output.columns = desc
                .columns()
                .iter()
                .map(|c| Column {
                    name: c.name().into(),
                    data_type: c.type_info().name().into(),
                    primary: false,
                    editable: false,
                })
                .collect();
            unique_columns(&output.columns)?;
            let mut stream = sqlx::query(&sql).fetch_many(&mut *conn);
            while let Some(item) = stream.try_next().await.map_err(error)? {
                match item {
                    Either::Left(r) => output.affected += r.rows_affected(),
                    Either::Right(r) => {
                        if output.rows.len() == 500 {
                            output.truncated = true;
                            break;
                        }
                        output.rows.push(
                            output
                                .columns
                                .iter()
                                .enumerate()
                                .map(|(i, c)| Ok((c.name.clone(), pg_value(&r, i)?)))
                                .collect::<DbResult<Row>>()?,
                        );
                    }
                }
            }
        }
        Pool::My(p) => {
            let mut conn = p.acquire().await.map_err(error)?;
            conn.close_on_drop();
            let desc = (&mut *conn).describe(&sql).await.map_err(error)?;
            output.columns = desc
                .columns()
                .iter()
                .map(|c| Column {
                    name: c.name().into(),
                    data_type: c.type_info().name().into(),
                    primary: false,
                    editable: false,
                })
                .collect();
            unique_columns(&output.columns)?;
            let mut stream = sqlx::query(&sql).fetch_many(&mut *conn);
            while let Some(item) = stream.try_next().await.map_err(error)? {
                match item {
                    Either::Left(r) => output.affected += r.rows_affected(),
                    Either::Right(r) => {
                        if output.rows.len() == 500 {
                            output.truncated = true;
                            break;
                        }
                        output.rows.push(
                            output
                                .columns
                                .iter()
                                .enumerate()
                                .map(|(i, c)| Ok((c.name.clone(), my_value(&r, i)?)))
                                .collect::<DbResult<Row>>()?,
                        );
                    }
                }
            }
        }
    }
    output.elapsed_ms = now.elapsed().as_millis();
    Ok(output)
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
            };
        }
    }
}
