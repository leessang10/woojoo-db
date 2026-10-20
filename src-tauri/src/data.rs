use crate::db::{self, Column, DbResult, Pool, QueryResult, Row, State, Table};
use crate::plan::quote_ident;
use serde::Deserialize;
use serde_json::Value;
use sqlx::Row as _;
use std::io::Write;
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    column: String,
    operator: String,
    value: String,
}
#[derive(Clone, Deserialize)]
pub struct Order {
    column: String,
    descending: bool,
}
#[derive(Clone, Deserialize)]
pub struct PageRequest {
    offset: u64,
    limit: u32,
    filters: Vec<Filter>,
    order: Vec<Order>,
}
#[derive(Clone, Deserialize)]
pub struct Operation {
    kind: String,
    original: Row,
    values: Row,
}
fn binary(c: &Column) -> bool {
    matches!(
        c.data_type.to_lowercase().as_str(),
        "bytea" | "blob" | "binary" | "varbinary" | "tinyblob" | "mediumblob" | "longblob"
    )
}
async fn data_columns(p: &Pool, table: &Table) -> DbResult<Vec<Column>> {
    let mut columns = db::metadata(p, table).await?;
    for c in &mut columns {
        if c.primary || c.editable || !(binary(c) || c.data_type.starts_with("json")) {
            continue;
        }
        c.editable=match p{Pool::Pg(pool)=>sqlx::query_scalar::<_,bool>("SELECT is_generated='NEVER' AND is_identity='NO' FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3").bind(&table.schema).bind(&table.name).bind(&c.name).fetch_one(pool).await.map_err(db::error)?,Pool::My(pool)=>{let extra:String=sqlx::query_scalar("SELECT EXTRA FROM information_schema.columns WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?").bind(&table.schema).bind(&table.name).bind(&c.name).fetch_one(pool).await.map_err(db::error)?;!extra.contains("GENERATED")&&!extra.contains("auto_increment")},Pool::Sqlite(_)=>c.editable};
    }
    Ok(columns)
}
fn projection(c: &Column, pg: bool, sqlite: bool) -> String {
    let q = quote_ident(&c.name, pg || sqlite);
    if binary(c) {
        if pg {
            format!("CASE WHEN {q} IS NULL THEN NULL ELSE '0x'||encode({q},'hex') END")
        } else if sqlite {
            format!("CASE WHEN {q} IS NULL THEN NULL ELSE '0x'||hex({q}) END")
        } else {
            format!("CASE WHEN {q} IS NULL THEN NULL ELSE CONCAT('0x',HEX({q})) END")
        }
    } else {
        format!(
            "CAST({q} AS {})",
            if pg || sqlite { "TEXT" } else { "CHAR" }
        )
    }
}
fn select_sql(
    table: &Table,
    columns: &[Column],
    request: &PageRequest,
    pg: bool,
    sqlite: bool,
) -> DbResult<(String, Vec<String>)> {
    if request.limit == 0
        || request.limit > 1000
        || request.filters.len() > 20
        || request.order.len() > 20
    {
        return Err("Invalid page size/filter count".into());
    }
    let find = |name: &str| {
        columns
            .iter()
            .find(|c| c.name == name)
            .ok_or_else(|| format!("Unknown column: {name}"))
    };
    let mut values = vec![];
    let mut conditions = vec![];
    for f in &request.filters {
        let c = find(&f.column)?;
        let expr = projection(c, pg, sqlite);
        if f.operator == "null" || f.operator == "notNull" {
            conditions.push(format!(
                "{} IS {}NULL",
                quote_ident(&c.name, pg || sqlite),
                if f.operator == "notNull" { "NOT " } else { "" }
            ));
            continue;
        }
        let op = match f.operator.as_str() {
            "eq" => "=",
            "ne" => "<>",
            "gt" => ">",
            "lt" => "<",
            "contains" => "LIKE",
            _ => return Err("Invalid filter operator".into()),
        };
        values.push(if f.operator == "contains" {
            format!(
                "%{}%",
                f.value
                    .replace('!', "!!")
                    .replace('%', "!%")
                    .replace('_', "!_")
            )
        } else {
            f.value.clone()
        });
        let placeholder = if pg {
            format!("${}", values.len())
        } else {
            "?".into()
        };
        let comparison = if f.operator == "gt" || f.operator == "lt" {
            let ty = c.data_type.to_lowercase();
            let q = quote_ident(&c.name, pg || sqlite);
            if ["int", "numeric", "decimal", "real", "double", "float"]
                .iter()
                .any(|t| ty.contains(t))
            {
                f.value
                    .parse::<bigdecimal::BigDecimal>()
                    .map_err(|_| "Numeric filter requires a number")?;
                format!(
                    "{q} {op} CAST({placeholder} AS {})",
                    if pg || sqlite {
                        "NUMERIC"
                    } else {
                        "DECIMAL(65,30)"
                    }
                )
            } else if pg
                && [
                    "date",
                    "timestamp without time zone",
                    "timestamp with time zone",
                    "time without time zone",
                    "time with time zone",
                ]
                .contains(&ty.as_str())
            {
                format!("{q} {op} CAST({placeholder} AS {ty})")
            } else {
                format!("{expr} {op} {placeholder}")
            }
        } else {
            format!("{expr} {op} {placeholder}")
        };
        conditions.push(format!(
            "{comparison}{}",
            if f.operator == "contains" {
                " ESCAPE '!'"
            } else {
                ""
            }
        ));
    }
    let mut order = vec![];
    for o in &request.order {
        find(&o.column)?;
        order.push(format!(
            "{} {}",
            quote_ident(&o.column, pg || sqlite),
            if o.descending { "DESC" } else { "ASC" }
        ));
    }
    for c in columns.iter().filter(|c| c.primary) {
        if !request.order.iter().any(|o| o.column == c.name) {
            order.push(quote_ident(&c.name, pg || sqlite));
        }
    }
    let sql = format!(
        "SELECT {} FROM {}{}{} LIMIT {} OFFSET {}",
        columns
            .iter()
            .map(|c| format!(
                "{} AS {}",
                projection(c, pg, sqlite),
                quote_ident(&c.name, pg || sqlite)
            ))
            .collect::<Vec<_>>()
            .join(","),
        db::qualified(table, pg || sqlite),
        if conditions.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", conditions.join(" AND "))
        },
        if order.is_empty() {
            String::new()
        } else {
            format!(" ORDER BY {}", order.join(","))
        },
        request.limit + 1,
        request.offset
    );
    Ok((sql, values))
}
async fn page(p: &Pool, table: &Table, request: &PageRequest) -> DbResult<QueryResult> {
    let now = std::time::Instant::now();
    let columns = data_columns(p, table).await?;
    let (sql, values) = select_sql(
        table,
        &columns,
        request,
        matches!(p, Pool::Pg(_)),
        matches!(p, Pool::Sqlite(_)),
    )?;
    macro_rules! fetch {
        ($pool:expr,$get:ident) => {{
            let mut q = sqlx::query(&sql);
            for v in &values {
                q = q.bind(v);
            }
            q.fetch_all($pool)
                .await
                .map_err(db::error)?
                .into_iter()
                .map(|r| {
                    columns
                        .iter()
                        .enumerate()
                        .map(|(i, c)| {
                            Ok((
                                c.name.clone(),
                                r.$get::<Option<String>, _>(i)
                                    .map_err(db::error)?
                                    .map(Value::String)
                                    .unwrap_or(Value::Null),
                            ))
                        })
                        .collect::<DbResult<Row>>()
                })
                .collect::<DbResult<Vec<_>>>()?
        }};
    }
    let mut rows = match p {
        Pool::Pg(p) => fetch!(p, try_get),
        Pool::My(p) => fetch!(p, try_get_unchecked),
        Pool::Sqlite(p) => fetch!(p, try_get),
    };
    let truncated = rows.len() > request.limit as usize;
    rows.truncate(request.limit as usize);
    Ok(QueryResult {
        columns,
        rows,
        elapsed_ms: now.elapsed().as_millis(),
        affected: 0,
        truncated,
    })
}
#[tauri::command]
pub async fn data_page(
    state: tauri::State<'_, State>,
    id: String,
    table: Table,
    request: PageRequest,
) -> DbResult<QueryResult> {
    page(&db::pool(&state, &id).await?, &table, &request).await
}
fn validate(columns: &[Column], op: &Operation) -> DbResult<()> {
    if !["insert", "update", "delete"].contains(&op.kind.as_str()) {
        return Err("Invalid operation".into());
    }
    if op.values.iter().chain(op.original.iter()).any(|(name, v)| {
        !columns.iter().any(|c| &c.name == name) || !(v.is_string() || v.is_null())
    }) {
        return Err("Unknown column or invalid cell value".into());
    }
    if op.kind != "insert" {
        let keys: Vec<_> = columns.iter().filter(|c| c.primary).collect();
        if keys.is_empty()
            || keys
                .iter()
                .any(|c| op.original.get(&c.name).is_none_or(Value::is_null))
        {
            return Err("A complete primary key is required".into());
        }
        if columns.iter().any(|c| !op.original.contains_key(&c.name)) {
            return Err("Complete original row is required for conflict detection".into());
        }
    }
    if op.kind == "update"
        && (op.values.is_empty()
            || op
                .values
                .keys()
                .any(|k| !columns.iter().any(|c| &c.name == k && c.editable)))
    {
        return Err("Column is not editable".into());
    }
    Ok(())
}
fn decode_hex(value: &Value) -> DbResult<Option<Vec<u8>>> {
    if value.is_null() {
        return Ok(None);
    }
    let s = value.as_str().ok_or("Binary value must be hex text")?;
    let hex = s
        .strip_prefix("0x")
        .ok_or("Binary value must start with 0x")?;
    if hex.len() % 2 != 0 || !hex.is_ascii() {
        return Err("Invalid hex bytes".into());
    }
    Ok(Some(
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(db::error))
            .collect::<DbResult<Vec<_>>>()?,
    ))
}
async fn mutate(p: &Pool, table: &Table, operations: &[Operation]) -> DbResult<usize> {
    if operations.is_empty() {
        return Err("No operations".into());
    }
    let columns = data_columns(p, table).await?;
    for op in operations {
        validate(&columns, op)?;
    }
    if let Pool::My(p) = p {
        let engine: Option<String> = sqlx::query_scalar(
            "SELECT ENGINE FROM information_schema.tables WHERE TABLE_SCHEMA=? AND TABLE_NAME=?",
        )
        .bind(&table.schema)
        .bind(&table.name)
        .fetch_optional(p)
        .await
        .map_err(db::error)?;
        if engine.as_deref() != Some("InnoDB") {
            return Err("Atomic writes require InnoDB".into());
        }
    }
    match p {
        Pool::Pg(p) => {
            let mut tx = p.begin().await.map_err(db::error)?;
            let name = db::qualified(table, true);
            for op in operations {
                let mut vals = op.values.clone();
                let mut original = op.original.clone();
                for c in columns.iter().filter(|c| binary(c)) {
                    for row in [&mut vals, &mut original] {
                        if let Some(v) = row.get_mut(&c.name) {
                            if let Some(bytes) = decode_hex(v)? {
                                *v = Value::String(format!(
                                    "\\x{}",
                                    bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
                                ));
                            }
                        }
                    }
                }
                let expression = |k: &str, index: u8| {
                    let column = columns.iter().find(|c| c.name == k).unwrap();
                    if column.data_type == "json" || column.data_type == "jsonb" {
                        format!(
                            "CAST(${index}::json ->> {} AS {})",
                            sql_literal(k, true, false),
                            column.data_type
                        )
                    } else {
                        format!(
                            "(json_populate_record(NULL::{name},${index}::json)).{}",
                            quote_ident(k, true)
                        )
                    }
                };
                let condition = op
                    .original
                    .keys()
                    .map(|k| {
                        let q = quote_ident(k, true);
                        let column = columns.iter().find(|c| c.name == *k).unwrap();
                        let cast = if column.data_type == "json" || column.data_type == "jsonb" {
                            "JSONB"
                        } else {
                            "TEXT"
                        };
                        format!(
                            "CAST({q} AS {cast}) IS NOT DISTINCT FROM CAST({} AS {cast})",
                            expression(k, 2)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(" AND ");
                let sql = match op.kind.as_str() {
                    "insert" => {
                        if vals.is_empty() {
                            format!("INSERT INTO {name} DEFAULT VALUES")
                        } else {
                            format!(
                                "INSERT INTO {name} ({}) SELECT {}",
                                vals.keys()
                                    .map(|k| quote_ident(k, true))
                                    .collect::<Vec<_>>()
                                    .join(","),
                                vals.keys()
                                    .map(|k| expression(k, 1))
                                    .collect::<Vec<_>>()
                                    .join(",")
                            )
                        }
                    }
                    "update" => format!(
                        "UPDATE {name} SET {} WHERE {condition}",
                        vals.keys()
                            .map(|k| format!("{}={}", quote_ident(k, true), expression(k, 1)))
                            .collect::<Vec<_>>()
                            .join(",")
                    ),
                    _ => format!("DELETE FROM {name} WHERE {condition} AND $1::json IS NOT NULL"),
                };
                let mut q = sqlx::query(&sql);
                if !vals.is_empty() || op.kind != "insert" {
                    q = q.bind(sqlx::types::Json(&vals));
                }
                if op.kind != "insert" {
                    q = q.bind(sqlx::types::Json(&original));
                }
                if q.execute(&mut *tx)
                    .await
                    .map_err(db::error)?
                    .rows_affected()
                    != 1
                {
                    return Err("Row conflict: entire batch rolled back".into());
                }
            }
            tx.commit().await.map_err(db::error)?;
        }
        Pool::My(p) => {
            mutate_bound!(p, table, operations, &columns, false);
        }
        Pool::Sqlite(p) => {
            mutate_bound!(p, table, operations, &columns, true);
        }
    }
    Ok(operations.len())
}
// Parameters retain their database type for binary values; every other cell binds as text/NULL.
macro_rules! mutate_bound {
    ($pool:expr,$table:expr,$ops:expr,$columns:expr,$sqlite:expr) => {{
        let mut tx = $pool.begin().await.map_err(db::error)?;
        for op in $ops {
            let qid = |s: &str| quote_ident(s, $sqlite);
            let name = db::qualified($table, $sqlite);
            let condition = op
                .original
                .keys()
                .map(|k| {
                    let c = $columns.iter().find(|c| &c.name == k).unwrap();
                    if $sqlite {
                        format!("{} IS ?", projection(c, false, true))
                    } else {
                        format!(
                            "CAST({} AS BINARY) <=> CAST(? AS BINARY)",
                            projection(c, false, false)
                        )
                    }
                })
                .collect::<Vec<_>>()
                .join(" AND ");
            let sql = match op.kind.as_str() {
                "insert" => {
                    if op.values.is_empty() {
                        if $sqlite {
                            format!("INSERT INTO {name} DEFAULT VALUES")
                        } else {
                            format!("INSERT INTO {name} () VALUES ()")
                        }
                    } else {
                        format!(
                            "INSERT INTO {name} ({}) VALUES ({})",
                            op.values
                                .keys()
                                .map(|k| qid(k))
                                .collect::<Vec<_>>()
                                .join(","),
                            vec!["?"; op.values.len()].join(",")
                        )
                    }
                }
                "update" => format!(
                    "UPDATE {name} SET {} WHERE {condition}",
                    op.values
                        .keys()
                        .map(|k| format!("{}=?", qid(k)))
                        .collect::<Vec<_>>()
                        .join(",")
                ),
                _ => format!("DELETE FROM {name} WHERE {condition}"),
            };
            let mut query = sqlx::query(&sql);
            if op.kind != "delete" {
                for (key, value) in &op.values {
                    let c = $columns.iter().find(|c| &c.name == key).unwrap();
                    query = if binary(c) {
                        query.bind(decode_hex(value)?)
                    } else {
                        query.bind(value.as_str())
                    };
                }
            }
            if op.kind != "insert" {
                for value in op.original.values() {
                    query = query.bind(value.as_str());
                }
            }
            if query
                .execute(&mut *tx)
                .await
                .map_err(db::error)?
                .rows_affected()
                != 1
            {
                return Err("Row conflict: entire batch rolled back".into());
            }
        }
        tx.commit().await.map_err(db::error)?;
    }};
}
use mutate_bound;
#[tauri::command]
pub async fn data_mutate(
    state: tauri::State<'_, State>,
    id: String,
    table: Table,
    operations: Vec<Operation>,
) -> DbResult<usize> {
    db::ensure_writable(&state, &id).await?;
    if operations.len() > 10000 {
        return Err("Batch limit is 10,000 rows".into());
    }
    mutate(&db::pool(&state, &id).await?, &table, &operations).await
}
fn sql_literal(value: &str, pg: bool, mysql: bool) -> String {
    if mysql {
        format!(
            "CONVERT(X'{}' USING utf8mb4)",
            value
                .as_bytes()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        )
    } else if pg {
        format!("E'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
    } else {
        format!("'{}'", value.replace('\'', "''"))
    }
}
fn csv_cell(v: &Value) -> String {
    match v.as_str() {
        Some(s) => format!("\"{}\"", s.replace('"', "\"\"")),
        None => "\\N".into(),
    }
}
#[tauri::command]
pub async fn data_export(
    state: tauri::State<'_, State>,
    id: String,
    table: Table,
    format: String,
    mut request: PageRequest,
) -> DbResult<Option<String>> {
    if !["csv", "json", "sql"].contains(&format.as_str()) {
        return Err("Invalid export format".into());
    }
    let p = db::pool(&state, &id).await?;
    let path = rfd::AsyncFileDialog::new()
        .set_file_name(format!("{}.{}", table.name, format))
        .save_file()
        .await;
    let Some(path) = path else { return Ok(None) };
    let path = path.path().to_owned();
    let temp = path.with_extension(format!("{}.partial-{}", format, uuid::Uuid::new_v4()));
    let result: DbResult<()> = async {
        let mut file = std::fs::File::create(&temp).map_err(db::error)?;
        request.offset = 0;
        request.limit = 1000;
        let mut first = true;
        if format == "json" {
            file.write_all(b"[\n").map_err(db::error)?;
        }
        loop {
            let page = page(&p, &table, &request).await?;
            if first && format == "csv" {
                writeln!(
                    file,
                    "{}",
                    page.columns
                        .iter()
                        .map(|c| csv_cell(&Value::String(c.name.clone())))
                        .collect::<Vec<_>>()
                        .join(",")
                )
                .map_err(db::error)?;
            }
            for row in &page.rows {
                let text = match format.as_str() {
                    "json" => format!(
                        "{}{}",
                        if first { "" } else { ",\n" },
                        serde_json::to_string(row).map_err(db::error)?
                    ),
                    "csv" => format!(
                        "{}\r\n",
                        page.columns
                            .iter()
                            .map(|c| csv_cell(&row[&c.name]))
                            .collect::<Vec<_>>()
                            .join(",")
                    ),
                    _ => {
                        let pg = matches!(p, Pool::Pg(_) | Pool::Sqlite(_));
                        format!(
                            "INSERT INTO {} ({}) VALUES ({});\n",
                            db::qualified(&table, pg),
                            page.columns
                                .iter()
                                .map(|c| quote_ident(&c.name, pg))
                                .collect::<Vec<_>>()
                                .join(","),
                            page.columns
                                .iter()
                                .map(|c| {
                                    let v = &row[&c.name];
                                    if v.is_null() {
                                        "NULL".into()
                                    } else if binary(c) {
                                        let hex = v.as_str().unwrap().trim_start_matches("0x");
                                        if matches!(p, Pool::Pg(_)) {
                                            format!("decode('{hex}','hex')")
                                        } else {
                                            format!("X'{hex}'")
                                        }
                                    } else {
                                        sql_literal(
                                            v.as_str().unwrap(),
                                            matches!(p, Pool::Pg(_)),
                                            matches!(p, Pool::My(_)),
                                        )
                                    }
                                })
                                .collect::<Vec<_>>()
                                .join(",")
                        )
                    }
                };
                file.write_all(text.as_bytes()).map_err(db::error)?;
                first = false;
            }
            if !page.truncated {
                break;
            }
            request.offset += request.limit as u64;
        }
        if format == "json" {
            file.write_all(b"\n]\n").map_err(db::error)?;
        }
        file.sync_all().map_err(db::error)?;
        drop(file);
        std::fs::rename(&temp, &path).map_err(db::error)?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
#[tauri::command]
pub async fn data_copy(
    state: tauri::State<'_, State>,
    id: String,
    table: Table,
    target_id: String,
    target_table: Table,
    mut request: PageRequest,
) -> DbResult<usize> {
    db::ensure_writable(&state, &target_id).await?;
    if id == target_id && table.schema == target_table.schema && table.name == target_table.name {
        return Err("Choose a different destination table".into());
    }
    let source = db::pool(&state, &id).await?;
    let target = db::pool(&state, &target_id).await?;
    let dest = db::metadata(&target, &target_table).await?;
    request.offset = 0;
    request.limit = 1000;
    let mut operations = vec![];
    loop {
        let batch = page(&source, &table, &request).await?;
        if batch
            .columns
            .iter()
            .any(|c| !dest.iter().any(|d| d.name == c.name))
        {
            return Err("Destination must contain all source columns".into());
        }
        operations.extend(batch.rows.into_iter().map(|values| Operation {
            kind: "insert".into(),
            original: Row::new(),
            values,
        }));
        if operations.len() > 100000 {
            return Err(
                "Atomic table copy limit is 100,000 rows; use file export/import for larger tables"
                    .into(),
            );
        }
        if !batch.truncated {
            break;
        }
        request.offset += request.limit as u64;
    }
    if operations.is_empty() {
        return Ok(0);
    }
    mutate(&target, &target_table, &operations).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_literals_preserve_quotes_and_backslashes_independent_of_mysql_mode() {
        assert_eq!(
            sql_literal("a\\b'", false, true),
            "CONVERT(X'615c6227' USING utf8mb4)"
        );
        assert_eq!(sql_literal("a'", false, false), "'a'''");
        assert_eq!(sql_literal("a\\b", true, false), "E'a\\\\b'");
    }
    #[test]
    fn numeric_filters_use_numeric_comparison() {
        let request = PageRequest {
            offset: 0,
            limit: 10,
            filters: vec![Filter {
                column: "id".into(),
                operator: "gt".into(),
                value: "2".into(),
            }],
            order: vec![],
        };
        let (sql, _) = select_sql(
            &Table {
                schema: "main".into(),
                name: "t".into(),
            },
            &columns(),
            &request,
            false,
            true,
        )
        .unwrap();
        assert!(sql.contains("CAST(? AS NUMERIC)"));
    }
    fn columns() -> Vec<Column> {
        vec![
            Column {
                name: "id".into(),
                data_type: "INTEGER".into(),
                primary: true,
                editable: false,
            },
            Column {
                name: "name".into(),
                data_type: "TEXT".into(),
                primary: false,
                editable: true,
            },
        ]
    }
    #[test]
    fn filters_are_parameterized_and_identifiers_validated() {
        let table = Table {
            schema: "main".into(),
            name: "a\"b".into(),
        };
        let mut req = PageRequest {
            offset: 0,
            limit: 10,
            filters: vec![Filter {
                column: "name".into(),
                operator: "contains".into(),
                value: "a%' OR 1=1".into(),
            }],
            order: vec![],
        };
        let (sql, values) = select_sql(&table, &columns(), &req, true, false).unwrap();
        assert!(!sql.contains("OR 1=1"));
        assert!(sql.contains("\"a\"\"b\""));
        assert_eq!(values[0], "%a!%' OR 1=1%");
        req.filters[0].column = "unknown".into();
        assert!(select_sql(&table, &columns(), &req, true, false).is_err());
    }
    #[tokio::test]
    async fn sqlite_atomic_insert_update_delete_conflict() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT, data BLOB)")
            .execute(&pool)
            .await
            .unwrap();
        let p = Pool::Sqlite(pool);
        let t = Table {
            schema: "main".into(),
            name: "items".into(),
        };
        let insert = Operation {
            kind: "insert".into(),
            original: Row::new(),
            values: serde_json::from_value(serde_json::json!({"name":"old","data":"0x00ff"}))
                .unwrap(),
        };
        mutate(&p, &t, &[insert.clone()]).await.unwrap();
        let req = PageRequest {
            offset: 0,
            limit: 10,
            filters: vec![],
            order: vec![],
        };
        let rows = page(&p, &t, &req).await.unwrap().rows;
        assert_eq!(rows[0]["data"], "0x00FF");
        let update = Operation {
            kind: "update".into(),
            original: rows[0].clone(),
            values: serde_json::from_value(serde_json::json!({"name":"new"})).unwrap(),
        };
        assert!(mutate(&p, &t, &[update.clone(), update.clone()])
            .await
            .is_err());
        assert_eq!(page(&p, &t, &req).await.unwrap().rows[0]["name"], "old");
        mutate(&p, &t, &[update]).await.unwrap();
        let original = page(&p, &t, &req).await.unwrap().rows[0].clone();
        mutate(
            &p,
            &t,
            &[Operation {
                kind: "delete".into(),
                original,
                values: Row::new(),
            }],
        )
        .await
        .unwrap();
        assert!(page(&p, &t, &req).await.unwrap().rows.is_empty());
    }
}
