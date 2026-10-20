use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::path::{Path, PathBuf};
use tauri::Manager;

const SCHEMA: &[&str] = &[
    r#"CREATE TABLE "user" (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )"#,
    r#"CREATE TABLE board (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE RESTRICT
    )"#,
    "CREATE INDEX board_user_id_idx ON board(user_id)",
];

async fn prepare(directory: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(directory).map_err(|e|e.to_string())?;
    let destination=directory.join("local.sqlite3");
    if destination.exists() { return Ok(destination); }
    // Publish only a complete database, and never replace an existing database.
    let staging=directory.join(format!(".local-{}.sqlite3",uuid::Uuid::new_v4()));
    let result=async {
        let pool=SqlitePoolOptions::new().max_connections(1).connect_with(
            SqliteConnectOptions::new().filename(&staging).create_if_missing(true)
                .journal_mode(SqliteJournalMode::Delete).foreign_keys(true)
        ).await.map_err(|e|e.to_string())?;
        let initialized=async {
            let mut tx=pool.begin().await.map_err(|e|e.to_string())?;
            for sql in SCHEMA { sqlx::query(sql).execute(&mut *tx).await.map_err(|e|e.to_string())?; }
            tx.commit().await.map_err(|e|e.to_string())
        }.await;
        pool.close().await;
        initialized?;
        match std::fs::hard_link(&staging,&destination) {
            Ok(())=>Ok(destination.clone()),
            Err(error) if error.kind()==std::io::ErrorKind::AlreadyExists=>Ok(destination.clone()),
            Err(error)=>Err(error.to_string()),
        }
    }.await;
    let _=std::fs::remove_file(&staging);
    result
}

#[tauri::command]
pub async fn create_local_database(app: tauri::AppHandle) -> Result<String,String> {
    let directory=app.path().app_data_dir().map_err(|e|e.to_string())?.join("databases");
    prepare(&directory).await.map(|path|path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    #[tokio::test]
    async fn creates_only_two_tables_with_one_to_many_relation_and_preserves_existing_data() {
        let directory=std::env::temp_dir().join(format!("woojoo-local-{}",uuid::Uuid::new_v4()));
        let path=prepare(&directory).await.unwrap();
        let pool=SqlitePoolOptions::new().max_connections(1).connect_with(
            SqliteConnectOptions::new().filename(&path).foreign_keys(true)
        ).await.unwrap();
        let tables:Vec<String>=sqlx::query_scalar("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").fetch_all(&pool).await.unwrap();
        assert_eq!(tables,vec!["board","user"]);
        let foreign_key=sqlx::query("PRAGMA foreign_key_list('board')").fetch_one(&pool).await.unwrap();
        assert_eq!(foreign_key.get::<String,_>("table"),"user");
        assert_eq!(foreign_key.get::<String,_>("from"),"user_id");
        assert_eq!(foreign_key.get::<String,_>("to"),"id");
        sqlx::query("INSERT INTO \"user\"(id,name) VALUES(1,'Writer')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO board(user_id,title) VALUES(1,'First'),(1,'Second')").execute(&pool).await.unwrap();
        assert!(sqlx::query("INSERT INTO board(user_id,title) VALUES(99,'Invalid')").execute(&pool).await.is_err());
        assert!(sqlx::query("DELETE FROM \"user\" WHERE id=1").execute(&pool).await.is_err());
        assert_eq!(prepare(&directory).await.unwrap(),path);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM board").fetch_one(&pool).await.unwrap(),2);
        pool.close().await;
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
