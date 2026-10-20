use crate::db::{DbResult, State};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions}, Row, SqlitePool};
use std::{future::Future, path::Path, time::{Duration, Instant}};
use tauri::Emitter;

pub struct Journal(pub SqlitePool);
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub profile_id: String,
    pub connection_name: String,
    pub engine: String,
    pub database: String,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub search: Option<String>,
    pub profile_id: Option<String>,
    pub status: Option<String>,
    pub since: Option<i64>,
    pub until: Option<i64>,
    pub offset: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: String, sql: String, profile_id: String, connection_name: String,
    engine: String, database: String, kind: String, status: String,
    started_at: i64, duration_ms: Option<i64>, error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    entries: Vec<Entry>, total: i64,
}
fn entry(row: sqlx::sqlite::SqliteRow) -> Entry {
    Entry {
        id:row.get("id"), sql:row.get("sql"), profile_id:row.get("profile_id"),
        connection_name:row.get("connection_name"), engine:row.get("engine"),
        database:row.get("database_name"), kind:row.get("kind"), status:row.get("status"),
        started_at:row.get("started_at"), duration_ms:row.get("duration_ms"), error:row.get("error"),
    }
}
const CONDITIONS: &str = " WHERE (?1='' OR instr(lower(sql),lower(?1))>0 OR instr(lower(coalesce(error,'')),lower(?1))>0) AND (?2='' OR profile_id=?2) AND (?3='' OR status=?3) AND (?4 IS NULL OR started_at>=?4) AND (?5 IS NULL OR started_at<?5)";
impl Journal {
    pub async fn open(path: &Path) -> DbResult<Self> {
        let pool=SqlitePoolOptions::new().max_connections(1).connect_with(
            SqliteConnectOptions::new().filename(path).create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal).busy_timeout(Duration::from_secs(5))
        ).await.map_err(|e|e.to_string())?;
        sqlx::query("CREATE TABLE IF NOT EXISTS executions(
            id TEXT PRIMARY KEY, sql TEXT NOT NULL, profile_id TEXT NOT NULL,
            connection_name TEXT NOT NULL, engine TEXT NOT NULL, database_name TEXT NOT NULL,
            kind TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL,
            duration_ms INTEGER, error TEXT)")
            .execute(&pool).await.map_err(|e|e.to_string())?;
        sqlx::query("CREATE INDEX IF NOT EXISTS executions_time ON executions(started_at DESC,id DESC)").execute(&pool).await.map_err(|e|e.to_string())?;
        sqlx::query("CREATE INDEX IF NOT EXISTS executions_profile ON executions(profile_id,started_at DESC)").execute(&pool).await.map_err(|e|e.to_string())?;
        // A previous process could not confirm completion. Never label those writes as failed.
        sqlx::query("UPDATE executions SET status='interrupted' WHERE status='running'").execute(&pool).await.map_err(|e|e.to_string())?;
        Ok(Self(pool))
    }
    async fn begin(&self, context: &Context, sql: &str, kind: &str) -> DbResult<String> {
        let id=uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO executions(id,sql,profile_id,connection_name,engine,database_name,kind,status,started_at) VALUES(?,?,?,?,?,?,?,'running',?)")
            .bind(&id).bind(sql).bind(&context.profile_id).bind(&context.connection_name)
            .bind(&context.engine).bind(&context.database).bind(kind).bind(chrono::Utc::now().timestamp_millis())
            .execute(&self.0).await.map_err(|e|format!("실행 내역을 저장하지 못해 SQL을 실행하지 않았습니다: {e}"))?;
        Ok(id)
    }
    async fn finish(&self,id:&str,status:&str,duration:i64,error:Option<&str>)->DbResult<()> {
        sqlx::query("UPDATE executions SET status=?,duration_ms=?,error=? WHERE id=?")
            .bind(status).bind(duration).bind(error).bind(id).execute(&self.0).await.map_err(|e|e.to_string())?;
        Ok(())
    }
    async fn list(&self, filter:Filter)->DbResult<Page> {
        let search=filter.search.unwrap_or_default();
        let profile=filter.profile_id.unwrap_or_default();
        let status=filter.status.unwrap_or_default();
        let count_sql=format!("SELECT count(*) FROM executions{CONDITIONS}");
        let list_sql=format!("SELECT id,substr(sql,1,500) AS sql,profile_id,connection_name,engine,database_name,kind,status,started_at,duration_ms,error FROM executions{CONDITIONS} ORDER BY started_at DESC,id DESC LIMIT 50 OFFSET ?6");
        let mut tx=self.0.begin().await.map_err(|e|e.to_string())?;
        let total:i64=sqlx::query_scalar(&count_sql).bind(&search).bind(&profile).bind(&status).bind(filter.since).bind(filter.until).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
        let entries=sqlx::query(&list_sql).bind(search).bind(profile).bind(status).bind(filter.since).bind(filter.until).bind(filter.offset.unwrap_or(0).max(0))
            .fetch_all(&mut *tx).await.map_err(|e|e.to_string())?.into_iter().map(entry).collect();
        tx.commit().await.map_err(|e|e.to_string())?;
        Ok(Page{entries,total})
    }
}

