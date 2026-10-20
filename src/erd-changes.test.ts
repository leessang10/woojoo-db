import {describe,it,expect} from 'vitest';
import {mergeSchema,tableId} from './erd-model';
import {stageErd,rebaseErd,projectErd,type ErdChange} from './erd-changes';
const table={schema:'main',name:'notes'};
const create:ErdChange={id:'create',kind:'createTable',table,columns:[{name:'id',dataType:'integer',nullable:false,primary:true}]};
describe('ERD change staging',()=>{
 it('projects additions without modifying the baseline and keeps drafts when metadata is reloaded',()=>{
  const base={tables:[],foreignKeys:[]};let doc=stageErd(mergeSchema(base),create);
  doc=stageErd(doc,{id:'col',kind:'addColumn',table,column:{name:'body',dataType:'text',nullable:true,primary:false}});
  expect(base.tables).toHaveLength(0);expect(doc.schema.tables[0].columns.map(c=>c.name)).toEqual(['id','body']);
  doc.styles[tableId(table)].color='#112233';const restored=rebaseErd(base,JSON.parse(JSON.stringify(doc)));
  expect(restored.pending).toHaveLength(2);expect(restored.styles[tableId(table)].color).toBe('#112233');
  expect(rebaseErd(base,restored,[]).schema.tables).toHaveLength(0);
 });
 it('projects physical foreign keys and keeps virtual edges separate from DB operations',()=>{
  const doc=stageErd(mergeSchema({tables:[],foreignKeys:[]}),create);
  const fk:ErdChange={id:'fk',kind:'addForeignKey',table,name:'self_fk',columns:['id'],target:table,targetColumns:['id']};
  const next=stageErd(doc,fk);expect(next.schema.foreignKeys[0].id).toBe('fk');expect(next.relations[0].custom).toBe(false);
  const applied=projectErd(next.baseSchema!,next.pending!);expect(rebaseErd(applied,next,[]).pending).toEqual([]);
 });
});
