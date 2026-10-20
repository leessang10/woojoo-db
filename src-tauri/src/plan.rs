#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quotes_identifiers_without_allowing_sql_escape() {
        assert_eq!(
            quote_ident("a\";DROP TABLE x;--", true),
            "\"a\"\";DROP TABLE x;--\""
        );
        assert_eq!(quote_ident("a`b", false), "`a``b`");
    }
    #[test]
    fn edits_require_a_complete_original_primary_key() {
        let columns = vec!["id".into(), "name".into()];
        assert!(validate_edit(
            &columns,
            &[],
            &serde_json::json!({"id":"1"}),
            &serde_json::json!({"name":"new"})
        )
        .is_err());
        assert!(validate_edit(
            &columns,
            &["id".into()],
            &serde_json::json!({"name":"old"}),
            &serde_json::json!({"name":"new"})
        )
        .is_err());
    }
    #[test]
    fn edits_reject_unknown_columns_and_primary_key_changes() {
        let columns = vec!["id".into(), "name".into()];
        let original = serde_json::json!({"id":"1","name":"old"});
        assert!(validate_edit(
            &columns,
            &["id".into()],
            &original,
            &serde_json::json!({"password":"x"})
        )
        .is_err());
        assert!(validate_edit(
            &columns,
            &["id".into()],
            &original,
            &serde_json::json!({"id":"2"})
        )
        .is_err());
        assert!(validate_edit(
            &columns,
            &["id".into()],
            &original,
            &serde_json::json!({"name":null})
        )
        .is_ok());
    }
}
use serde_json::Value;

pub fn quote_ident(value: &str, postgres: bool) -> String {
    let q = if postgres { '"' } else { '`' };
    format!("{q}{}{q}", value.replace(q, &format!("{q}{q}")))
}

pub fn validate_edit(
    columns: &[String],
    keys: &[String],
    original: &Value,
    changes: &Value,
) -> Result<(), String> {
    let old = original.as_object().ok_or("원본 행이 올바르지 않습니다.")?;
    let new = changes.as_object().ok_or("수정 값이 올바르지 않습니다.")?;
    if keys.is_empty() || keys.iter().any(|k| old.get(k).is_none_or(Value::is_null)) {
        return Err("행을 식별할 전체 기본키가 필요합니다.".into());
    }
    if new.is_empty() {
        return Err("변경할 값이 없습니다.".into());
    }
    for (name, value) in new {
        if !columns.contains(name) || keys.contains(name) || !old.contains_key(name) {
            return Err(format!("수정할 수 없는 열: {name}"));
        }
        if !(value.is_string() || value.is_null()) {
            return Err("수정 값은 문자열 또는 NULL이어야 합니다.".into());
        }
    }
    Ok(())
}