pub async fn record<T>(
    app:&tauri::AppHandle, store:&Journal, state:&State, session_id:&str,
    sql:&str, kind:&str, action:impl Future<Output=DbResult<T>>
) -> DbResult<T> {
    record_with(store,state,session_id,sql,kind,action,|event,message| {
        if let Some(message)=message {let _=app.emit(event,message);} else {let _=app.emit(event,());}
    }).await
}
async fn record_with<T>(store:&Journal,state:&State,session_id:&str,sql:&str,kind:&str,action:impl Future<Output=DbResult<T>>,notify:impl Fn(&str,Option<String>))->DbResult<T> {
    let context=state.journal_contexts.lock().await.get(session_id).cloned().unwrap_or_default();
    let session=crate::sessions::session(state,session_id).await.ok();
    let id=store.begin(&context,sql,kind).await?;
    notify("executions-changed",None);
    let started=Instant::now();
    let result=action.await;
    let cancelled=result.as_ref().err().is_some_and(|error| {
        let text=error.to_lowercase();
        session.as_ref().is_some_and(|s|s.was_cancelled()) && (text.contains("interrupt") || text.contains("cancel"))
    });
    let status=if result.is_ok() {"success"} else if cancelled {"cancelled"} else {"failed"};
    if let Err(error)=store.finish(&id,status,started.elapsed().as_millis() as i64,result.as_ref().err().map(String::as_str)).await {
        // SQL might have committed. Do not turn a successful write into a retryable SQL error.
        notify("execution-log-error",Some(format!("SQL 실행 결과의 저장을 완료하지 못했습니다: {error}")));
    }
    notify("executions-changed",None);
    result
}
#[tauri::command]
pub async fn execution_list(store:tauri::State<'_,Journal>,filter:Filter)->DbResult<Page> {store.list(filter).await}
#[tauri::command]
pub async fn execution_detail(store:tauri::State<'_,Journal>,id:String)->DbResult<Entry> {
    sqlx::query("SELECT * FROM executions WHERE id=?").bind(id).fetch_one(&store.0).await.map(entry).map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn execution_connections(store:tauri::State<'_,Journal>)->DbResult<Vec<Context>> {
    let rows=sqlx::query("SELECT profile_id,connection_name,engine,database_name FROM executions e WHERE rowid=(SELECT rowid FROM executions x WHERE x.profile_id=e.profile_id ORDER BY started_at DESC,rowid DESC LIMIT 1) ORDER BY connection_name").fetch_all(&store.0).await.map_err(|e|e.to_string())?;
    Ok(rows.into_iter().map(|r|Context{profile_id:r.get(0),connection_name:r.get(1),engine:r.get(2),database:r.get(3)}).collect())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn logs_actual_sql_and_failures_and_blocks_execution_if_storage_fails() {
        let path=std::env::temp_dir().join(format!("woojoo-journal-{}.sqlite",uuid::Uuid::new_v4()));
        let store=Journal::open(&path).await.unwrap();
        let state=State::default();
        let target=SqlitePool::connect("sqlite::memory:").await.unwrap();
        let sql=format!("SELECT '{}'", "한글".repeat(400));
        let value=record_with(&store,&state,"local",&sql,"sql",async {
            sqlx::query_scalar::<_,String>(&sql).fetch_one(&target).await.map_err(|e|e.to_string())
        },|_,_|{}).await.unwrap();
        assert_eq!(value,"한글".repeat(400));
        assert!(record_with(&store,&state,"local","SELECT missing","sql",async {
            sqlx::query("SELECT missing").execute(&target).await.map_err(|e|e.to_string())
        },|_,_|{}).await.is_err());
        let failures=store.list(Filter{status:Some("failed".into()),..Default::default()}).await.unwrap();
        assert_eq!(failures.total,1);
        assert!(failures.entries[0].error.as_ref().unwrap().contains("missing"));
        let full:String=sqlx::query_scalar("SELECT sql FROM executions WHERE status='success'").fetch_one(&store.0).await.unwrap();
        assert_eq!(full,sql);
        store.0.close().await;
        let executed=std::sync::atomic::AtomicBool::new(false);
        let result=record_with(&store,&state,"local","SELECT 1","sql",async{
            executed.store(true,std::sync::atomic::Ordering::SeqCst);Ok(())
        },|_,_|{}).await;
        assert!(result.is_err());
        assert!(!executed.load(std::sync::atomic::Ordering::SeqCst));
        target.close().await;
        std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    async fn durable_unbounded_filtering_and_interrupted_recovery() {
        let path=std::env::temp_dir().join(format!("woojoo-journal-{}.sqlite",uuid::Uuid::new_v4()));
        let store=Journal::open(&path).await.unwrap();
        let context=Context{profile_id:"profile".into(),connection_name:"Local".into(),engine:"sqlite".into(),database:"test".into()};
        for i in 0..205 {
            let id=store.begin(&context,&format!("SELECT {i}"),"sql").await.unwrap();
            store.finish(&id,"success",3,None).await.unwrap();
        }
        let failed=store.begin(&context,"SELECT '100%_한국어'","sql").await.unwrap();
        store.finish(&failed,"failed",4,Some("syntax error")).await.unwrap();
        store.begin(&context,"SELECT unfinished","sql").await.unwrap();
        assert_eq!(store.list(Filter::default()).await.unwrap().total,207);
        assert_eq!(store.list(Filter{offset:Some(200),..Default::default()}).await.unwrap().entries.len(),7);
        assert_eq!(store.list(Filter{search:Some("%_한국어".into()),..Default::default()}).await.unwrap().total,1);
        assert_eq!(store.list(Filter{profile_id:Some("other".into()),..Default::default()}).await.unwrap().total,0);
        store.0.close().await;
        let reopened=Journal::open(&path).await.unwrap();
        let page=reopened.list(Filter{status:Some("interrupted".into()),..Default::default()}).await.unwrap();
        assert_eq!(page.entries.len(),1);
        assert_eq!(page.entries[0].sql,"SELECT unfinished");
        assert_eq!(reopened.list(Filter{until:Some(1),..Default::default()}).await.unwrap().total,0);
        reopened.0.close().await;
        std::fs::remove_file(path).unwrap();
    }
}
