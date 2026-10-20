import { describe, expect, it, vi } from 'vitest';
vi.mock('./api',()=>({demoCatalog:new Map()}));
import { importOperations, operationPreview, parseDelimited, serializeDelimited } from './data-workbench';
describe('data import/export correctness',()=>{
 it('roundtrips NULL, empty, literal null marker, quotes and embedded newlines',()=>{const columns=['a','b'];const rows=[{a:null,b:''},{a:'\\N',b:'comma, quote"\r\nline'}];expect(parseDelimited(serializeDelimited(columns,rows))).toEqual([columns,[null,''],['\\N','comma, quote"\r\nline']]);});
 it('rejects malformed quoted fields instead of shifting data',()=>{expect(()=>parseDelimited('a,"unterminated')).toThrow();expect(()=>parseDelimited('"closed"x,b')).toThrow();});
 it('supports tab-separated multi-cell content',()=>{expect(parseDelimited('one\t"two\nlines"\r\n\\N\t""','\t')).toEqual([['one','two\nlines'],[null,'']]);});
 it('maps source columns and rejects duplicate targets or ragged rows',()=>{const columns=[{name:'name',dataType:'text',primary:false,editable:true}];expect(importOperations([['ignored','Ada']],['','name'],columns)[0].values).toEqual({name:'Ada'});expect(()=>importOperations([['a','b']],['name','name'],columns)).toThrow('Duplicate');expect(()=>importOperations([['a']],['','name'],columns)).toThrow('field count');});
 it('quotes table and cell data in review without losing nulls',()=>{expect(operationPreview({schema:'public',name:'a"b'},'postgres',[{kind:'insert',original:{},values:{name:"O'Reilly",empty:'',missing:null}}])).toContain(`INSERT INTO "public"."a""b" ("name", "empty", "missing") VALUES ('O''Reilly', '', NULL);`);});
});
