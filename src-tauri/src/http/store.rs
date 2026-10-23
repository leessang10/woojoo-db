//! Local storage for saved requests. Request and environment bodies are JSON
//! documents owned by the UI; the database only orders and groups them.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{path::Path, time::Duration};

pub struct Store(pub SqlitePool);
type StoreResult<T> = Result<T, String>;
/// History keeps the newest entries only; older ones are trimmed on insert.
const HISTORY_LIMIT: i64 = 500;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub sort: i64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRequest {
    pub id: String,
    pub collection_id: Option<String>,
    pub name: String,
    pub sort: i64,
    pub spec: Value,
    #[serde(default)]
    pub updated_at: i64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub id: String,
    pub name: String,
    pub sort: i64,
    pub variables: Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    collections: Vec<Collection>,
    requests: Vec<SavedRequest>,
    environments: Vec<Environment>,
    active_environment: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    id: String,
    request_id: Option<String>,
    name: String,
    method: String,
    url: String,
    status: Option<i64>,
    duration_ms: i64,
    size: i64,
    error: Option<String>,
    sent_at: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDetail {
    #[serde(flatten)]
    entry: HistoryEntry,
    request: Value,
    response: Option<Value>,
}
/// What `client` records after each send.
pub struct Sent<'a> {
    pub request_id: Option<&'a str>,
    pub name: &'a str,
    pub method: &'a str,
    pub url: &'a str,
    pub status: Option<u16>,
    pub duration_ms: i64,
    pub size: i64,
    pub error: Option<&'a str>,
    pub request: &'a Value,
    pub response: Option<&'a Value>,
}

fn history_entry(row: &sqlx::sqlite::SqliteRow) -> HistoryEntry {
    HistoryEntry {
        id: row.get("id"), request_id: row.get("request_id"), name: row.get("name"),
        method: row.get("method"), url: row.get("url"), status: row.get("status"),
        duration_ms: row.get("duration_ms"), size: row.get("size"), error: row.get("error"),
        sent_at: row.get("sent_at"),
    }
}
fn json(text: String) -> Value { serde_json::from_str(&text).unwrap_or(Value::Null) }
fn now() -> i64 { chrono::Utc::now().timestamp_millis() }
fn err(error: sqlx::Error) -> String { error.to_string() }

