#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod export;
mod plan;
mod structure;

fn main() {
    tauri::Builder::default()
        .manage(db::State::default())
        .invoke_handler(tauri::generate_handler![
            db::connect_db,
            db::disconnect_db,
            db::list_tables,
            db::read_table,
            db::describe_table,
            structure::schema_info,
            structure::table_info,
            structure::execute_ddl,
            db::read_erd,
            export::save_erd_export,
            db::run_query,
            db::apply_edits
        ])
        .run(tauri::generate_context!())
        .expect("Woojoo 실행 실패");
}
