import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql as sqlLanguage, PostgreSQL, MySQL, SQLite } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { Code2, Database, FileCode2, ListTree, Loader2, Plus, X, ArrowUpRight } from 'lucide-react';
import { readTheme } from './theme';
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
type Props={constraintsOnly?:boolean;session:string;engine:Engine;schema:string;table?:Table|null;objects?:TableObjects|null;readOnly?:boolean;onSql:(sql:string)=>void;onChanged:()=>void};
export function StructureTools({constraintsOnly=false,session,engine,schema,table,objects,readOnly,onSql,onChanged}:Props){
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
  async function ddl(){setReview(false);setMode('ddl');setSql('');setBusy(true);setError('');try{setSql(await invoke<string>('table_ddl',{id:session,table}));}catch(e){setError(String(e));}finally{setBusy(false);}}
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
    {!constraintsOnly&&<Button variant="outline" size="sm" disabled={!desktop||session==='demo'} onClick={()=>{setReview(false);setMode('objects');}}>{tr('뷰 · 루틴 · 트리거','Views · routines · triggers')}</Button>}
    {table&&<>{!constraintsOnly&&<Button variant="outline" size="sm" disabled={!desktop||session==='demo'} onClick={()=>void ddl()}>DDL</Button>}<Button variant="outline" size="sm" disabled={readOnly||!desktop||session==='demo'} onClick={()=>{setReview(false);setMode('constraint');setSql('');}}>{tr('인덱스 · 제약조건 편집','Edit indexes · constraints')}</Button></>}

    {mode&&<ModalSurface title={mode==='objects'?tr('DB 객체','Database objects'):mode==='ddl'?tr('테이블 DDL','Table DDL'):tr('인덱스 · 제약조건','Indexes · constraints')} onClose={()=>setMode(null)} locked={busy}>
      <div className={`modal structure-tools-modal structure-tools-${mode}`} role="dialog" aria-label={tr('DB 구조 도구','Database structure tools')}>
        <header className="structure-dialog-header">
          <div className="structure-dialog-icon">{mode==='ddl'?<Code2 size={20}/>:mode==='objects'?<Database size={20}/>:<ListTree size={20}/>}</div>
          <div className="structure-dialog-title"><h2>{mode==='ddl'?tr('테이블 DDL','Table DDL'):mode==='objects'?tr('뷰 · 루틴 · 트리거','Views · routines · triggers'):review?tr('변경 SQL 검토','Review SQL changes'):tr('인덱스 · 제약조건','Indexes · constraints')}</h2><p title={table&&mode!=='objects'?schema+'.'+table.name:schema}>{table&&mode!=='objects'?schema+'.'+table.name:schema}</p></div>
          <Button variant="ghost" size="icon" className="structure-dialog-close" disabled={busy} aria-label={tr('닫기','Close')} onClick={()=>setMode(null)}><X size={17}/></Button>
        </header>
        <div className="structure-dialog-body">
        {error&&<p role="alert" className="structure-dialog-error">{error}</p>}
        {busy&&<div className="structure-loading" role="status"><Loader2 size={16} className="spin"/>{tr('불러오는 중…','Loading…')}</div>}
        {mode==='objects'?<>
          {!busy&&!error&&!list.length?<div className="structure-empty"><ListTree size={30}/><h3>{tr('아직 등록된 객체가 없습니다','No objects yet')}</h3><p>{tr('이 스키마의 뷰, 루틴, 트리거가 여기에 표시됩니다.','Views, routines and triggers in this schema appear here.')}</p></div>:
          <div className="structure-object-list">{list.map(object=><Button key={object.kind+object.name+object.identity} variant="ghost" className="structure-object-row" disabled={busy} onClick={()=>{setBusy(true);void invoke<string>('object_definition',{id:session,object}).then(text=>{onSql(text);setMode(null);}).catch(e=>setError(String(e))).finally(()=>setBusy(false));}}><FileCode2 size={16}/><span><strong>{object.name}</strong>{object.identity&&<small>{object.identity}</small>}</span><span className="structure-kind">{object.kind}</span><ArrowUpRight size={14}/></Button>)}</div>}
        </>:mode==='ddl'?<div className="structure-code-view"><div className="structure-code-caption"><span>SQL</span><span>{tr('읽기 전용','Read only')}</span></div><CodeMirror value={sql} height="360px" theme={readTheme()==='dark'?oneDark:'light'} editable={false} readOnly extensions={[sqlLanguage({dialect:engine==='postgres'?PostgreSQL:engine==='sqlite'?SQLite:MySQL})]} basicSetup={{lineNumbers:true,foldGutter:false,highlightActiveLine:false,highlightActiveLineGutter:false}}/></div>:review?<div className="structure-review"><label htmlFor="structure-review-sql">SQL</label><Textarea id="structure-review-sql" rows={12} value={sql} onChange={e=>setSql(e.target.value)}/></div>:<>
          <section className="structure-existing"><h3>{tr('등록된 인덱스 · 제약조건','Existing indexes · constraints')}<span>{(objects?.indexes.length??0)+(objects?.constraints.length??0)}</span></h3>
          <div className="structure-definition-list">
          {objects?.indexes.map(item=><div className="structure-definition-row" key={'index:'+item.name}><div><span className="structure-kind">INDEX</span><code title={item.name}>{item.name}</code></div><div className="structure-row-actions"><Button variant="outline" size="sm" onClick={()=>{onSql(item.definition+';');setMode(null);}}>{tr('정의 편집','Edit definition')}</Button><Button variant="outline" size="sm" className="structure-drop" onClick={()=>drop(item.name,true)}>{tr('삭제','Drop')}</Button></div></div>)}
          {objects?.constraints.map(item=><div className="structure-definition-row" key={'constraint:'+item.name}><div><span className="structure-kind">{engine==='sqlite'?'DDL':'CONSTRAINT'}</span><code title={item.name}>{engine==='sqlite'?tr('테이블 정의 · 제약조건 포함','Table definition · includes constraints'):item.name}</code></div><div className="structure-row-actions">{engine==='sqlite'?<Button variant="outline" size="sm" onClick={()=>{onSql(item.definition);setMode(null);}}>{tr('정의 편집','Edit definition')}</Button>:<Button variant="outline" size="sm" className="structure-drop" onClick={()=>drop(item.name,false,item.definition)}>{tr('삭제','Drop')}</Button>}</div></div>)}
          {!objects?.indexes.length&&!objects?.constraints.length&&<p className="structure-list-empty">{tr('등록된 항목이 없습니다.','No indexes or constraints.')}</p>}
          </div></section>
          <section className="structure-create"><h3><Plus size={15}/>{tr('새 인덱스 · 제약조건','New index · constraint')}</h3><div className="structure-form-grid">
          <label>{tr('객체 종류','Object type')}<NativeSelect value={kind} onChange={e=>setKind(e.target.value)}>{[['index','INDEX'],['uniqueIndex','UNIQUE INDEX'],['primary','PRIMARY KEY'],['unique','UNIQUE'],['foreign','FOREIGN KEY'],['check','CHECK']].map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></label>
          <label>{tr('이름','Name')}<Input value={name} onChange={e=>setName(e.target.value)}/></label>
          {kind!=='check'&&<label className="structure-form-wide">{tr('컬럼 (쉼표로 구분)','Columns (comma separated)')}<Input placeholder="user_id, created_at" value={columns} onChange={e=>setColumns(e.target.value)}/></label>}
          {kind==='foreign'&&<><label>{tr('참조 테이블','Referenced table')}<Input value={reference} onChange={e=>setReference(e.target.value)}/></label><label>{tr('참조 컬럼','Referenced columns')}<Input value={refColumns} onChange={e=>setRefColumns(e.target.value)}/></label></>}
          {kind==='check'&&<label className="structure-form-wide">CHECK<Textarea value={expression} onChange={e=>setExpression(e.target.value)}/></label>}
          </div></section>
        </>}
        </div>
        <footer className="structure-dialog-footer">
          <Button variant="outline" size="sm" disabled={busy} onClick={()=>review&&mode==='constraint'?setReview(false):setMode(null)}>{review&&mode==='constraint'?tr('뒤로','Back'):tr('닫기','Close')}</Button>
          {mode==='objects'?<Button size="sm" disabled={busy} onClick={()=>{onSql(`CREATE VIEW ${q(schema)}.${q('new_view')} AS\nSELECT ...;`);setMode(null);}}><Plus size={14}/>{tr('새 뷰 SQL','New view SQL')}</Button>:mode==='ddl'?<Button size="sm" disabled={busy||!sql} onClick={()=>{onSql(sql);setMode(null);}}><ArrowUpRight size={14}/>{tr('SQL 편집기로 열기','Open in SQL editor')}</Button>:review?<Button size="sm" disabled={busy||readOnly||!sql.trim()} onClick={()=>void apply()}>{tr('적용','Apply')}</Button>:<Button size="sm" onClick={preview}><Code2 size={14}/>{tr('SQL 미리보기','Preview SQL')}</Button>}
        </footer>
      </div>
    </ModalSurface>}
  </div>;
}
