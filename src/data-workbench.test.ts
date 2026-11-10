import { describe, expect, it, vi } from 'vitest';
vi.mock('./api',()=>({demoCatalog:new Map()}));
import { importOperations, operationPreview, parseDelimited, rowInsert, rowJson, serializeDelimited, sqlLiteral, whereCondition } from './data-workbench';
describe('data import/export correctness',()=>{
 it('roundtrips NULL, empty, literal null marker, quotes and embedded newlines',()=>{const columns=['a','b'];const rows=[{a:null,b:''},{a:'\\N',b:'comma, quote"\r\nline'}];expect(parseDelimited(serializeDelimited(columns,rows))).toEqual([columns,[null,''],['\\N','comma, quote"\r\nline']]);});
 it('rejects malformed quoted fields instead of shifting data',()=>{expect(()=>parseDelimited('a,"unterminated')).toThrow();expect(()=>parseDelimited('"closed"x,b')).toThrow();});
 it('supports tab-separated multi-cell content',()=>{expect(parseDelimited('one\t"two\nlines"\r\n\\N\t""','\t')).toEqual([['one','two\nlines'],[null,'']]);});
 it('maps source columns and rejects duplicate targets or ragged rows',()=>{const columns=[{name:'name',dataType:'text',primary:false,editable:true}];expect(importOperations([['ignored','Ada']],['','name'],columns)[0].values).toEqual({name:'Ada'});expect(()=>importOperations([['a','b']],['name','name'],columns)).toThrow('Duplicate');expect(()=>importOperations([['a']],['','name'],columns)).toThrow('field count');});
 it('quotes table and cell data in review without losing nulls',()=>{expect(operationPreview({schema:'public',name:'a"b'},'postgres',[{kind:'insert',original:{},values:{name:"O'Reilly",empty:'',missing:null}}])).toContain(`INSERT INTO "public"."a""b" ("name", "empty", "missing") VALUES ('O''Reilly', '', NULL);`);});
});

describe('row copy formats', () => {
  it('escapes literals per engine', () => {
    expect(sqlLiteral("it's", 'postgres')).toBe("'it''s'");
    expect(sqlLiteral('a\\b', 'postgres')).toBe("'a\\b'");
    expect(sqlLiteral('a\\b', 'mysql')).toBe("'a\\\\b'");
    expect(sqlLiteral(null, 'mysql')).toBe('NULL');
  });
  it('builds WHERE conditions, INSERT statements and JSON', () => {
    expect(whereCondition('name', null, 'postgres')).toBe('"name" IS NULL');
    expect(whereCondition('name', 'x', 'mysql')).toBe("`name` = 'x'");
    expect(rowInsert({ schema: 'public', name: 'users' }, ['id', 'note'], { id: '1', note: null }, 'postgres'))
      .toBe(`INSERT INTO "public"."users" ("id", "note") VALUES ('1', NULL);`);
    expect(JSON.parse(rowJson(['id', 'note'], { id: '1', note: null }))).toEqual({ id: '1', note: null });
  });
});
