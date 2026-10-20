import { invoke } from '@tauri-apps/api/core';
import { demoCatalog } from './api';
import type { Column, Engine, Result, Row, Table } from './model';
export type DataFilter = { column: string; operator: 'eq'|'ne'|'contains'|'gt'|'lt'|'null'|'notNull'; value: string };
export type PageRequest = { offset: number; limit: number; filters: DataFilter[]; order: {column:string;descending:boolean}[] };
export type DataOperation = { kind:'insert'|'update'|'delete'; original:Row; values:Row };
export type CopyTarget = {session:string;label:string;table:Table;engine:Engine};
export const emptyRequest:PageRequest={offset:0,limit:100,filters:[],order:[]};
export const quoteIdentifier=(name:string,engine:Engine)=>engine==='mysql'||engine==='mariadb'?`\`${name.replaceAll('`','``')}\``:`"${name.replaceAll('"','""')}"`;
export const tableName=(table:Table,engine:Engine)=>`${quoteIdentifier(table.schema,engine)}.${quoteIdentifier(table.name,engine)}`;
export function operationPreview(table:Table,engine:Engine,operations:DataOperation[]) {
  const q=(s:string)=>quoteIdentifier(s,engine), literal=(v:string|null)=>v===null?'NULL':`'${v.replaceAll("'","''")}'`;
  return operations.map(op=>{
    if(op.kind==='insert') return Object.keys(op.values).length?`INSERT INTO ${tableName(table,engine)} (${Object.keys(op.values).map(q).join(', ')}) VALUES (${Object.values(op.values).map(literal).join(', ')});`:`INSERT INTO ${tableName(table,engine)} DEFAULT VALUES;`;
    const where=Object.entries(op.original).map(([k,v])=>`${q(k)} ${v===null?'IS NULL':`= ${literal(v)}`}`).join(' AND ');
    return `${op.kind==='delete'?'DELETE FROM': 'UPDATE'} ${tableName(table,engine)}${op.kind==='update'?` SET ${Object.entries(op.values).map(([k,v])=>`${q(k)} = ${literal(v)}`).join(', ')}`:''} WHERE ${where};`;
  }).join('\n');
}
// RFC 4180 quoting; an unquoted \\N means NULL while "\\N" remains literal text.
export function parseDelimited(text:string,delimiter=','): (string|null)[][] {
  const rows:(string|null)[][]=[]; let row:(string|null)[]=[],value='',quoted=false,wasQuoted=false,closed=false;
  const field=()=>{row.push(!wasQuoted&&value==='\\N'?null:value);value='';wasQuoted=false;closed=false;};
  for(let i=0;i<text.length;i++) {const c=text[i];
    if(quoted) {if(c==='"') {if(text[i+1]==='"'){value+='"';i++;} else {quoted=false;closed=true;}} else value+=c;continue;}
    if(c==='"'&&!value&&!closed){quoted=true;wasQuoted=true;continue;}
    if(c===delimiter){field();continue;}
    if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;field();rows.push(row);row=[];continue;}
    if(closed)throw new Error('Unexpected text after a closing quote');
    if(c==='"')throw new Error('Quote inside an unquoted field');value+=c;
  }
  if(quoted)throw new Error('Unterminated quoted field');
  if(value||wasQuoted||row.length){field();rows.push(row);} return rows;
}
export function serializeDelimited(columns:string[],rows:Row[],delimiter=',') {const quote=(v:string|null)=>v===null?'\\N':`"${v.replaceAll('"','""')}"`;return [columns.map(quote).join(delimiter),...rows.map(row=>columns.map(c=>quote(row[c]??null)).join(delimiter))].join('\r\n');}
export function importOperations(rows:(string|null)[][],mapping:string[],columns:Column[]):DataOperation[]{
  const used=mapping.filter(Boolean);if(new Set(used).size!==used.length)throw new Error('Duplicate target column');
  if(!used.length)throw new Error('Select at least one target column');
  if(used.some(name=>!columns.some(c=>c.name===name)))throw new Error('Unknown target column');
  return rows.map(row=>{if(row.length!==mapping.length)throw new Error('CSV field count does not match header');return {kind:'insert',original:{},values:Object.fromEntries(mapping.flatMap((column,i)=>column?[[column,row[i]]]:[]))};});
}
function demoEntry(table:Table){const entry=demoCatalog.get(table.name);if(!entry||table.schema!=='public')throw new Error('Demo table not found');return entry;}
function filtered(rows:Row[],request:PageRequest){return rows.filter(row=>request.filters.every(f=>{const v=row[f.column];switch(f.operator){case 'null':return v===null;case 'notNull':return v!==null;case 'contains':return v?.includes(f.value);case 'eq':return v===f.value;case 'ne':return v!==null&&v!==f.value;case 'gt':return v!==null&&v>f.value;case 'lt':return v!==null&&v<f.value;}})).sort((a,b)=>{for(const o of request.order){const c=(a[o.column]??'').localeCompare(b[o.column]??'',undefined,{numeric:true});if(c)return o.descending?-c:c;}return 0;});}
export async function dataPage(id:string,table:Table,request:PageRequest):Promise<Result>{if(id!=='demo')return invoke('data_page',{id,table,request});const e=demoEntry(table),rows=filtered(structuredClone(e.rows),request);return {columns:e.columns,rows:rows.slice(request.offset,request.offset+request.limit),elapsedMs:0,affected:0,truncated:rows.length>request.offset+request.limit};}
export async function dataMutate(id:string,table:Table,operations:DataOperation[]):Promise<number>{
  if(id!=='demo')return invoke('data_mutate',{id,table,operations});const entry=demoEntry(table),rows=structuredClone(entry.rows),keys=entry.columns.filter(c=>c.primary).map(c=>c.name);
  for(const op of operations){if(op.kind==='insert'){const row:Row=Object.fromEntries(entry.columns.map(c=>[c.name,Object.hasOwn(op.values,c.name)?op.values[c.name]:c.defaultValue??null]));for(const key of keys)if(row[key]===null&&/int/i.test(entry.columns.find(c=>c.name===key)!.dataType))row[key]=String(Math.max(0,...rows.map(r=>Number(r[key])||0))+1);if(keys.length&&rows.some(r=>keys.every(k=>r[k]===row[k])))throw new Error('Duplicate primary key');rows.push(row);}else{if(!keys.length)throw new Error('A primary key is required');const index=rows.findIndex(r=>keys.every(k=>r[k]===op.original[k])&&Object.entries(op.original).every(([k,v])=>r[k]===v));if(index<0)throw new Error('Row conflict; no changes applied');if(op.kind==='delete')rows.splice(index,1);else rows[index]={...rows[index],...op.values};}}
  entry.rows=rows;return operations.length;
}
export async function dataExport(id:string,table:Table,format:'csv'|'json'|'sql',request:PageRequest,engine:Engine){if(id!=='demo')return invoke<string|null>('data_export',{id,table,format,request});const entry=demoEntry(table),rows=filtered(structuredClone(entry.rows),request);const content=format==='json'?JSON.stringify(rows,null,2):format==='csv'?serializeDelimited(entry.columns.map(c=>c.name),rows):operationPreview(table,engine,rows.map(values=>({kind:'insert',original:{},values})));const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${table.name}.${format}`;a.click();URL.revokeObjectURL(url);return a.download;}
export async function dataCopy(id:string,table:Table,target:CopyTarget,request:PageRequest){if(id==='demo'&&target.session==='demo'){if(table.name===target.table.name)throw new Error('Choose a different target table');return dataMutate('demo',target.table,filtered(structuredClone(demoEntry(table).rows),request).map(values=>({kind:'insert',original:{},values})));}if(id==='demo'||target.session==='demo')throw new Error('Demo and live connections cannot be mixed');return invoke<number>('data_copy',{id,table,targetId:target.session,targetTable:target.table,request});}
