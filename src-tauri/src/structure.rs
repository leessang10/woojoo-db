use crate::db::{pool, Pool, State, Table};
use serde_json::{json, Value};
use sqlx::{types::Json, Row};

async fn objects(p: &Pool, pg: &str, my: &str, params: &[&str]) -> Result<Vec<Value>, String> {
    match p {
        Pool::Pg(p) => {
            let mut query = sqlx::query(pg);
            for value in params {
                query = query.bind(*value);
            }
            query
                .fetch_all(p)
                .await
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|row| {
                    row.try_get::<Json<Value>, _>(0)
                        .map(|v| v.0)
                        .map_err(|e| e.to_string())
                })
                .collect()
        }
        Pool::My(p) => {
            let mut query = sqlx::query(my);
            for value in params {
                query = query.bind(*value);
            }
            query
                .fetch_all(p)
                .await
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|row| {
                    let text: String = row.try_get_unchecked(0).map_err(|e| e.to_string())?;
                    serde_json::from_str(&text).map_err(|e| e.to_string())
                })
                .collect()
        }
    }
}

pub(crate) async fn columns(p: &Pool, table: &Table) -> Result<Vec<Value>, String> {
    let mut rows = objects(p,
        "SELECT jsonb_build_object('name',a.attname,'dataType',format_type(a.atttypid,a.atttypmod),
        'primary',EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary AND a.attnum=ANY(i.indkey)),
        'editable',false,'nullable',NOT a.attnotnull,'defaultValue',pg_get_expr(d.adbin,d.adrelid),
        'charset',NULL,'collation',co.collname,'comment',coalesce(col_description(c.oid,a.attnum),''),
        'extra',CASE WHEN a.attidentity<>'' THEN 'identity' WHEN a.attgenerated<>'' THEN 'generated' ELSE '' END,'ordinal',a.attnum)
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation
        WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
        "SELECT CAST(JSON_OBJECT('name',COLUMN_NAME,'dataType',COLUMN_TYPE,'primary',COLUMN_KEY='PRI','editable',false,
        'nullable',IS_NULLABLE='YES','defaultValue',COLUMN_DEFAULT,'charset',CHARACTER_SET_NAME,'collation',COLLATION_NAME,
        'comment',COLUMN_COMMENT,'extra',EXTRA,'ordinal',ORDINAL_POSITION) AS CHAR)
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
        &[&table.schema,&table.name]).await?;
    // MySQL's JSON_OBJECT encodes comparison expressions as 0/1 rather than JSON booleans.
    for row in &mut rows {
        for key in ["primary", "nullable", "editable"] {
            if let Some(value) = row[key].as_i64() {
                row[key] = json!(value != 0);
            }
        }
    }
    if rows.is_empty() {
        return Err("테이블이 없거나 메타데이터 조회 권한이 없습니다.".into());
    }
    Ok(rows)
}

#[tauri::command]
pub async fn schema_info(
    state: tauri::State<'_, State>,
    id: String,
    schema: String,
) -> Result<Value, String> {
    let p = pool(&state, &id).await?;
    let info=objects(&p,
        "SELECT jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'charset',pg_encoding_to_char(d.encoding),'collation',d.datcollate,'comment',coalesce(obj_description(n.oid,'pg_namespace'),''),'version',version())
        FROM pg_namespace n CROSS JOIN pg_database d WHERE n.nspname=$1 AND d.datname=current_database()",
        "SELECT CAST(JSON_OBJECT('name',SCHEMA_NAME,'owner',NULL,'charset',DEFAULT_CHARACTER_SET_NAME,'collation',DEFAULT_COLLATION_NAME,'comment','','version',VERSION()) AS CHAR)
        FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", &[&schema]).await?;
    let tables=objects(&p,
        "SELECT jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'engine',am.amname,
        'charset',NULL,'collation',NULL,'estimatedRows',CASE WHEN c.reltuples<0 THEN NULL ELSE c.reltuples::bigint END,
        'sizeBytes',pg_total_relation_size(c.oid),'comment',coalesce(obj_description(c.oid,'pg_class'),''),'createdAt',NULL)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_am am ON am.oid=c.relam
        WHERE n.nspname=$1 AND c.relkind IN ('r','p') ORDER BY c.relname",
        "SELECT CAST(JSON_OBJECT('schema',t.TABLE_SCHEMA,'name',t.TABLE_NAME,'owner',NULL,'engine',t.ENGINE,
        'charset',a.CHARACTER_SET_NAME,'collation',t.TABLE_COLLATION,'estimatedRows',t.TABLE_ROWS,
        'sizeBytes',coalesce(t.DATA_LENGTH,0)+coalesce(t.INDEX_LENGTH,0),'comment',t.TABLE_COMMENT,'createdAt',CAST(t.CREATE_TIME AS CHAR)) AS CHAR)
        FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY a ON a.COLLATION_NAME=t.TABLE_COLLATION
        WHERE t.TABLE_SCHEMA=? AND t.TABLE_TYPE='BASE TABLE' ORDER BY t.TABLE_NAME", &[&schema]).await?;
    Ok(json!({"info":info.first().ok_or("스키마가 없거나 조회 권한이 없습니다.")?,"tables":tables}))
}

