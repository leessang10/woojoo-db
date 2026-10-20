import type { Table } from './model';
import type { ErdDocument, ErdSchema } from './erd-model';
import { mergeSchema, tableId } from './erd-model';
export type ErdColumnDraft={name:string;dataType:string;nullable:boolean;primary:boolean;defaultValue?:string|null};
export type ErdChange=({kind:'createTable';table:Table;columns:ErdColumnDraft[]}|{kind:'addColumn';table:Table;column:ErdColumnDraft}|{kind:'addIndex';table:Table;name:string;columns:string[];unique:boolean}|{kind:'addForeignKey';table:Table;name:string;columns:string[];target:Table;targetColumns:string[];onDelete?:string;onUpdate?:string})&{id:string};
export type ErdPlan={sqls:string[];expectedSnapshot:string;transactional:boolean;warnings:string[]};
export type ErdApplyResult={completed:number;total:number;error:string|null;transactional:boolean};
export function projectErd(base:ErdSchema,changes:ErdChange[]):ErdSchema {
 const schema:ErdSchema={tables:base.tables.map(t=>({...t,columns:[...t.columns]})),foreignKeys:[...base.foreignKeys]};
 for(const change of changes){
  const table=schema.tables.find(t=>tableId(t.table)===tableId(change.table));
  if(change.kind==='createTable') {if(!table)schema.tables.push({table:change.table,columns:change.columns.map(c=>({...c,editable:!c.primary}))});}
  if(change.kind==='addColumn'&&table&&!table.columns.some(c=>c.name===change.column.name)) table.columns.push({...change.column,editable:!change.column.primary});
  if(change.kind==='addForeignKey'&&!schema.foreignKeys.some(f=>f.id===change.id))schema.foreignKeys.push({id:change.id,name:change.name,source:change.table,target:change.target,sourceColumns:change.columns,targetColumns:change.targetColumns});
 }
 return schema;
}
export function rebaseErd(base:ErdSchema,old:ErdDocument|null,changes:ErdChange[]=old?.pending??[]):ErdDocument {
 return {...mergeSchema(projectErd(base,changes),old),baseSchema:base,pending:changes};
}
export function stageErd(document:ErdDocument,change:ErdChange):ErdDocument {
 return rebaseErd(document.baseSchema??document.schema,document,[...(document.pending??[]),change]);
}
