const PG_SNAPSHOT: &str = "SELECT coalesce(json_agg(x ORDER BY x.schema,x.name)::text,'[]') FROM (SELECT n.nspname AS schema,c.relname AS name,c.relkind,c.oid::text,(SELECT json_agg(a ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0) AS columns,(SELECT json_agg(pg_get_constraintdef(k.oid) ORDER BY k.oid) FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints,(SELECT json_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid) AS indexes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%') x";
use crate::db::{self, Pool, State, Table};
use serde::{Deserialize, Serialize};
use sqlx::{Connection, Row};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDraft {
    name: String,
    data_type: String,
    nullable: bool,
    primary: bool,
    default_value: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Operation {
    CreateTable {
        table: Table,
        columns: Vec<ColumnDraft>,
    },
    AddColumn {
        table: Table,
        column: ColumnDraft,
    },
    AddIndex {
        table: Table,
        name: String,
        columns: Vec<String>,
        unique: bool,
    },
    #[serde(rename_all = "camelCase")]
    AddForeignKey {
        table: Table,
        name: String,
        columns: Vec<String>,
        target: Table,
        target_columns: Vec<String>,
        on_delete: Option<String>,
        on_update: Option<String>,
    },
}
impl Operation {
    fn table(&self) -> &Table {
        match self {
            Self::CreateTable { table, .. }
            | Self::AddColumn { table, .. }
            | Self::AddIndex { table, .. }
            | Self::AddForeignKey { table, .. } => table,
        }
    }
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    sqls: Vec<String>,
    expected_snapshot: String,
    transactional: bool,
    warnings: Vec<String>,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    completed: usize,
    total: usize,
    error: Option<String>,
    transactional: bool,
}
fn ident(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > 128 || s.chars().any(char::is_control) {
        Err("이름은 1–128자이며 제어 문자를 포함할 수 없습니다.".into())
    } else {
        Ok(())
    }
}
fn q(s: &str, my: bool) -> String {
    crate::plan::quote_ident(s, !my)
}
fn table(t: &Table, my: bool) -> String {
    db::qualified(t, !my)
}
fn col(c: &ColumnDraft, my: bool) -> Result<String, String> {
    ident(&c.name)?;
    // Only type names/modifiers and literal defaults are accepted, never executable expressions.
    let dt = c.data_type.trim();
    if dt.is_empty()
        || dt.len() > 100
        || !dt
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_ (),[]".contains(c))
        || dt.contains("--")
    {
        return Err("지원하지 않는 자료형입니다.".into());
    }
    let mut depth = 0;
    for ch in dt.chars() {
        match ch {
            '(' => {
                if depth != 0 {
                    return Err("잘못된 자료형 매개변수입니다.".into());
                }
                depth = 1
            }
            ')' => {
                if depth != 1 {
                    return Err("잘못된 자료형 매개변수입니다.".into());
                }
                depth = 0
            }
            ',' if depth == 0 => return Err("잘못된 자료형입니다.".into()),
            c if depth == 1 && !c.is_ascii_digit() && c != ',' && c != ' ' => {
                return Err("자료형 매개변수에는 숫자만 허용됩니다.".into())
            }
            _ => {}
        }
    }
    if depth != 0 {
        return Err("잘못된 자료형입니다.".into());
    }
    let words = dt.to_ascii_uppercase();
    if [
        "DEFAULT",
        "CHECK",
        "REFERENCES",
        "CONSTRAINT",
        "PRIMARY",
        "UNIQUE",
        "GENERATED",
        "NULL",
        "COLLATE",
    ]
    .iter()
    .any(|w| {
        words
            .split(|c: char| !c.is_ascii_alphabetic())
            .any(|v| v == *w)
    }) {
        return Err("자료형에 제약 조건을 입력할 수 없습니다.".into());
    }
    let mut s = format!(
        "{} {}{}",
        q(&c.name, my),
        dt,
        if c.nullable && !c.primary {
            ""
        } else {
            " NOT NULL"
        }
    );
    if let Some(d) = &c.default_value {
        let d = d.trim();
        if !d.is_empty() {
            let valid = d.parse::<f64>().is_ok()
                || [
                    "NULL",
                    "TRUE",
                    "FALSE",
                    "CURRENT_TIMESTAMP",
                    "CURRENT_DATE",
                    "CURRENT_TIME",
                ]
                .contains(&d.to_ascii_uppercase().as_str())
                || (d.starts_with('\'')
                    && d.ends_with('\'')
                    && d.len() >= 2
                    && !d[1..d.len() - 1].replace("''", "").contains('\''));
            if !valid || d.len() > 2000 || d.contains('\0') {
                return Err(
                    "기본값에는 숫자, 작은따옴표 문자열, NULL 또는 CURRENT_TIMESTAMP를 사용하세요."
                        .into(),
                );
            }
            s.push_str(&format!(" DEFAULT {d}"));
        }
    }
    Ok(s)
}
fn names(xs: &[String], my: bool) -> Result<String, String> {
    if xs.is_empty() || xs.len() > 32 {
        return Err("열을 1–32개 선택하세요.".into());
    }
    for x in xs {
        ident(x)?;
    }
    Ok(xs.iter().map(|s| q(s, my)).collect::<Vec<_>>().join(", "))
}
fn fk(op: &Operation, my: bool, sqlite: bool) -> Result<String, String> {
    if let Operation::AddForeignKey {
        table: t,
        name,
        columns,
        target,
        target_columns,
        on_delete,
        on_update,
    } = op
    {
        ident(name)?;
        ident(&target.schema)?;
        ident(&target.name)?;
        if columns.len() != target_columns.len() {
            return Err("외래 키 열 개수가 일치하지 않습니다.".into());
        }
        if sqlite && t.schema != target.schema {
            return Err("SQLite 교차 스키마 외래 키는 지원하지 않습니다.".into());
        }
        let mut s = format!(
            "CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
            q(name, my),
            names(columns, my)?,
            if sqlite {
                q(&target.name, my)
            } else {
                table(target, my)
            },
            names(target_columns, my)?
        );
        for (label, value) in [("DELETE", on_delete), ("UPDATE", on_update)] {
            if let Some(v) = value {
                let v = v.to_ascii_uppercase();
                if ![
                    "NO ACTION",
                    "RESTRICT",
                    "CASCADE",
                    "SET NULL",
                    "SET DEFAULT",
                ]
                .contains(&v.as_str())
                {
                    return Err("잘못된 외래 키 동작입니다.".into());
                }
                s.push_str(&format!(" ON {label} {v}"));
            }
        }
        Ok(s)
    } else {
        Err("외래 키 작업이 아닙니다.".into())
    }
}
fn sql(op: &Operation, my: bool, sqlite: bool) -> Result<String, String> {
    let t = op.table();
    ident(&t.schema)?;
    ident(&t.name)?;
    if sqlite && t.schema != "main" {
        return Err("SQLite main 스키마만 지원합니다.".into());
    }
    match op {
        Operation::CreateTable { columns, .. } => {
            if columns.is_empty() || columns.len() > 256 {
                return Err("테이블에는 1–256개 열이 필요합니다.".into());
            }
            let mut defs = columns
                .iter()
                .map(|c| col(c, my))
                .collect::<Result<Vec<_>, _>>()?;
            let pk = columns
                .iter()
                .filter(|c| c.primary)
                .map(|c| c.name.clone())
                .collect::<Vec<_>>();
            if !pk.is_empty() {
                defs.push(format!("PRIMARY KEY ({})", names(&pk, my)?));
            }
            Ok(format!(
                "CREATE TABLE {} ({})",
                table(t, my),
                defs.join(", ")
            ))
        }
        Operation::AddColumn { column, .. } => {
            if column.primary {
                return Err("기존 테이블에는 기본 키 열을 추가할 수 없습니다.".into());
            }
            Ok(format!(
                "ALTER TABLE {} ADD COLUMN {}",
                table(t, my),
                col(column, my)?
            ))
        }
        Operation::AddIndex {
            name,
            columns,
            unique,
            ..
        } => {
            ident(name)?;
            Ok(format!(
                "CREATE {}INDEX {} ON {} ({})",
                if *unique { "UNIQUE " } else { "" },
                if sqlite {
                    format!("{}.{}", q(&t.schema, my), q(name, my))
                } else {
                    q(name, my)
                },
                if sqlite { q(&t.name, my) } else { table(t, my) },
                names(columns, my)?
            ))
        }
        Operation::AddForeignKey { .. } => Ok(format!(
            "ALTER TABLE {} ADD {}",
            table(t, my),
            fk(op, my, sqlite)?
        )),
    }
}
async fn sqlite_schema(
    c: &mut sqlx::SqliteConnection,
) -> Result<Vec<(String, String, String)>, String> {
    sqlx::query_as("SELECT type,name,sql FROM main.sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,name").fetch_all(c).await.map_err(db::error)
}
async fn snapshot(p: &Pool) -> Result<String, String> {
    match p {
        Pool::Sqlite(p) => {
            let mut c = p.acquire().await.map_err(db::error)?;
            serde_json::to_string(&sqlite_schema(&mut c).await?).map_err(db::error)
        }
        Pool::Pg(p) => sqlx::query_scalar(PG_SNAPSHOT)
            .fetch_one(p)
            .await
            .map_err(db::error),
        Pool::My(p) => {
            let tables:Vec<(String,String)>=sqlx::query_as("SELECT TABLE_SCHEMA,TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys') ORDER BY TABLE_SCHEMA,TABLE_NAME").fetch_all(p).await.map_err(db::error)?;
            let mut result = vec![];
            for (s, n) in tables {
                let r = sqlx::query(&format!(
                    "SHOW CREATE TABLE {}",
                    table(&Table { schema: s, name: n }, true)
                ))
                .fetch_one(p)
                .await
                .map_err(db::error)?;
                result.push(r.try_get_unchecked::<String, _>(1).map_err(db::error)?);
            }
            serde_json::to_string(&result).map_err(db::error)
        }
    }
}
// Preserve the complete original column/constraint body and table suffix.
fn body_bounds(ddl: &str) -> Result<(usize, usize), String> {
    let mut quote = None;
    let mut depth = 0;
    let mut start = None;
    let mut end = None;
    let mut chars = ddl.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if let Some(q) = quote {
            if c == q {
                if chars.peek().is_some_and(|(_, n)| *n == q) {
                    chars.next();
                } else {
                    quote = None
                }
            }
            continue;
        }
        match c {
            '\'' | '"' | '`' => quote = Some(c),
            '[' => quote = Some(']'),
            '(' => {
                if depth == 0 {
                    start = Some(i)
                }
                depth += 1
            }
            ')' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(i)
                }
            }
            '-' if chars.peek().is_some_and(|(_, n)| *n == '-') => {
                return Err("주석을 포함한 테이블 DDL 재구성은 지원하지 않습니다.".into())
            }
            '/' if chars.peek().is_some_and(|(_, n)| *n == '*') => {
                return Err("주석을 포함한 테이블 DDL 재구성은 지원하지 않습니다.".into())
            }
            _ => {}
        }
    }
    match (start, end) {
        (Some(a), Some(b)) if depth == 0 && quote.is_none() => Ok((a, b)),
        _ => Err("테이블 DDL을 안전하게 분석할 수 없습니다.".into()),
    }
}
async fn rebuild(
    c: &mut sqlx::SqliteConnection,
    op: &Operation,
    index: usize,
) -> Result<Vec<String>, String> {
    let t = op.table();
    let ddl: String =
        sqlx::query_scalar("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
            .bind(&t.name)
            .fetch_one(&mut *c)
            .await
            .map_err(db::error)?;
    if ddl.to_ascii_uppercase().contains("VIRTUAL TABLE") {
        return Err("가상 테이블 외래 키는 지원하지 않습니다.".into());
    }
    let (a, b) = body_bounds(&ddl)?;
    let temp = format!("__woojoo_erd_rebuild_{index}");
    let seq = format!("__woojoo_erd_sequence_{index}");
    let exists: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_schema WHERE name IN (?,?)")
        .bind(&temp)
        .bind(&seq)
        .fetch_one(&mut *c)
        .await
        .map_err(db::error)?;
    if exists > 0 {
        return Err("ERD 임시 테이블 이름이 이미 사용 중입니다.".into());
    }
    let rows = sqlx::query("SELECT name,hidden FROM pragma_table_xinfo(?) ORDER BY cid")
        .bind(&t.name)
        .fetch_all(&mut *c)
        .await
        .map_err(db::error)?;
    let mut cols = rows
        .iter()
        .filter(|r| r.get::<i64, _>(1) == 0)
        .map(|r| r.get::<String, _>(0))
        .collect::<Vec<_>>();
    if !ddl.to_ascii_uppercase().contains("WITHOUT ROWID") {
        let alias = ["rowid", "_rowid_", "oid"]
            .iter()
            .find(|a| {
                !rows
                    .iter()
                    .any(|r| r.get::<String, _>(0).eq_ignore_ascii_case(a))
            })
            .ok_or("모든 rowid 별칭이 가려진 테이블은 재구성할 수 없습니다.")?;
        cols.insert(0, alias.to_string());
    }
    let columns = cols
        .iter()
        .map(|s| q(s, false))
        .collect::<Vec<_>>()
        .join(", ");
    let objects:Vec<String>=sqlx::query_scalar("SELECT sql FROM sqlite_schema WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").bind(&t.name).fetch_all(&mut *c).await.map_err(db::error)?;
    let auto = ddl.to_ascii_uppercase().contains("AUTOINCREMENT");
    let mut sqls = vec![];
    if auto {
        sqls.push(format!("CREATE TABLE {} (seq INTEGER)", q(&seq, false)));
        sqls.push(format!(
            "INSERT INTO {} SELECT seq FROM sqlite_sequence WHERE name='{}'",
            q(&seq, false),
            t.name.replace('\'', "''")
        ));
    }
    sqls.push(format!(
        "CREATE TABLE {} ({}, {}){}",
        q(&temp, false),
        &ddl[a + 1..b],
        fk(op, false, true)?,
        &ddl[b + 1..]
    ));
    sqls.push(format!(
        "INSERT INTO {} ({columns}) SELECT {columns} FROM {}",
        q(&temp, false),
        table(t, false)
    ));
    sqls.push(format!("DROP TABLE {}", table(t, false)));
    sqls.push(format!(
        "ALTER TABLE {} RENAME TO {}",
        q(&temp, false),
        q(&t.name, false)
    ));
    if auto {
        sqls.push(format!("UPDATE sqlite_sequence SET seq=max(seq,coalesce((SELECT max(seq) FROM {}),0)) WHERE name='{}'",q(&seq,false),t.name.replace('\'',"''")));
        sqls.push(format!("DROP TABLE {}", q(&seq, false)));
    }
    sqls.extend(objects);
    Ok(sqls)
}
async fn prepare(p: &Pool, ops: &[Operation]) -> Result<(Plan, Vec<Vec<String>>), String> {
    if ops.is_empty()
        || ops.len() > 64
        || serde_json::to_vec(ops).map_err(db::error)?.len() > 200_000
    {
        return Err("ERD 변경은 1–64개, 200KB 이하로 제출하세요.".into());
    }
    let expected_snapshot = snapshot(p).await?;
    let mut groups = vec![];
    if matches!(p, Pool::Sqlite(_)) {
        let mut c = sqlx::SqliteConnection::connect("sqlite::memory:")
            .await
            .map_err(db::error)?;
        sqlx::query("PRAGMA legacy_alter_table=ON")
            .execute(&mut c)
            .await
            .map_err(db::error)?;
        sqlx::query("PRAGMA foreign_keys=OFF")
            .execute(&mut c)
            .await
            .map_err(db::error)?;
        let schema: Vec<(String, String, String)> =
            serde_json::from_str(&expected_snapshot).map_err(db::error)?;
        for (_, _, ddl) in schema {
            sqlx::query(&ddl).execute(&mut c).await.map_err(db::error)?;
        }
        for (i, op) in ops.iter().enumerate() {
            let regular = sql(op, false, true)?;
            let group = if matches!(op, Operation::AddForeignKey { .. }) {
                rebuild(&mut c, op, i).await?
            } else {
                vec![regular]
            };
            for s in &group {
                sqlx::query(s).execute(&mut c).await.map_err(db::error)?;
            }
            groups.push(group);
        }
    } else {
        for op in ops {
            groups.push(vec![sql(op, matches!(p, Pool::My(_)), false)?]);
        }
    }
    let transactional = !matches!(p, Pool::My(_));
    let warnings = if transactional {
        if ops
            .iter()
            .any(|o| matches!(o, Operation::AddForeignKey { .. }))
            && matches!(p, Pool::Sqlite(_))
        {
            vec![
                "SQLite 외래 키 추가는 원본 DDL과 데이터를 보존하는 테이블 재구성을 수행합니다."
                    .into(),
            ]
        } else {
            vec![]
        }
    } else {
        vec!["MySQL/MariaDB DDL은 자동 커밋됩니다. 실패 전 완료된 변경은 유지되며 되돌릴 수 없습니다.".into()]
    };
    Ok((
        Plan {
            sqls: groups.iter().flatten().cloned().collect(),
            expected_snapshot,
            transactional,
            warnings,
        },
        groups,
    ))
}
#[tauri::command]
pub async fn erd_plan(
    state: tauri::State<'_, State>,
    id: String,
    operations: Vec<Operation>,
) -> Result<Plan, String> {
    db::ensure_writable(&state, &id).await?;
    let p = db::pool(&state, &id).await?;
    prepare(&p, &operations).await.map(|x| x.0)
}
async fn apply_groups(
    p: &Pool,
    groups: &[Vec<String>],
    expected: &str,
    operations: &[Operation],
) -> Result<Applied, String> {
    let total = groups.len();
    if snapshot(p).await? != expected {
        return Err("스키마가 변경되었습니다. 새로고침하고 변경 SQL을 다시 검토하세요.".into());
    }
    match p {
        Pool::Sqlite(p) => {
            let mut c = p.acquire().await.map_err(db::error)?;
            c.close_on_drop();
            sqlx::query("PRAGMA legacy_alter_table=ON")
                .execute(&mut *c)
                .await
                .map_err(db::error)?;
            sqlx::query("PRAGMA foreign_keys=OFF")
                .execute(&mut *c)
                .await
                .map_err(db::error)?;
            let mut tx = c.begin_with("BEGIN IMMEDIATE").await.map_err(db::error)?;
            let actual =
                serde_json::to_string(&sqlite_schema(&mut tx).await?).map_err(db::error)?;
            if actual != expected {
                return Err("스키마가 변경되었습니다. 다시 검토하세요.".into());
            }
            for s in groups.iter().flatten() {
                sqlx::query(s).execute(&mut *tx).await.map_err(db::error)?;
            }
            let violations = sqlx::query("PRAGMA foreign_key_check")
                .fetch_all(&mut *tx)
                .await
                .map_err(db::error)?;
            if !violations.is_empty() {
                return Err(format!(
                    "외래 키 위반 {}건: 모든 변경을 롤백했습니다.",
                    violations.len()
                ));
            }
            tx.commit().await.map_err(db::error)?;
        }
        Pool::Pg(p) => {
            let mut tx = p.begin().await.map_err(db::error)?;
            sqlx::query("SET LOCAL standard_conforming_strings=on")
                .execute(&mut *tx)
                .await
                .map_err(db::error)?;
            sqlx::query("SET LOCAL lock_timeout='5s'")
                .execute(&mut *tx)
                .await
                .map_err(db::error)?;
            // Lock existing affected tables before rechecking metadata, closing the
            // check/apply race with concurrent ALTER/DROP on those relations.
            let metadata: serde_json::Value = serde_json::from_str(expected).map_err(db::error)?;
            let mut locks = std::collections::BTreeSet::new();
            for op in operations {
                let mut touched = vec![op.table()];
                if let Operation::AddForeignKey { target, .. } = op {
                    touched.push(target);
                }
                for t in touched {
                    if metadata.as_array().is_some_and(|rows| {
                        rows.iter().any(|r| {
                            r["schema"] == t.schema
                                && r["name"] == t.name
                                && matches!(r["relkind"].as_str(), Some("r" | "p"))
                        })
                    }) {
                        locks.insert(table(t, false));
                    }
                }
            }
            for relation in locks {
                sqlx::query(&format!("LOCK TABLE {relation} IN ACCESS EXCLUSIVE MODE"))
                    .execute(&mut *tx)
                    .await
                    .map_err(db::error)?;
            }
            let actual: String = sqlx::query_scalar(PG_SNAPSHOT)
                .fetch_one(&mut *tx)
                .await
                .map_err(db::error)?;
            if actual != expected {
                return Err("스키마가 변경되었습니다. 다시 검토하세요.".into());
            }
            for s in groups.iter().flatten() {
                sqlx::query(s).execute(&mut *tx).await.map_err(db::error)?;
            }
            tx.commit().await.map_err(db::error)?;
        }
        Pool::My(p) => {
            let mut c = p.acquire().await.map_err(db::error)?;
            c.close_on_drop();
            sqlx::query("SET SESSION sql_mode=CONCAT_WS(',',@@SESSION.sql_mode,'NO_BACKSLASH_ESCAPES','STRICT_ALL_TABLES')").execute(&mut *c).await.map_err(db::error)?;
            sqlx::query("SET SESSION lock_wait_timeout=5")
                .execute(&mut *c)
                .await
                .map_err(db::error)?;
            for (i, g) in groups.iter().enumerate() {
                for s in g {
                    if let Err(e) = sqlx::query(s).execute(&mut *c).await {
                        return Ok(Applied {
                            completed: i,
                            total,
                            error: Some(e.to_string()),
                            transactional: false,
                        });
                    }
                }
            }
        }
    }
    Ok(Applied {
        completed: total,
        total,
        error: None,
        transactional: !matches!(p, Pool::My(_)),
    })
}
#[tauri::command]
pub async fn erd_apply(
    app: tauri::AppHandle,
    store: tauri::State<'_, crate::journal::Journal>,
    state: tauri::State<'_, State>,
    id: String,
    operations: Vec<Operation>,
    expected_snapshot: String,
) -> Result<Applied, String> {
    db::ensure_writable(&state, &id).await?;
    let session = crate::sessions::session(&state, &id).await?;
    session
        .external_schema_change(async {
            let p = db::pool(&state, &id).await?;
            let (plan, groups) = prepare(&p, &operations).await?;
            if plan.expected_snapshot != expected_snapshot {
                return Err("스키마가 변경되었습니다. 변경 SQL을 다시 검토하세요.".into());
            }
            let mut applied = None;
            let logged = crate::journal::record(
                &app,
                &store,
                &state,
                &id,
                &plan.sqls.join(";\n"),
                "erd",
                async {
                    let result = apply_groups(&p, &groups, &expected_snapshot, &operations).await?;
                    let failure = result.error.as_ref().map(|e| {
                        format!(
                            "{} / {} operations committed: {e}",
                            result.completed, result.total
                        )
                    });
                    applied = Some(result);
                    match failure {
                        Some(e) => Err(e),
                        None => Ok(()),
                    }
                },
            )
            .await;
            match applied {
                Some(result) => Ok(result),
                None => {
                    logged?;
                    Err("ERD 실행 결과를 확인할 수 없습니다.".into())
                }
            }
        })
        .await
}
#[cfg(test)]
mod tests {
    use super::*;
    async fn fixture() -> Pool {
        let p = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(
                        std::env::temp_dir()
                            .join(format!("erd-test-{}.sqlite", uuid::Uuid::new_v4())),
                    )
                    .create_if_missing(true)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        for s in ["CREATE TABLE parent(id INTEGER PRIMARY KEY)","INSERT INTO parent VALUES(1)","CREATE TABLE child(id INTEGER PRIMARY KEY AUTOINCREMENT,pid INTEGER, label TEXT DEFAULT 'a,b' CHECK(length(label)>0), derived TEXT GENERATED ALWAYS AS (label||'!') STORED)","CREATE UNIQUE INDEX child_label ON child(label)","CREATE TABLE audit(value TEXT)","CREATE TRIGGER child_insert AFTER INSERT ON child BEGIN INSERT INTO audit VALUES(new.label); END","INSERT INTO child(id,pid,label) VALUES(10,1,'kept')","INSERT INTO child(id,pid,label) VALUES(100,1,'removed')","DELETE FROM child WHERE id=100","CREATE TABLE incoming(id INTEGER PRIMARY KEY, child_id INTEGER REFERENCES child(id) ON DELETE CASCADE)","INSERT INTO incoming VALUES(1,10)","CREATE VIEW child_view AS SELECT id,label FROM child"]{sqlx::query(s).execute(&p).await.unwrap();}
        Pool::Sqlite(p)
    }
    fn foreign() -> Operation {
        serde_json::from_value(serde_json::json!({"kind":"addForeignKey","table":{"schema":"main","name":"child"},"name":"child_parent","columns":["pid"],"target":{"schema":"main","name":"parent"},"targetColumns":["id"],"onDelete":"CASCADE"})).unwrap()
    }
    #[tokio::test]
    async fn rebuild_preserves_data_generated_constraints_indexes_triggers_sequence() {
        let p = fixture().await;
        let (plan, groups) = prepare(&p, &[foreign()]).await.unwrap();
        assert_eq!(snapshot(&p).await.unwrap(), plan.expected_snapshot);
        apply_groups(&p, &groups, &plan.expected_snapshot, &[])
            .await
            .unwrap();
        if let Pool::Sqlite(p) = p {
            let r: (i64, String, String) = sqlx::query_as("SELECT id,label,derived FROM child")
                .fetch_one(&p)
                .await
                .unwrap();
            assert_eq!(r, (10, "kept".into(), "kept!".into()));
            sqlx::query("INSERT INTO child(pid,label) VALUES(1,'new')")
                .execute(&p)
                .await
                .unwrap();
            let id: i64 = sqlx::query_scalar("SELECT id FROM child WHERE label='new'")
                .fetch_one(&p)
                .await
                .unwrap();
            assert_eq!(id, 101);
            let incoming: i64 = sqlx::query_scalar("SELECT count(*) FROM incoming")
                .fetch_one(&p)
                .await
                .unwrap();
            assert_eq!(incoming, 1);
            let visible: i64 = sqlx::query_scalar("SELECT count(*) FROM child_view")
                .fetch_one(&p)
                .await
                .unwrap();
            assert_eq!(visible, 2);
            assert!(
                sqlx::query("INSERT INTO child(pid,label) VALUES(999,'bad')")
                    .execute(&p)
                    .await
                    .is_err()
            );
            assert!(sqlx::query("INSERT INTO child(pid,label) VALUES(1,'new')")
                .execute(&p)
                .await
                .is_err());
            let n: i64 = sqlx::query_scalar("SELECT count(*) FROM audit WHERE value='new'")
                .fetch_one(&p)
                .await
                .unwrap();
            assert_eq!(n, 1);
        }
    }
    #[tokio::test]
    async fn failure_rolls_back_entire_batch_and_rejects_stale_snapshot() {
        let p = fixture().await;
        let ops=vec![serde_json::from_value(serde_json::json!({"kind":"addColumn","table":{"schema":"main","name":"child"},"column":{"name":"extra","dataType":"TEXT","nullable":true,"primary":false}})).unwrap(),foreign()];
        let (plan, groups) = prepare(&p, &ops).await.unwrap();
        if let Pool::Sqlite(p) = &p {
            sqlx::query("UPDATE child SET pid=999")
                .execute(p)
                .await
                .unwrap();
        }
        assert!(apply_groups(&p, &groups, &plan.expected_snapshot, &[])
            .await
            .is_err());
        assert_eq!(snapshot(&p).await.unwrap(), plan.expected_snapshot);
        if let Pool::Sqlite(p) = &p {
            sqlx::query("CREATE INDEX changed ON child(pid)")
                .execute(p)
                .await
                .unwrap();
        }
        assert!(apply_groups(&p, &groups, &plan.expected_snapshot, &[])
            .await
            .unwrap_err()
            .contains("스키마"));
    }
    #[tokio::test]
    async fn physical_self_foreign_key_survives_rebuild() {
        let p = fixture().await;
        if let Pool::Sqlite(p) = &p {
            sqlx::query("UPDATE child SET pid=id")
                .execute(p)
                .await
                .unwrap();
        }
        let op:Operation=serde_json::from_value(serde_json::json!({"kind":"addForeignKey","table":{"schema":"main","name":"child"},"name":"child_self","columns":["pid"],"target":{"schema":"main","name":"child"},"targetColumns":["id"]})).unwrap();
        let (plan, groups) = prepare(&p, &[op.clone()]).await.unwrap();
        apply_groups(&p, &groups, &plan.expected_snapshot, &[op])
            .await
            .unwrap();
        if let Pool::Sqlite(p) = &p {
            let target: String =
                sqlx::query_scalar("SELECT \"table\" FROM pragma_foreign_key_list('child')")
                    .fetch_one(p)
                    .await
                    .unwrap();
            assert_eq!(target, "child");
            assert!(sqlx::query("UPDATE child SET pid=999")
                .execute(p)
                .await
                .is_err());
        }
    }
    #[test]
    fn mysql_create_then_fk_is_one_statement_per_operation() {
        let create:Operation=serde_json::from_value(serde_json::json!({"kind":"createTable","table":{"schema":"sample","name":"child"},"columns":[{"name":"id","dataType":"INTEGER","nullable":false,"primary":true},{"name":"pid","dataType":"INTEGER","nullable":true,"primary":false}]})).unwrap();
        assert!(sql(&create, true, false)
            .unwrap()
            .starts_with("CREATE TABLE `sample`.`child`"));
        assert!(sql(&foreign(), true, false)
            .unwrap()
            .starts_with("ALTER TABLE `main`.`child` ADD CONSTRAINT"));
    }
    #[test]
    fn rejects_injection() {
        let c = ColumnDraft {
            name: "x".into(),
            data_type: "TEXT); DROP TABLE child; --".into(),
            nullable: true,
            primary: false,
            default_value: None,
        };
        assert!(col(&c, false).is_err());
    }
}
