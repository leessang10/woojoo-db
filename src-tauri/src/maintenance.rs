use crate::{
    db::{self, State},
    sessions,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Mutex, OnceLock},
};

static RESTORE_FILES: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceProfile {
    engine: String,
    host: String,
    port: u16,
    database: String,
    username: String,
    password: String,
    tls: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTools {
    backup: Option<String>,
    restore: Option<String>,
}

fn tool(names: &[&str]) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    for name in names {
        for directory in std::env::split_paths(&paths) {
            let candidate = directory.join(if cfg!(windows) {
                format!("{name}.exe")
            } else {
                name.to_string()
            });
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}
fn tools(engine: &str) -> Result<(Option<PathBuf>, Option<PathBuf>), String> {
    Ok(match engine {
        "postgres" => (tool(&["pg_dump"]), tool(&["psql"])),
        "mysql" => (tool(&["mysqldump"]), tool(&["mysql"])),
        "mariadb" => (
            tool(&["mariadb-dump", "mysqldump"]),
            tool(&["mariadb", "mysql"]),
        ),
        "sqlite" => {
            let path = tool(&["sqlite3"]);
            (path.clone(), path)
        }
        _ => return Err("Unsupported database engine".into()),
    })
}
#[tauri::command]
pub fn maintenance_tools(engine: String) -> Result<NativeTools, String> {
    let (backup, restore) = tools(&engine)?;
    Ok(NativeTools {
        backup: if engine == "sqlite" {
            Some("SQLite VACUUM INTO (built-in)".into())
        } else {
            backup.map(|p| p.to_string_lossy().into())
        },
        restore: restore.map(|p| p.to_string_lossy().into()),
    })
}
#[tauri::command]
pub async fn maintenance_pick_restore(engine: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let extensions = if engine == "sqlite" {
            vec!["db", "sqlite", "sqlite3"]
        } else {
            vec!["sql"]
        };
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Database backup", &extensions)
            .pick_file()
        else {
            return Ok(None);
        };
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        RESTORE_FILES
            .get_or_init(Default::default)
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path.clone());
        Ok(Some(path.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn sqlite_argument(path: &Path) -> Result<String, String> {
    let text = path.to_string_lossy();
    if text.contains(['\n', '\r', '\0']) {
        return Err("Invalid database path".into());
    }
    Ok(format!(
        "\"{}\"",
        text.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}
fn connection_command(
    executable: &Path,
    profile: &MaintenanceProfile,
) -> Result<tokio::process::Command, String> {
    if profile.database.is_empty() || profile.database.contains('\0') {
        return Err("Database is required".into());
    }
    let mut command = tokio::process::Command::new(executable);
    command
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    match profile.engine.as_str() {
        "postgres" => {
            command
                .env("PGHOST", &profile.host)
                .env("PGPORT", profile.port.to_string())
                .env("PGDATABASE", &profile.database)
                .env("PGUSER", &profile.username)
                .env("PGPASSWORD", &profile.password)
                .env("PGCONNECT_TIMEOUT", "15")
                .env(
                    "PGSSLMODE",
                    if profile.tls {
                        "verify-full"
                    } else {
                        "disable"
                    },
                );
        }
        "mysql" | "mariadb" => {
            command
                .arg("--no-defaults")
                .arg("--protocol=TCP")
                .arg(format!("--host={}", profile.host))
                .arg(format!("--port={}", profile.port))
                .arg(format!("--user={}", profile.username))
                .arg("--connect-timeout=15")
                .env("MYSQL_PWD", &profile.password);
            let maria = executable
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .starts_with("mariadb");
            if maria {
                command.arg(if profile.tls {
                    "--ssl-verify-server-cert"
                } else {
                    "--skip-ssl"
                });
            } else {
                command.arg(if profile.tls {
                    "--ssl-mode=VERIFY_IDENTITY"
                } else {
                    "--ssl-mode=DISABLED"
                });
            }
        }
        "sqlite" => {
            if !Path::new(&profile.database).is_absolute() {
                return Err("SQLite native restore requires an absolute database path".into());
            }
            command
                .arg("-batch")
                .arg("-bail")
                .arg("-cmd")
                .arg(".timeout 15000")
                .arg(&profile.database);
        }
        _ => return Err("Unsupported database engine".into()),
    }
    Ok(command)
}
async fn run(mut command: tokio::process::Command, password: &str) -> Result<(), String> {
    let output = tokio::time::timeout(std::time::Duration::from_secs(600), command.output())
        .await
        .map_err(|_| "Native tool timed out after 10 minutes".to_string())?
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let mut detail = String::from_utf8_lossy(&output.stderr).to_string();
    if !password.is_empty() {
        detail = detail.replace(password, "[redacted]");
    }
    Err(format!(
        "Native database tool failed: {}",
        detail.chars().take(4000).collect::<String>()
    ))
}
#[tauri::command]
pub async fn maintenance_backup(
    state: tauri::State<'_, State>,
    id: String,
    profile: MaintenanceProfile,
) -> Result<Option<String>, String> {
    db::validate_connection_profile(
        &state,
        &id,
        &profile.engine,
        &profile.host,
        profile.port,
        &profile.database,
        &profile.username,
        profile.tls,
    )
    .await?;
    sessions::session(&state, &id).await?;
    let executable = tools(&profile.engine)?.0;
    let sqlite = profile.engine == "sqlite";
    if !sqlite && executable.is_none() {
        return Err("Backup tool was not found on PATH".into());
    }
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .add_filter("Database backup", &[if sqlite { "db" } else { "sql" }])
            .set_file_name(if sqlite { "backup.db" } else { "backup.sql" })
            .save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(target) = chosen else {
        return Ok(None);
    };
    if target.exists() {
        return Err("Choose a new backup filename; existing files are not overwritten".into());
    }
    let temporary =
        target.with_file_name(format!(".woojoo-backup-{}.partial", uuid::Uuid::new_v4()));
    let result = if sqlite {
        match db::pool(&state, &id).await? {
            db::Pool::Sqlite(pool) => sqlx::query("VACUUM INTO ?")
                .bind(temporary.to_string_lossy().as_ref())
                .execute(&pool)
                .await
                .map(|_| ())
                .map_err(|e| e.to_string()),
            _ => Err("Connected database engine does not match SQLite".into()),
        }
    } else {
        let mut command = connection_command(
            executable
                .as_ref()
                .ok_or("Backup tool was not found on PATH")?,
            &profile,
        )?;
        match profile.engine.as_str() {
            "postgres" => {
                command.args([
                    "--no-password",
                    "--format=plain",
                    "--no-owner",
                    "--no-privileges",
                ]);
                command.stdout(
                    std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&temporary)
                        .map_err(|e| e.to_string())?,
                );
            }
            "mysql" | "mariadb" => {
                command
                    .args([
                        "--single-transaction",
                        "--routines",
                        "--events",
                        "--triggers",
                        "--hex-blob",
                        "--",
                    ])
                    .arg(&profile.database);
                command.stdout(
                    std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&temporary)
                        .map_err(|e| e.to_string())?,
                );
            }
            "sqlite" => {
                command.arg(format!(".backup {}", sqlite_argument(&temporary)?));
            }
            _ => return Err("Unsupported database engine".into()),
        }
        run(command, &profile.password).await
    };
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    // Hard-link creation is atomic and refuses to overwrite a file created while the dump ran.
    if let Err(error) = std::fs::hard_link(&temporary, &target) {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!("Could not publish backup: {error}"));
    }
    std::fs::remove_file(&temporary).map_err(|e| e.to_string())?;
    Ok(Some(target.to_string_lossy().into()))
}
#[tauri::command]
pub async fn maintenance_restore(
    state: tauri::State<'_, State>,
    id: String,
    profile: MaintenanceProfile,
    path: String,
    confirmation: String,
) -> Result<(), String> {
    db::validate_connection_profile(
        &state,
        &id,
        &profile.engine,
        &profile.host,
        profile.port,
        &profile.database,
        &profile.username,
        profile.tls,
    )
    .await?;
    let session = sessions::session(&state, &id).await?;
    if session.read_only {
        return Err("Restore is disabled for read-only connections".into());
    }
    let execution = serde_json::to_value(sessions::execution_state(state, id).await?)
        .map_err(|e| e.to_string())?;
    if execution["running"] == true || execution["inTransaction"] == true {
        return Err(
            "Finish running queries and commit or roll back the transaction before restoring"
                .into(),
        );
    }
    if confirmation != profile.database {
        return Err("Type the exact target database name to restore".into());
    }
    let path = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !RESTORE_FILES
        .get_or_init(Default::default)
        .lock()
        .map_err(|e| e.to_string())?
        .contains(&path)
    {
        return Err("Select a backup file first".into());
    }
    let executable = tools(&profile.engine)?
        .1
        .ok_or("Restore tool was not found on PATH")?;
    let mut command = connection_command(&executable, &profile)?;
    match profile.engine.as_str() {
        "postgres" => {
            command.args([
                "--no-password",
                "--no-psqlrc",
                "--set=ON_ERROR_STOP=1",
                "--single-transaction",
            ]);
            command.stdin(std::fs::File::open(path).map_err(|e| e.to_string())?);
        }
        "mysql" | "mariadb" => {
            command
                .arg("--binary-mode")
                .arg(format!("--database={}", profile.database));
            command.stdin(std::fs::File::open(path).map_err(|e| e.to_string())?);
        }
        "sqlite" => {
            command.arg(format!(".restore {}", sqlite_argument(&path)?));
        }
        _ => return Err("Unsupported database engine".into()),
    }
    run(command, &profile.password).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sqlite_meta_paths_are_quoted_and_reject_newlines() {
        assert_eq!(
            sqlite_argument(Path::new("C:\\backup\\a.db")).unwrap(),
            "\"C:\\\\backup\\\\a.db\""
        );
        assert!(sqlite_argument(Path::new("a\n.restore b")).is_err());
    }
    #[test]
    fn rejects_unknown_engine() {
        assert!(tools("other").is_err());
    }
}
