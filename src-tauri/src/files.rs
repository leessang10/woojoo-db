use serde::Serialize;
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

static OPEN_FILES: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlFile {
    path: String,
    name: String,
    sql: String,
}
fn remember(path: PathBuf, sql: String) -> Result<SqlFile, String> {
    OPEN_FILES
        .get_or_init(Default::default)
        .lock()
        .map_err(|e| e.to_string())?
        .insert(path.clone());
    Ok(SqlFile {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        path: path.to_string_lossy().into(),
        sql,
    })
}
#[tauri::command]
pub async fn sql_open_file() -> Result<Option<SqlFile>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("SQL", &["sql"])
            .pick_file()
        else {
            return Ok(None);
        };
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 10_000_000 {
            return Err("SQL file exceeds 10 MB".into());
        }
        let sql = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        remember(path, sql.trim_start_matches('\u{feff}').to_string()).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn sql_save_file(path: Option<String>, sql: String) -> Result<Option<SqlFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = if let Some(path) = path {
            let requested = PathBuf::from(path);
            let canonical = requested.canonicalize().ok();
            let authorized = canonical.as_ref().is_some_and(|path| {
                OPEN_FILES
                    .get_or_init(Default::default)
                    .lock()
                    .map(|files| files.contains(path))
                    .unwrap_or(false)
            });
            if authorized {
                canonical.unwrap()
            } else {
                // A restored workspace has a path but no native file grant.
                // Reconfirm the destination without replacing the editor text.
                let mut dialog = rfd::FileDialog::new().add_filter("SQL", &["sql"]);
                if let Some(parent) = requested.parent() {
                    dialog = dialog.set_directory(parent);
                }
                if let Some(name) = requested.file_name() {
                    dialog = dialog.set_file_name(name.to_string_lossy());
                }
                let Some(path) = dialog.save_file() else {
                    return Ok(None);
                };
                path
            }
        } else {
            let Some(path) = rfd::FileDialog::new()
                .add_filter("SQL", &["sql"])
                .set_file_name("query.sql")
                .save_file()
            else {
                return Ok(None);
            };
            path
        };
        std::fs::write(&target, &sql).map_err(|e| e.to_string())?;
        remember(target.canonicalize().map_err(|e| e.to_string())?, sql).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
