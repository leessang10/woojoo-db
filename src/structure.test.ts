import {describe,it,expect} from 'vitest';
import {columnDraft,planStructure,type StructureChange} from './structure';
const change:StructureChange={kind:'createTable',table:{schema:'public',name:'notes'},name:'notes',charset:'',collation:'',comment:"Joe's notes",columns:[{...columnDraft(),name:'id',dataType:'bigint',primary:true}]};
describe('DDL plans',()=>{
 it('quotes names and comments and creates composite keys',()=>{const p=planStructure('postgres',{...change,table:{schema:'a"b',name:'notes'}});expect(p.sqls.join(';')).toContain('"a""b"."notes"');expect(p.sqls.join(';')).toContain("Joe''s notes");expect(p.sqls[0]).toContain('PRIMARY KEY ("id")');});
 it('rejects SQL injected through type or charset',()=>{expect(()=>planStructure('mysql',{...change,charset:'utf8; DROP TABLE x'})).toThrow();expect(()=>planStructure('postgres',{...change,columns:[{...change.columns[0],dataType:'text); DROP TABLE x;--'}]})).toThrow();});
 it('preserves MySQL column attributes in one statement',()=>{const old={name:'title',dataType:'varchar(50)',primary:false,editable:false,nullable:false,defaultValue:'hello',charset:'utf8mb4',collation:'utf8mb4_bin',comment:'saved',extra:''};const p=planStructure('mysql',{...change,kind:'alterColumn',original:old,columns:[{...columnDraft(old),name:'heading'}]},[old]);expect(p.sqls).toHaveLength(1);expect(p.sqls[0]).toContain("NOT NULL DEFAULT 'hello' COMMENT 'saved'");expect(p.sqls[0]).toContain('CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');expect(p.expectedColumns).toEqual([old]);});
 it('drops without cascading dependent objects',()=>{expect(planStructure('postgres',{...change,kind:'dropTable'}).sqls[0]).toBe('DROP TABLE "public"."notes" RESTRICT');});
});

describe('SQLite DDL plans', () => {
 const sqlite:StructureChange={...change,table:{schema:'main',name:'notes'},comment:''};
 it('creates SQLite tables without MySQL table attributes',()=>{const sql=planStructure('sqlite',sqlite).sqls.join(';');expect(sql).toContain('CREATE TABLE "main"."notes"');expect(sql).toContain('PRIMARY KEY ("id")');expect(sql).not.toMatch(/COMMENT|CHARACTER SET/);});
 it('supports rename and explicitly rejects column rebuilds',()=>{const old={name:'title',dataType:'TEXT',primary:false,editable:true,nullable:true,defaultValue:null,charset:null,collation:null,comment:'',extra:''};const rename={...sqlite,kind:'alterColumn' as const,original:old,columns:[{...columnDraft(old),name:'heading'}]};expect(planStructure('sqlite',rename,[old]).sqls[0]).toBe('ALTER TABLE "main"."notes" RENAME COLUMN "title" TO "heading"');expect(()=>planStructure('sqlite',{...rename,columns:[{...rename.columns[0],nullable:false}]},[old])).toThrow(/재구성/);});
 it('rejects add column primary key requiring rebuild',()=>{expect(()=>planStructure('sqlite',{...sqlite,kind:'addColumn'})).toThrow(/재구성/);});
});
