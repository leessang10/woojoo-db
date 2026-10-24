#[tauri::command]
pub async fn save_environment_export(
    name: String,
    format: String,
    text: String,
) -> Result<bool, String> {
    if !matches!(format.as_str(), "env" | "json" | "yml") {
        return Err("Invalid environment export format.".into());
    }
    let safe_name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(100)
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .add_filter(format.to_uppercase(), &[format.as_str()])
            .set_file_name(format!("{safe_name}.{format}"))
            .save_file();
        let Some(path) = path else {
            return Ok(false);
        };
        std::fs::write(path, text).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_erd_export(name: String, format: String, bytes: Vec<u8>) -> Result<bool, String> {
    let valid = match format.as_str() {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "pdf" => bytes.starts_with(b"%PDF-"),
        _ => false,
    };
    if !valid || bytes.len() > 100_000_000 {
        return Err("Invalid ERD export.".into());
    }
    let safe_name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(120)
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .add_filter(format.to_uppercase(), &[format.as_str()])
            .set_file_name(format!("{safe_name}.{format}"))
            .save_file();
        let Some(path) = path else {
            return Ok(false);
        };
        std::fs::write(path, bytes).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
