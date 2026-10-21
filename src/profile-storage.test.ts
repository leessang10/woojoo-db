import { describe, it, expect } from 'vitest';
import { safeProfile } from './profile-storage';
import { queryOrigin } from './query-origin';

describe('saved profiles',()=>{
  it('persists credential preferences without persisting the password',()=>{
    const p=safeProfile({id:'remember',name:'DB',engine:'mysql',host:'db.example',port:3306,database:'app',username:'user',password:'do-not-save',rememberPassword:true});
    expect(p).toMatchObject({rememberPassword:true,password:''});
    expect(JSON.stringify(p)).not.toContain('do-not-save');
    expect(safeProfile({...p,rememberPassword:'true'})).toMatchObject({rememberPassword:false});
  });
  it('whitelists connection fields and removes credentials',()=>{
    const p=safeProfile({id:'a',name:'Local',engine:'sqlite',host:'',port:0,database:'db.sqlite',username:'',password:'secret',token:'secret',readOnly:true});
    expect(p?.password).toBe('');expect(p).not.toHaveProperty('token');expect(p?.readOnly).toBe(true);
  });
  it('rejects malformed profiles',()=>{expect(safeProfile({id:'a'})).toBeNull();});
});
describe('editable query provenance',()=>{
  const tables=[{schema:'public',name:'users'}];
  it('recognizes one complete table projection',()=>{expect(queryOrigin('SELECT * FROM "public"."users" WHERE id > 3 ORDER BY id;',tables)).toEqual(tables[0]);});
  it('rejects joins, aliases, projections and extra statements',()=>{
    for(const sql of ['SELECT * FROM users','SELECT id FROM users','SELECT * FROM users u','SELECT * FROM users JOIN other ON true','SELECT * FROM users; DELETE FROM users','SELECT * FROM users WHERE id IN (SELECT id FROM users)'])expect(queryOrigin(sql,tables)).toBeNull();
  });
});