impl Store {
    pub async fn open(path: &Path) -> StoreResult<Self> {
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(
            SqliteConnectOptions::new().filename(path).create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal).foreign_keys(true).busy_timeout(Duration::from_secs(5))
        ).await.map_err(err)?;
        for sql in [
            "CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0)",
            "CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
                name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, spec TEXT NOT NULL, updated_at INTEGER NOT NULL)",
            "CREATE INDEX IF NOT EXISTS requests_collection ON requests(collection_id, sort)",
            "CREATE TABLE IF NOT EXISTS environments(id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, variables TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY, request_id TEXT, name TEXT NOT NULL, method TEXT NOT NULL, url TEXT NOT NULL,
                status INTEGER, duration_ms INTEGER NOT NULL, size INTEGER NOT NULL, error TEXT, sent_at INTEGER NOT NULL,
                request TEXT NOT NULL, response TEXT)",
            "CREATE INDEX IF NOT EXISTS history_time ON history(sent_at DESC)",
        ] {
            sqlx::query(sql).execute(&pool).await.map_err(err)?;
        }
        Ok(Self(pool))
    }

    pub async fn workspace(&self) -> StoreResult<Workspace> {
        let collections = sqlx::query("SELECT id,name,sort FROM collections ORDER BY sort,name").fetch_all(&self.0).await.map_err(err)?
            .iter().map(|row| Collection { id: row.get("id"), name: row.get("name"), sort: row.get("sort") }).collect();
        let requests = sqlx::query("SELECT id,collection_id,name,sort,spec,updated_at FROM requests ORDER BY sort,name").fetch_all(&self.0).await.map_err(err)?
            .into_iter().map(|row| SavedRequest {
                id: row.get("id"), collection_id: row.get("collection_id"), name: row.get("name"),
                sort: row.get("sort"), spec: json(row.get("spec")), updated_at: row.get("updated_at"),
            }).collect();
        let environments = sqlx::query("SELECT id,name,sort,variables FROM environments ORDER BY sort,name").fetch_all(&self.0).await.map_err(err)?
            .into_iter().map(|row| Environment { id: row.get("id"), name: row.get("name"), sort: row.get("sort"), variables: json(row.get("variables")) }).collect();
        let active_environment = sqlx::query_scalar("SELECT value FROM meta WHERE key='active_environment'").fetch_optional(&self.0).await.map_err(err)?;
        Ok(Workspace { collections, requests, environments, active_environment })
    }
    pub async fn save_collection(&self, item: &Collection) -> StoreResult<()> {
        sqlx::query("INSERT INTO collections(id,name,sort) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort=excluded.sort")
            .bind(&item.id).bind(item.name.trim()).bind(item.sort).execute(&self.0).await.map_err(err)?;
        Ok(())
    }
    pub async fn save_request(&self, item: &SavedRequest) -> StoreResult<i64> {
        let updated = now();
        sqlx::query("INSERT INTO requests(id,collection_id,name,sort,spec,updated_at) VALUES(?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET collection_id=excluded.collection_id, name=excluded.name, sort=excluded.sort, spec=excluded.spec, updated_at=excluded.updated_at")
            .bind(&item.id).bind(&item.collection_id).bind(item.name.trim()).bind(item.sort).bind(item.spec.to_string()).bind(updated)
            .execute(&self.0).await.map_err(err)?;
        Ok(updated)
    }
    pub async fn save_environment(&self, item: &Environment) -> StoreResult<()> {
        sqlx::query("INSERT INTO environments(id,name,sort,variables) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort=excluded.sort, variables=excluded.variables")
            .bind(&item.id).bind(item.name.trim()).bind(item.sort).bind(item.variables.to_string()).execute(&self.0).await.map_err(err)?;
        Ok(())
    }
    pub async fn delete(&self, table: Table, id: &str) -> StoreResult<()> {
        let sql = match table {
            Table::Collection => "DELETE FROM collections WHERE id=?",
            Table::Request => "DELETE FROM requests WHERE id=?",
            Table::Environment => "DELETE FROM environments WHERE id=?",
        };
        sqlx::query(sql).bind(id).execute(&self.0).await.map_err(err)?;
        Ok(())
    }
    pub async fn set_active_environment(&self, id: Option<&str>) -> StoreResult<()> {
        match id {
            Some(id) => sqlx::query("INSERT INTO meta(key,value) VALUES('active_environment',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(id).execute(&self.0).await,
            None => sqlx::query("DELETE FROM meta WHERE key='active_environment'").execute(&self.0).await,
        }.map_err(err)?;
        Ok(())
    }

    pub async fn record(&self, sent: Sent<'_>) -> StoreResult<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let mut tx = self.0.begin().await.map_err(err)?;
        sqlx::query("INSERT INTO history(id,request_id,name,method,url,status,duration_ms,size,error,sent_at,request,response) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(&id).bind(sent.request_id).bind(sent.name).bind(sent.method).bind(sent.url).bind(sent.status.map(i64::from))
            .bind(sent.duration_ms).bind(sent.size).bind(sent.error).bind(now()).bind(sent.request.to_string()).bind(sent.response.map(Value::to_string))
            .execute(&mut *tx).await.map_err(err)?;
        sqlx::query("DELETE FROM history WHERE id IN (SELECT id FROM history ORDER BY sent_at DESC LIMIT -1 OFFSET ?)")
            .bind(HISTORY_LIMIT).execute(&mut *tx).await.map_err(err)?;
        tx.commit().await.map_err(err)?;
        Ok(id)
    }
    pub async fn history(&self, search: &str, offset: i64) -> StoreResult<Vec<HistoryEntry>> {
        Ok(sqlx::query("SELECT id,request_id,name,method,url,status,duration_ms,size,error,sent_at FROM history
            WHERE ?1='' OR instr(lower(url),lower(?1))>0 OR instr(lower(name),lower(?1))>0 ORDER BY sent_at DESC LIMIT 100 OFFSET ?2")
            .bind(search).bind(offset.max(0)).fetch_all(&self.0).await.map_err(err)?.iter().map(history_entry).collect())
    }
    pub async fn history_detail(&self, id: &str) -> StoreResult<Option<HistoryDetail>> {
        let row = sqlx::query("SELECT * FROM history WHERE id=?").bind(id).fetch_optional(&self.0).await.map_err(err)?;
        Ok(row.map(|row| HistoryDetail {
            entry: history_entry(&row),
            request: json(row.get("request")),
            response: row.get::<Option<String>, _>("response").map(json),
        }))
    }
    pub async fn clear_history(&self) -> StoreResult<()> {
        sqlx::query("DELETE FROM history").execute(&self.0).await.map_err(err)?;
        Ok(())
    }
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum Table { Collection, Request, Environment }

#[tauri::command]
pub async fn http_workspace(store: tauri::State<'_, Store>) -> StoreResult<Workspace> { store.workspace().await }
#[tauri::command]
pub async fn http_save_collection(store: tauri::State<'_, Store>, collection: Collection) -> StoreResult<()> { store.save_collection(&collection).await }
#[tauri::command]
pub async fn http_save_request(store: tauri::State<'_, Store>, request: SavedRequest) -> StoreResult<i64> { store.save_request(&request).await }
#[tauri::command]
pub async fn http_save_environment(store: tauri::State<'_, Store>, environment: Environment) -> StoreResult<()> { store.save_environment(&environment).await }
#[tauri::command]
pub async fn http_delete(store: tauri::State<'_, Store>, table: Table, id: String) -> StoreResult<()> { store.delete(table, &id).await }
#[tauri::command]
pub async fn http_set_active_environment(store: tauri::State<'_, Store>, id: Option<String>) -> StoreResult<()> { store.set_active_environment(id.as_deref()).await }
#[tauri::command]
pub async fn http_history(store: tauri::State<'_, Store>, search: String, offset: i64) -> StoreResult<Vec<HistoryEntry>> { store.history(&search, offset).await }
#[tauri::command]
pub async fn http_history_detail(store: tauri::State<'_, Store>, id: String) -> StoreResult<Option<HistoryDetail>> { store.history_detail(&id).await }
#[tauri::command]
pub async fn http_clear_history(store: tauri::State<'_, Store>) -> StoreResult<()> { store.clear_history().await }

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn saves_requests_in_collections_and_trims_history() {
        let directory = std::env::temp_dir().join(format!("woojoo-http-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let store = Store::open(&directory.join("api.sqlite3")).await.unwrap();
        store.save_collection(&Collection { id: "c".into(), name: " Users ".into(), sort: 0 }).await.unwrap();
        let request = |id: &str| SavedRequest { id: id.into(), collection_id: Some("c".into()), name: id.into(), sort: 0, spec: json!({"method":"GET","url":"https://example.com"}), updated_at: 0 };
        store.save_request(&request("a")).await.unwrap();
        store.save_request(&request("b")).await.unwrap();
        store.save_request(&SavedRequest { name: "renamed".into(), ..request("a") }).await.unwrap();
        store.set_active_environment(Some("dev")).await.unwrap();
        let workspace = store.workspace().await.unwrap();
        assert_eq!(workspace.collections[0].name, "Users");
        assert_eq!(workspace.requests.len(), 2);
        assert!(workspace.requests.iter().any(|r| r.name == "renamed" && r.spec["method"] == "GET"));
        assert_eq!(workspace.active_environment.as_deref(), Some("dev"));
        // Deleting a collection deletes its requests.
        store.delete(Table::Collection, "c").await.unwrap();
        assert!(store.workspace().await.unwrap().requests.is_empty());

        let sent = json!({"method":"GET"});
        for index in 0..HISTORY_LIMIT + 3 {
            store.record(Sent { request_id: None, name: "", method: "GET", url: &format!("https://example.com/{index}"), status: Some(200),
                duration_ms: 1, size: 0, error: None, request: &sent, response: None }).await.unwrap();
        }
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM history").fetch_one(&store.0).await.unwrap();
        assert_eq!(count, HISTORY_LIMIT);
        let found = store.history("example.com/7", 0).await.unwrap();
        assert!(!found.is_empty());
        let detail = store.history_detail(&found[0].id).await.unwrap().unwrap();
        assert_eq!(detail.request["method"], "GET");
        store.0.close().await;
        let _ = std::fs::remove_dir_all(directory);
    }
}
