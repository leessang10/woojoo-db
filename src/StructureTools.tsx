import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { ModalSurface } from '@/components/ModalSurface';
import { useLanguage } from './i18n';
import type { Engine, Table, TableObjects } from './model';
import { desktop, query } from './api';

type DbObject = { schema:string;name:string;kind:string;identity?:string };
export function objectIdentifier(engine:Engine,name:string) {
  if(!name.trim()||name.includes('\0'))throw new Error('Invalid identifier');
  const q=engine==='mysql'||engine==='mariadb'?'`':'"';
  return q+name.replaceAll(q,q+q)+q;
}
type Props={session:string;engine:Engine;schema:string;table?:Table|null;objects?:TableObjects|null;readOnly?:boolean;onSql:(sql:string)=>void;onChanged:()=>void};
export function StructureTools({session,engine,schema,table,objects,readOnly,onSql,onChanged}:Props){
  const {language}=useLanguage(),tr=(ko:string,en:string)=>language==='ko'?ko:en;
  const [mode,setMode]=useState<'objects'|'constraint'|'ddl'|null>(null),[list,setList]=useState<DbObject[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [kind,setKind]=useState('index'),[name,setName]=useState(''),[columns,setColumns]=useState(''),[reference,setReference]=useState(''),[refColumns,setRefColumns]=useState(''),[expression,setExpression]=useState(''),[sql,setSql]=useState(''),[review,setReview]=useState(false);
  const q=(name:string)=>objectIdentifier(engine,name);
  const qualified=table?`${q(table.schema)}.${q(table.name)}`:'';
  useEffect(()=>{if(!mode)return;setError('');if(mode!=='objects')return;
    let cancelled=false;setBusy(true);
    invoke<DbObject[]>('object_list',{id:session,schema}).then(items=>{if(!cancelled)setList(items);}).catch(e=>{if(!cancelled)setError(String(e));}).finally(()=>{if(!cancelled)setBusy(false);});
    return()=>{cancelled=true;};
  },[mode,session,schema]);
  async function ddl(){setMode('ddl');setSql('');setBusy(true);setError('');try{setSql(await invoke<string>('table_ddl',{id:session,table}));}catch(e){setError(String(e));}finally{setBusy(false);}}
  function preview(){
    try {
      const cols=kind==='check'?'':columns.split(',').map(x=>q(x.trim())).join(', ');
      let next='';
      if(kind==='index'||kind==='uniqueIndex') next=`CREATE ${kind==='uniqueIndex'?'UNIQUE ':''}INDEX ${engine==='sqlite'?q(schema)+'.':''}${q(name)} ON ${engine==='sqlite'?q(table!.name):qualified} (${cols});`;
      else {
        if(engine==='sqlite')throw new Error(tr('SQLite 제약조건 변경은 테이블 재생성이 필요합니다. DDL을 SQL 편집기로 열어 변경하세요.','SQLite constraint changes require rebuilding the table. Open DDL in the SQL editor.'));
        const detail=kind==='primary'?`PRIMARY KEY (${cols})`:kind==='unique'?`UNIQUE (${cols})`:kind==='foreign'?`FOREIGN KEY (${cols}) REFERENCES ${q(schema)}.${q(reference)} (${refColumns.split(',').map(x=>q(x.trim())).join(', ')})`:`CHECK (${expression})`;
        if(kind==='check'&&!expression.trim())throw new Error(tr('CHECK 식을 입력하세요.','Enter a CHECK expression.'));
        next=`ALTER TABLE ${qualified} ADD ${kind==='primary'&&engine!=='postgres'?'':`CONSTRAINT ${q(name)} `}${detail};`;
      }
      setSql(next);setReview(true);setError('');
    }catch(e){setError(String(e));}
  }
  function drop(name:string,index:boolean,definition=''){
    const statement=index?`DROP INDEX ${engine==='mysql'||engine==='mariadb'?q(name)+' ON '+qualified:q(schema)+'.'+q(name)};`:
      `ALTER TABLE ${qualified} ${engine!=='postgres'&&name==='PRIMARY'?'DROP PRIMARY KEY':(engine==='mysql'||engine==='mariadb')?(/FOREIGN KEY/i.test(definition)?'DROP FOREIGN KEY ':/UNIQUE/i.test(definition)?'DROP INDEX ':'DROP CHECK ')+q(name):'DROP CONSTRAINT '+q(name)};`;
    setSql(statement);setReview(true);setMode('constraint');
  }
  async function apply(){if(readOnly)return;setBusy(true);setError('');try{await query(session,sql);setMode(null);onChanged();}catch(e){setError(String(e));}finally{setBusy(false);}}
  return <div className="structure-tools">
    <Button variant="outline" size="sm" disabled={!desktop||session==='demo'} onClick={()=>{setReview(false);setMode('objects');}}>{tr('뷰 · 루틴 · 트리거','Views · routines · triggers')}</Button>
    {table&&<><Button variant="outline" size="sm" disabled={!desktop||session==='demo'} onClick={()=>void ddl()}>DDL</Button><Button variant="outline" size="sm" disabled={readOnly||!desktop||session==='demo'} onClick={()=>{setReview(false);setMode('constraint');setSql('');}}>{tr('인덱스 · 제약조건 편집','Edit indexes · constraints')}</Button></>}
    {mode&&<ModalSurface title={mode==='objects'?tr('DB 객체','Database objects'):mode==='ddl'?'DDL':tr('인덱스 · 제약조건','Indexes · constraints')} onClose={()=>setMode(null)} locked={busy}>
      <div className="modal structure-tools-modal" role="dialog" aria-label={tr('DB 구조 도구','Database structure tools')}>
        <div className="modal-heading"><h2>{mode==='objects'?schema:table?.name}</h2><Button variant="ghost" size="sm" disabled={busy} onClick={()=>setMode(null)}>✕</Button></div>
        {mode==='objects'?<><div className="object-list">{list.map(object=><Button key={object.kind+object.name+object.identity} variant="outline" size="sm" disabled={busy} onClick={()=>{setBusy(true);void invoke<string>('object_definition',{id:session,object}).then(text=>{onSql(text);setMode(null);}).catch(e=>setError(String(e))).finally(()=>setBusy(false));}}>{object.kind} · {object.name}</Button>)}{!busy&&!list.length&&<p>{tr('객체가 없습니다.','No objects.')}</p>}</div><Button variant="outline" size="sm" onClick={()=>{onSql(`CREATE VIEW ${q(schema)}.${q('new_view')} AS\nSELECT ...;`);setMode(null);}}>{tr('새 뷰 SQL','New view SQL')}</Button></>:mode==='ddl'?<><Textarea value={sql} readOnly rows={16}/><Button disabled={!sql} onClick={()=>{onSql(sql);setMode(null);}}>{tr('SQL 편집기로 열기','Open in SQL editor')}</Button></>:<>
          {!review&&<><NativeSelect aria-label={tr('객체 종류','Object type')} value={kind} onChange={e=>setKind(e.target.value)}>{[['index','INDEX'],['uniqueIndex','UNIQUE INDEX'],['primary','PRIMARY KEY'],['unique','UNIQUE'],['foreign','FOREIGN KEY'],['check','CHECK']].map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect>
          <label>{tr('이름','Name')}<Input value={name} onChange={e=>setName(e.target.value)}/></label>
          {kind!=='check'&&<label>{tr('컬럼 (쉼표로 구분)','Columns (comma separated)')}<Input value={columns} onChange={e=>setColumns(e.target.value)}/></label>}
          {kind==='foreign'&&<><label>{tr('참조 테이블','Referenced table')}<Input value={reference} onChange={e=>setReference(e.target.value)}/></label><label>{tr('참조 컬럼','Referenced columns')}<Input value={refColumns} onChange={e=>setRefColumns(e.target.value)}/></label></>}
          {kind==='check'&&<label>CHECK<Textarea value={expression} onChange={e=>setExpression(e.target.value)}/></label>}
          <Button size="sm" onClick={preview}>{tr('SQL 미리보기','Preview SQL')}</Button>
          <div className="object-list">{objects?.indexes.map(item=><div key={item.name}><code>{item.name}</code><Button variant="ghost" size="sm" onClick={()=>{onSql(item.definition+';');setMode(null);}}>{tr('정의 편집','Edit definition')}</Button><Button variant="ghost" size="sm" onClick={()=>drop(item.name,true)}>{tr('삭제','Drop')}</Button></div>)}{objects?.constraints.map(item=><div key={item.name}><code>{item.name}</code><Button variant="ghost" size="sm" disabled={engine==='sqlite'} onClick={()=>drop(item.name,false,item.definition)}>{tr('삭제','Drop')}</Button></div>)}</div></>}
          {review&&<><Textarea rows={8} value={sql} onChange={e=>setSql(e.target.value)}/><div className="modal-actions"><Button variant="outline" size="sm" disabled={busy} onClick={()=>setReview(false)}>{tr('뒤로','Back')}</Button><Button disabled={busy||readOnly||!sql.trim()} onClick={()=>void apply()}>{tr('적용','Apply')}</Button></div></>}
        </>}
        {error&&<p role="alert">{error}</p>}
      </div>
    </ModalSurface>}
  </div>;
}
