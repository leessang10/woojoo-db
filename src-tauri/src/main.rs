#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
mod journal;
mod credentials;
mod local_database;
mod aws;
mod docker;
mod http;
mod data;
mod db;
mod export;
mod files;
mod maintenance;
mod plan;
mod sessions;
mod structure;
mod erd_changes;

/// Set by the UI while closing would lose pending edits or open transactions.
static CLOSE_GUARD: AtomicBool = AtomicBool::new(false);
static EXIT_STARTED: AtomicBool = AtomicBool::new(false);
static EXIT_READY: AtomicBool = AtomicBool::new(false);
#[tauri::command]
fn set_close_guard(enabled: bool) { CLOSE_GUARD.store(enabled, Ordering::SeqCst); }
#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    CLOSE_GUARD.store(false, Ordering::SeqCst);
    window.destroy().map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(db::State::default())
        .setup(|app| {
            let directory=app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let store=tauri::async_runtime::block_on(journal::Journal::open(&directory.join("query-executions.sqlite3"))).map_err(std::io::Error::other)?;
            app.manage(store);
            let requests=tauri::async_runtime::block_on(http::store::Store::open(&directory.join("api-client.sqlite3"))).map_err(std::io::Error::other)?;
            app.manage(requests);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if CLOSE_GUARD.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_close_guard,
            close_window,
            docker::docker_contexts,
            docker::engine::docker_start_desktop,
            docker::docker_snapshot,
            docker::docker_action,
            docker::docker_resource_remove,
            docker::docker_container_rename,
            docker::compose::compose_list,
            docker::compose::compose_import,
            docker::compose::compose_create,
            docker::compose::compose_read,
            docker::compose::compose_preview,
            docker::compose::compose_save,
            docker::compose::compose_action,
            docker::compose::compose_forget,
            docker::logs::docker_logs_start,
            docker::logs::docker_logs_stop,
            local_database::create_local_database,
            journal::execution_list,
            journal::execution_detail,
            journal::execution_connections,
            aws::discovery::aws_cli_info,
            aws::discovery::aws_environment,
            aws::discovery::aws_rds_instances,
            aws::resources::aws_list_resources,
            aws::resources::aws_browse_resources,
            aws::topology::aws_topology_query,
            aws::cli::aws_cancel,
            aws::actions::aws_prepare_action,
            aws::actions::aws_run_action,
            aws::actions::aws_cancel_action,
            aws::actions::aws_set_actions_enabled,
            http::store::http_workspace,
            http::store::http_save_collection,
            http::store::http_save_request,
            http::store::http_save_environment,
            http::store::http_delete,
            http::store::http_set_active_environment,
            http::store::http_history,
            http::store::http_history_detail,
            http::store::http_clear_history,
            http::client::http_send,
            http::client::http_cancel,
            http::client::http_pick_file,
            sessions::run_object_sql,
            sessions::transaction_mode,
            sessions::transaction_finish,
            sessions::execution_state,
            sessions::cancel_query,
            erd_changes::erd_plan,
            erd_changes::erd_apply,
            structure::table_ddl,
            structure::object_list,
            structure::object_definition,
            data::data_page,
            data::data_mutate,
            data::data_export,
            data::data_copy,
            files::sql_open_file,
            files::sql_save_file,
            db::choose_sqlite_file,
            maintenance::maintenance_tools,
            maintenance::maintenance_pick_restore,
            maintenance::maintenance_backup,
            maintenance::maintenance_restore,
            db::connect_db,
            db::credential_status,
            db::forget_password,
            db::disconnect_db,
            db::list_tables,
            db::list_schemas,
            db::read_table,
            db::describe_table,
            structure::schema_info,
            structure::table_info,
            structure::execute_ddl,
            db::read_erd,
            export::save_erd_export,
            db::run_query,
            db::apply_edits,
            db::set_result_limit
        ])
        .build(tauri::generate_context!())
        .expect("Woojoo 실행 실패")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if !EXIT_READY.load(Ordering::SeqCst) {
                    // Tauri exits the process directly; detached subprocess tasks must finish first.
                    api.prevent_exit();
                    if !EXIT_STARTED.swap(true, Ordering::SeqCst) {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            docker::logs::shutdown().await;
                            EXIT_READY.store(true, Ordering::SeqCst);
                            app.exit(code.unwrap_or(0));
                        });
                    }
                }
            }
        });
}