#[tauri::command]
pub async fn table_info(
    state: tauri::State<'_, State>,
    id: String,
    table: Table,
) -> Result<Value, String> {
    let p = pool(&state, &id).await?;
    let indexes=objects(&p,
        "SELECT jsonb_build_object('name',indexname,'definition',indexdef) FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 ORDER BY indexname",
        "SELECT CAST(JSON_OBJECT('name',INDEX_NAME,'definition',CONCAT(IF(MIN(NON_UNIQUE)=0,'UNIQUE ',''),MAX(INDEX_TYPE),' (',GROUP_CONCAT(COALESCE(COLUMN_NAME,'<expression>') ORDER BY SEQ_IN_INDEX SEPARATOR ', '),')')) AS CHAR)
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? GROUP BY INDEX_NAME ORDER BY INDEX_NAME", &[&table.schema,&table.name]).await?;
    let constraints=objects(&p,
        "SELECT jsonb_build_object('name',con.conname,'definition',pg_get_constraintdef(con.oid)) FROM pg_constraint con
        JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=$1 AND c.relname=$2 ORDER BY con.conname",
        "SELECT CAST(JSON_OBJECT('name',CONSTRAINT_NAME,'definition',CONSTRAINT_TYPE) AS CHAR)
        FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY CONSTRAINT_NAME", &[&table.schema,&table.name]).await?;
    Ok(json!({"indexes":indexes,"constraints":constraints}))
}

#[tauri::command]
pub async fn execute_ddl(
    state: tauri::State<'_, State>,
    id: String,
    sqls: Vec<String>,
    table: Option<Table>,
    expected_columns: Option<Vec<Value>>,
) -> Result<(), String> {
    if sqls.is_empty() || sqls.len() > 32 || sqls.iter().any(|sql| sql.len() > 100_000) {
        return Err("잘못된 구조 변경 요청입니다.".into());
    }
    let p = pool(&state, &id).await?;
    if let (Some(table), Some(expected)) = (&table, &expected_columns) {
        if &columns(&p, table).await? != expected {
            return Err("테이블 구조가 변경되었습니다. 새로고침한 뒤 다시 검토하세요.".into());
        }
    }
    match p {
        Pool::Pg(p) => {
            let mut tx = p.begin().await.map_err(|e| e.to_string())?;
            sqlx::query("SET LOCAL standard_conforming_strings = on")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query("SET LOCAL lock_timeout = '5s'")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            for sql in sqls {
                sqlx::query(&sql)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            tx.commit().await.map_err(|e| e.to_string())?;
        }
        Pool::My(p) => {
            if sqls.len() != 1 {
                return Err("MySQL 구조 변경은 한 문장씩 적용해야 합니다.".into());
            }
            let mut conn = p.acquire().await.map_err(|e| e.to_string())?;
            conn.close_on_drop();
            sqlx::query("SET SESSION sql_mode=CONCAT_WS(',',@@SESSION.sql_mode,'NO_BACKSLASH_ESCAPES','STRICT_ALL_TABLES')").execute(&mut *conn).await.map_err(|e|e.to_string())?;
            sqlx::query("SET SESSION lock_wait_timeout=5")
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query(&sqls[0])
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
