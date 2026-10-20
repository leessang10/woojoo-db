use crate::db::{pool, Pool, State, Table};
use serde_json::{json, Value};
use sqlx::{types::Json, Row};

async fn objects(p: &Pool, pg: &str, my: &str, params: &[&str]) -> Result<Vec<Value>, String> {
    match p {
        Pool::Sqlite(_) => Err("SQLite metadata query unsupported".into()),
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
    if let Pool::Sqlite(p) = p {
        return sqlx::query("SELECT name,type,pk,\"notnull\",dflt_value,hidden,cid FROM pragma_table_xinfo(?,?) ORDER BY cid").bind(&table.name).bind(&table.schema).fetch_all(p).await.map_err(|e|e.to_string())?.into_iter().map(|r| Ok(json!({"name":r.get::<String,_>(0),"dataType":r.get::<String,_>(1),"primary":r.get::<i64,_>(2)!=0,"nullable":r.get::<i64,_>(3)==0,"defaultValue":r.get::<Option<String>,_>(4),"extra":if r.get::<i64,_>(5)>0 {"generated"}else{""},"ordinal":r.get::<i64,_>(6)+1,"editable":false,"charset":null,"collation":null,"comment":""}))).collect();
    }
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
    if let Pool::Sqlite(p) = &p {
        let version: String = sqlx::query_scalar("SELECT sqlite_version()")
            .fetch_one(p)
            .await
            .map_err(|e| e.to_string())?;
        let tables=sqlx::query("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetch_all(p).await.map_err(|e|e.to_string())?.iter().map(|r|json!({"schema":"main","name":r.get::<String,_>(0),"owner":null,"engine":"SQLite","charset":"UTF-8","collation":null,"estimatedRows":null,"sizeBytes":null,"comment":"","createdAt":null})).collect::<Vec<_>>();
        return Ok(
            json!({"info":{"name":"main","owner":null,"charset":"UTF-8","collation":null,"comment":"","version":version},"tables":tables}),
        );
    }
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
    if let Pool::Sqlite(p) = &p {
        let indexes=sqlx::query("SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name=? ORDER BY name").bind(&table.name).fetch_all(p).await.map_err(|e|e.to_string())?.iter().map(|r|json!({"name":r.get::<String,_>(0),"definition":r.get::<Option<String>,_>(1).unwrap_or("Automatic unique/primary key index".into())})).collect::<Vec<_>>();
        let ddl: Option<String> =
            sqlx::query_scalar("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
                .bind(&table.name)
                .fetch_optional(p)
                .await
                .map_err(|e| e.to_string())?;
        return Ok(
            json!({"indexes":indexes,"constraints":[{"name":"Table definition (includes constraints)","definition":ddl.unwrap_or_default()}]}),
        );
    }
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
    app: tauri::AppHandle,
    store: tauri::State<'_, crate::journal::Journal>,
    state: tauri::State<'_, State>,
    id: String,
    sqls: Vec<String>,
    table: Option<Table>,
    expected_columns: Option<Vec<Value>>,
) -> Result<(), String> {
    let script=sqls.join(";\n");
    crate::journal::record(&app, &store, &state, &id, &script, "structure", async {
    crate::db::ensure_writable(&state, &id).await?;
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
        Pool::Sqlite(p) => {
            let mut tx = p.begin().await.map_err(|e| e.to_string())?;
            for sql in sqls {
                sqlx::query(&sql)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            tx.commit().await.map_err(|e| e.to_string())?;
        }
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
    }).await
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct DbObject {
    pub schema: String,
    pub name: String,
    pub kind: String,
    pub identity: Option<String>,
}
#[tauri::command]
pub async fn object_list(
    state: tauri::State<'_, State>,
    id: String,
    schema: String,
) -> Result<Vec<DbObject>, String> {
    let p = pool(&state, &id).await?;
    let rows:Vec<(String,String,Option<String>)>=match p {
        Pool::Sqlite(p)=>sqlx::query("SELECT name,type FROM sqlite_schema WHERE type IN ('view','trigger') ORDER BY type,name").fetch_all(&p).await.map_err(crate::db::error)?.into_iter().map(|r|Ok((r.try_get(0).map_err(crate::db::error)?,r.try_get(1).map_err(crate::db::error)?,None))).collect::<Result<_,String>>()?,
        Pool::Pg(p)=>sqlx::query("SELECT c.relname::text,'view'::text,c.oid::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('v','m') UNION ALL SELECT p.proname::text,CASE WHEN p.prokind='p' THEN 'procedure' ELSE 'function' END,p.oid::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind IN ('f','p') UNION ALL SELECT t.tgname::text,'trigger',t.oid::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY 2,1").bind(&schema).fetch_all(&p).await.map_err(crate::db::error)?.into_iter().map(|r|Ok((r.try_get(0).map_err(crate::db::error)?,r.try_get(1).map_err(crate::db::error)?,r.try_get(2).map_err(crate::db::error)?))).collect::<Result<_,String>>()?,
        Pool::My(p)=>sqlx::query("SELECT TABLE_NAME,'view',NULL FROM information_schema.VIEWS WHERE TABLE_SCHEMA=? UNION ALL SELECT ROUTINE_NAME,LOWER(ROUTINE_TYPE),NULL FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=? UNION ALL SELECT TRIGGER_NAME,'trigger',NULL FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? ORDER BY 2,1").bind(&schema).bind(&schema).bind(&schema).fetch_all(&p).await.map_err(crate::db::error)?.into_iter().map(|r|Ok((r.try_get_unchecked(0).map_err(crate::db::error)?,r.try_get_unchecked(1).map_err(crate::db::error)?,None))).collect::<Result<_,String>>()?,
    };
    Ok(rows
        .into_iter()
        .map(|(name, kind, identity)| DbObject {
            schema: schema.clone(),
            name,
            kind,
            identity,
        })
        .collect())
}
#[tauri::command]
pub async fn object_definition(
    state: tauri::State<'_, State>,
    id: String,
    object: DbObject,
) -> Result<String, String> {
    let p = pool(&state, &id).await?;
    match p {
        Pool::Sqlite(p) => {
            sqlx::query_scalar::<_, String>("SELECT sql FROM sqlite_schema WHERE name=? AND type=?")
                .bind(&object.name)
                .bind(&object.kind)
                .fetch_one(&p)
                .await
                .map_err(crate::db::error)
        }
        Pool::Pg(p) => {
            let oid = object
                .identity
                .ok_or("Missing object identity")?
                .parse::<i64>()
                .map_err(crate::db::error)?;
            let sql=match object.kind.as_str(){"view"=>"SELECT CASE WHEN relkind='m' THEN 'CREATE MATERIALIZED VIEW ' ELSE 'CREATE OR REPLACE VIEW ' END || quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' AS '||pg_get_viewdef(c.oid,true)||';' FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=$1::bigint::oid", "function"|"procedure"=>"SELECT pg_get_functiondef($1::bigint::oid)","trigger"=>"SELECT pg_get_triggerdef($1::bigint::oid,true)||';'",_=>return Err("Unsupported object kind".into())};
            sqlx::query_scalar(sql)
                .bind(oid)
                .fetch_one(&p)
                .await
                .map_err(crate::db::error)
        }
        Pool::My(p) => {
            let kind = match object.kind.as_str() {
                "view" => "VIEW",
                "function" => "FUNCTION",
                "procedure" => "PROCEDURE",
                "trigger" => "TRIGGER",
                _ => return Err("Unsupported object kind".into()),
            };
            let q = format!(
                "SHOW CREATE {kind} {}.{}",
                crate::plan::quote_ident(&object.schema, false),
                crate::plan::quote_ident(&object.name, false)
            );
            let r = sqlx::query(&q)
                .fetch_one(&p)
                .await
                .map_err(crate::db::error)?;
            let index = if kind == "VIEW" { 1 } else { 2 };
            r.try_get_unchecked(index).map_err(crate::db::error)
        }
    }
}
#[tauri::command]
pub async fn table_ddl(
    state: tauri::State<'_, State>,
    id: String,
    table: Table,
) -> Result<String, String> {
    let p = pool(&state, &id).await?;
    match p {
        Pool::Sqlite(p) => {
            let rows=sqlx::query_scalar::<_,String>("SELECT sql FROM sqlite_schema WHERE tbl_name=? AND sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name").bind(&table.name).fetch_all(&p).await.map_err(crate::db::error)?;
            if rows.is_empty() {
                return Err("Table not found".into());
            }
            Ok(rows
                .into_iter()
                .map(|s| format!("{};", s.trim_end_matches(';')))
                .collect::<Vec<_>>()
                .join("\n\n"))
        }
        Pool::My(p) => {
            let r = sqlx::query(&format!(
                "SHOW CREATE TABLE {}",
                crate::db::qualified(&table, false)
            ))
            .fetch_one(&p)
            .await
            .map_err(crate::db::error)?;
            r.try_get_unchecked(1).map_err(crate::db::error)
        }
        Pool::Pg(p) => {
            let table_name = crate::db::qualified(&table, true);
            let relation=sqlx::query("SELECT c.oid::bigint,c.relkind::text,c.relispartition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2").bind(&table.schema).bind(&table.name).fetch_one(&p).await.map_err(crate::db::error)?;
            if relation.get::<String, _>(1) != "r" || relation.get::<bool, _>(2) {
                return Err(
                    "Partitioned/foreign tables require pg_dump --schema-only for complete DDL."
                        .into(),
                );
            }
            let oid: i64 = relation.get(0);
            let defs=sqlx::query_scalar::<_,String>("SELECT quote_ident(a.attname)||' '||format_type(a.atttypid,a.atttypmod)||CASE WHEN a.attcollation<>t.typcollation THEN ' COLLATE '||a.attcollation::regcollation::text ELSE '' END||CASE WHEN a.attgenerated<>'' THEN ' GENERATED ALWAYS AS ('||pg_get_expr(d.adbin,d.adrelid)||') STORED' WHEN a.attidentity='a' THEN ' GENERATED ALWAYS AS IDENTITY' WHEN a.attidentity='d' THEN ' GENERATED BY DEFAULT AS IDENTITY' WHEN d.adbin IS NOT NULL THEN ' DEFAULT '||pg_get_expr(d.adbin,d.adrelid) ELSE '' END||CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::bigint::oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum").bind(oid).fetch_all(&p).await.map_err(crate::db::error)?;
            let constraints=sqlx::query_scalar::<_,String>("SELECT 'CONSTRAINT '||quote_ident(conname)||' '||pg_get_constraintdef(oid,true) FROM pg_constraint WHERE conrelid=$1::bigint::oid ORDER BY conname").bind(oid).fetch_all(&p).await.map_err(crate::db::error)?;
            let indexes=sqlx::query_scalar::<_,String>("SELECT pg_get_indexdef(i.indexrelid)||';' FROM pg_index i WHERE i.indrelid=$1::bigint::oid AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid) ORDER BY i.indexrelid").bind(oid).fetch_all(&p).await.map_err(crate::db::error)?;
            let triggers=sqlx::query_scalar::<_,String>("SELECT pg_get_triggerdef(oid,true)||';' FROM pg_trigger WHERE tgrelid=$1::bigint::oid AND NOT tgisinternal ORDER BY tgname").bind(oid).fetch_all(&p).await.map_err(crate::db::error)?;
            Ok(format!("-- Reconstructed table DDL. Use pg_dump for sequences, grants, policies, storage and dependent objects.\nCREATE TABLE {table_name} (\n  {}\n);\n\n{}\n{}",defs.into_iter().chain(constraints).collect::<Vec<_>>().join(",\n  "),indexes.join("\n"),triggers.join("\n")))
        }
    }
}
