import { SortableTable } from './components/SortableTable';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import CodeMirror from '@uiw/react-codemirror';
import { sql, PostgreSQL, MySQL, SQLite } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { desktop } from './api';
import { useLanguage } from './i18n';
import { readTheme } from './theme';
import { objectIdentifier } from './StructureTools';
import type { Engine, Table } from './model';

type DbObject = { schema:string; name:string; kind:string; identity?:string };
type Props = { actionTarget?:HTMLElement|null; session:string; engine:Engine; schema:string; table:Table|null; section:string; onSql:(text:string)=>void };

export function ObjectDefinitions({actionTarget,session,engine,schema,table,section,onSql}:Props) {
  const {language}=useLanguage(),tr=(ko:string,en:string)=>language==='ko'?ko:en;
  const [items,setItems]=useState<DbObject[]>([]),[definition,setDefinition]=useState('');
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[filter,setFilter]=useState('');
  const available=desktop&&session!=='demo';
  useEffect(()=>{
    let cancelled=false;
    if(!available){setBusy(false);return;}
    const request=section==='ddl'
      ?invoke<string>('table_ddl',{id:session,table}).then(text=>{if(!cancelled)setDefinition(text);})
      :invoke<DbObject[]>('object_list',{id:session,schema}).then(list=>{if(!cancelled)setItems(list);});
    request.catch(reason=>{if(!cancelled)setError(String(reason));}).finally(()=>{if(!cancelled)setBusy(false);});
    return()=>{cancelled=true;};
  },[session,schema,table?.name,section,available]);
  async function open(object:DbObject) {
    setBusy(true);setError('');
    try{onSql(await invoke<string>('object_definition',{id:session,object}));}
    catch(reason){setError(String(reason));}
    finally{setBusy(false);}
  }
  const shown=items.filter(item=>(section==='views'?item.kind==='view':section==='triggers'?item.kind==='trigger':['function','procedure','routine'].includes(item.kind))&&item.name.toLowerCase().includes(filter.toLowerCase()));
  return <div className="object-definitions" aria-busy={busy}>
    {error&&<div className="error-banner" role="alert">{error}</div>}
    {!available?<div className="object-empty">{tr('실제 데이터베이스에 연결하면 조회할 수 있습니다.','Connect to a database to view this information.')}</div>:<>
      {section==='ddl'?<>
        {actionTarget&&createPortal(<Button variant="outline" size="sm" disabled={busy||!definition} onClick={()=>onSql(definition)}>{tr('SQL 편집기로 열기','Open in SQL editor')}</Button>,actionTarget)}
        {definition&&<CodeMirror value={definition} height="420px" theme={readTheme()==='dark'?oneDark:'light'} editable={false} readOnly extensions={[sql({dialect:engine==='postgres'?PostgreSQL:engine==='sqlite'?SQLite:MySQL})]} basicSetup={{lineNumbers:true,foldGutter:false,highlightActiveLine:false,highlightActiveLineGutter:false}}/>}
      </>:<>
        <div className="object-definition-toolbar">
          <p className="structure-note">{tr('스키마 전체 객체','Objects in schema')}: {schema}</p>
          {section==='views'&&actionTarget&&createPortal(<Button variant="outline" size="sm" onClick={()=>onSql(`CREATE VIEW ${objectIdentifier(engine,schema)}.${objectIdentifier(engine,'new_view')} AS\nSELECT ...;`)}>{tr('새 뷰 SQL','New view SQL')}</Button>,actionTarget)}
        </div>
        <Input className="object-definition-search" aria-label={tr('객체 검색','Search objects')} placeholder={tr('검색','Search')} value={filter} onChange={event=>setFilter(event.target.value)}/>
        <SortableTable className="object-table"><thead><tr><th>{tr('이름','Name')}</th><th>{tr('종류','Type')}</th><th>{tr('정의','Definition')}</th></tr></thead>
          <tbody>{shown.map(item=><tr key={item.kind+item.name+item.identity}><td>{item.name}</td><td>{item.kind.toUpperCase()}</td><td><Button variant="outline" size="sm" disabled={busy} onClick={()=>void open(item)}>{tr('SQL 편집기로 열기','Open in SQL editor')}</Button></td></tr>)}</tbody>
        </SortableTable>
        {!busy&&!error&&!shown.length&&<div className="object-empty">{tr(engine==='sqlite'&&section==='routines'?'SQLite는 루틴을 지원하지 않습니다.':'일치하는 결과가 없습니다.',engine==='sqlite'&&section==='routines'?'SQLite does not support routines.':'No matching results.')}</div>}
      </>}
      {busy&&<div className="object-empty" role="status">{tr('불러오는 중…','Loading…')}</div>}
    </>}
  </div>;
}
