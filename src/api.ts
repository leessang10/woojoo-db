import { t } from './i18n';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ColumnDetail, Edit, Profile, Result, Row, Table, SchemaInfo, TableObjects, TableInfo } from './model';
import type { ErdSchema } from './erd-model';
import type { StructurePlan } from './structure';

export const desktop = isTauri();
const columns = [
  { name: 'id', dataType: 'int8', primary: true, editable: false },
  { name: 'name', dataType: 'varchar', primary: false, editable: true },
  { name: 'email', dataType: 'varchar', primary: false, editable: true },
  { name: 'role', dataType: 'varchar', primary: false, editable: true },
  { name: 'status', dataType: 'varchar', primary: false, editable: true },
  { name: 'created_at', dataType: 'timestamp', primary: false, editable: false },
];
const people = [
  ['Alex Morgan', 'alex.morgan', 'Admin', 'active'], ['Sofia Chen', 'sofia.chen', 'Editor', 'active'],
  ['James Park', 'james.park', 'Member', 'active'], ['Olivia Kim', 'olivia.kim', 'Member', 'pending'],
  ['Noah Williams', 'noah.w', 'Editor', 'active'], ['Emma Wilson', 'emma.wilson', 'Member', 'active'],
  ['Liam Davis', 'liam.davis', 'Member', 'inactive'], ['Isabella Lee', 'isabella.lee', 'Admin', 'active'],
  ['Lucas Brown', 'lucas.brown', 'Member', 'active'], ['Mia Johnson', 'mia.j', 'Editor', 'pending'],
  ['Ethan Miller', 'ethan.miller', 'Member', 'active'], ['Amelia Song', 'amelia.song', 'Member', 'active'],
];
let demoRows: Row[] = people.map((p, i) => ({ id: String(1001 + i), name: p[0], email: p[1] + '@woojoo.dev', role: p[2], status: p[3], created_at: `2026-10-${String(20 - i).padStart(2, '0')} 09:24:00` }));
const demoCatalog = new Map<string, {columns:ColumnDetail[];rows:Row[];info:TableInfo}>([['users', {
  columns:columns.map((column,index)=>({...column,nullable:!column.primary,defaultValue:null,charset:null,collation:['varchar'].includes(column.dataType)?'default':null,comment:'',extra:'',ordinal:index+1})),
  rows:demoRows,info:{schema:'public',name:'users',owner:'postgres',engine:'heap',charset:null,collation:null,estimatedRows:demoRows.length,sizeBytes:8192,comment:''}
}]]);
const wait = () => new Promise(r => setTimeout(r, 180));
export async function connect(profile: Profile): Promise<string> {
  if (!desktop) throw new Error(t('실제 DB 연결은 데스크톱 앱에서 지원합니다. npm run desktop으로 실행해 주세요.'));
  return invoke('connect_db', { profile });
}
export async function disconnect(id: string) { if (id !== 'demo') await invoke('disconnect_db', { id }); }
export async function tables(id: string): Promise<Table[]> {
  if (id === 'demo') return [...demoCatalog.keys()].map(name=>({schema:'public',name}));
  return invoke('list_tables', { id });
}
export async function readTable(id: string, table: Table): Promise<Result> {
  if (id === 'demo') { await wait(); const entry=demoCatalog.get(table.name); if(!entry || table.schema!=='public') throw new Error(t('테이블이 없습니다.')); return { columns:entry.columns, rows:structuredClone(entry.rows),elapsedMs:12,affected:0,truncated:false }; }
  return invoke('read_table', { id, table });
}
export async function describeTable(id: string, table: Table): Promise<ColumnDetail[]> {
  if (id === 'demo') {
    await wait();
    const entry=demoCatalog.get(table.name); if(!entry || table.schema!=='public') throw new Error(t('테이블이 없습니다.')); return structuredClone(entry.columns);
  }
  return invoke('describe_table', { id, table });
}
export async function schemaInfo(id: string, schema: string): Promise<SchemaInfo> {
  if(id==='demo') return {info:{name:schema,owner:'postgres',charset:'UTF8',collation:'C',comment:'',version:'Demo'},tables:[...demoCatalog.values()].map(entry=>({...entry.info,estimatedRows:entry.rows.length}))};
  return invoke('schema_info',{id,schema});
}
export async function tableInfo(id: string, table: Table): Promise<TableObjects> {
  if(id==='demo') {
    const primary=demoCatalog.get(table.name)?.columns.filter(c=>c.primary).map(c=>c.name) ?? [];
    return {indexes:primary.length?[{name:`${table.name}_pkey`,definition:`UNIQUE btree (${primary.join(', ')})`}]:[],constraints:primary.length?[{name:`${table.name}_pkey`,definition:`PRIMARY KEY (${primary.join(', ')})`}]:[]};
  }
  return invoke('table_info',{id,table});
}
export async function applyStructure(id: string, plan: StructurePlan) {
  if(id!=='demo') return invoke<void>('execute_ddl',{id,sqls:plan.sqls,table:plan.change.kind==='createTable'?null:plan.change.table,expectedColumns:plan.expectedColumns??null});
  const {change}=plan, entry=demoCatalog.get(change.table.name);
  if(change.kind!=='createTable' && (!entry || JSON.stringify(entry.columns)!==JSON.stringify(plan.expectedColumns))) throw new Error(t('테이블 구조가 변경되었습니다. 새로고침한 뒤 다시 검토하세요.'));
  const toColumn=(draft:typeof change.columns[number],index:number,old?:ColumnDetail):ColumnDetail=>({
    name:draft.name,dataType:draft.dataType,nullable:draft.primary?false:draft.nullable,primary:draft.primary,editable:!draft.primary,
    defaultValue:draft.defaultMode==='keep'?old?.defaultValue??null:draft.defaultMode==='none'?null:draft.defaultValue,
    charset:draft.charset||null,collation:draft.collation||null,comment:draft.comment,extra:old?.extra??'',ordinal:index+1,
  });
  if(change.kind==='createTable') {
    if(demoCatalog.has(change.table.name)) throw new Error(t('같은 이름의 테이블이 있습니다.'));
    demoCatalog.set(change.table.name,{columns:change.columns.map((column,index)=>toColumn(column,index)),rows:[],info:{...change.table,owner:'postgres',engine:'heap',comment:change.comment,sizeBytes:0}});
  } else if(change.kind==='dropTable') demoCatalog.delete(change.table.name);
  else if(entry && change.kind==='alterTable') {
    if(change.name!==change.table.name && demoCatalog.has(change.name)) throw new Error(t('같은 이름의 테이블이 있습니다.'));
    demoCatalog.delete(change.table.name);entry.info={...entry.info,name:change.name,comment:change.comment};demoCatalog.set(change.name,entry);
  } else if(entry && change.kind==='addColumn') {
    const draft=change.columns[0];
    if(entry.columns.some(column=>column.name===draft.name)) throw new Error(t('컬럼 이름이 중복됩니다.'));
    if(!draft.nullable && entry.rows.length && draft.defaultMode==='none') throw new Error(t('기존 행에 적용할 기본값이 필요합니다.'));
    entry.columns.push(toColumn(draft,entry.columns.length));
    for(const row of entry.rows) row[draft.name]=draft.defaultMode==='literal'?draft.defaultValue:null;
  } else if(entry && change.kind==='dropColumn') {
    entry.columns=entry.columns.filter(column=>column.name!==change.original!.name);
    for(const row of entry.rows) delete row[change.original!.name];
  } else if(entry && change.kind==='alterColumn') {
    const old=change.original!,draft=change.columns[0];
    if(draft.name!==old.name && entry.columns.some(column=>column.name===draft.name)) throw new Error(t('컬럼 이름이 중복됩니다.'));
    if(!draft.nullable && entry.rows.some(row=>row[old.name]===null)) throw new Error(t('NULL 값이 있어 NOT NULL로 변경할 수 없습니다.'));
    entry.columns=entry.columns.map((column,index)=>column.name===old.name?toColumn(draft,index,old):column);
    if(draft.name!==old.name) for(const row of entry.rows) {row[draft.name]=row[old.name];delete row[old.name];}
  }
}
export async function readErd(id: string, schema: string): Promise<ErdSchema> {
  if (id === 'demo') {
    await wait();
    return { tables: schema === 'public' ? [...demoCatalog.entries()].map(([name,entry])=>({table:{schema:'public',name},columns:entry.columns})) : [], foreignKeys: [] };
  }
  return invoke('read_erd', { id, schema });
}
export async function query(id: string, sql: string): Promise<Result> {
  if (id === 'demo') {
    await wait();
    const match = sql.match(/^\s*select\s+\*\s+from\s+(?:(?:"?public"?|`public`)\.)?(?:"((?:[^"]|"")+)"|`((?:[^`]|``)+)`|([a-z_][a-z0-9_]*))(?:\s+limit\s+\d+)?\s*;?\s*$/i);
    if (!match) throw new Error(t('데모는 SELECT * 미리보기만 지원합니다. 자유 SQL은 실제 DB 연결 후 실행하세요.'));
    const name = match[1]?.replaceAll('""','"') ?? match[2]?.replaceAll('``','`') ?? match[3];
    const result = await readTable(id, {schema:'public', name});
    const limit = sql.match(/\blimit\s+(\d+)\s*;?\s*$/i);
    return { ...result, rows: limit ? result.rows.slice(0, Number(limit[1])) : result.rows, columns: result.columns.map(c => ({...c, editable:false})) };
  }
  return invoke('run_query', { id, sql });
}
export async function save(id: string, table: Table, edits: Edit[]) {
  if (id === 'demo') {
    await wait();
    const entry=demoCatalog.get(table.name); if(!entry) throw new Error(t('테이블이 없습니다.'));
    entry.rows = entry.rows.map(row => {
      const edit = edits.find(e => e.original.id === row.id);
      return edit ? { ...row, ...edit.changes } : row;
    });
    return edits.length;
  }
  return invoke<number>('apply_edits', { id, table, edits });
}
