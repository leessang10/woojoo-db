import { useEffect, useState, type HTMLAttributes } from 'react';
import { Database, KeyRound, Layers3, RefreshCw, Search, Table2, Plus } from 'lucide-react';
import { useLanguage } from './i18n';
import type { Engine, SchemaInfo, Table, TableInfo, TableObjects } from './model';
import type { WorkspaceTab } from './workspace-tabs';
import type { MenuItem } from './ContextMenu';
import { StructureDialog, type StructureAction } from './StructureDialog';
import type { StructurePlan } from './structure';
import * as api from './api';

type Props = {
  tab: WorkspaceTab; database: string; session: string; engine: Engine; revision: number; tables: Table[];
  onFilter: (value: string) => void; onRefresh: () => void; onSchema: (schema: string) => void; onErd: (schema: string) => void;
  onDetails: (table: Table) => void; onData: (table: Table) => void; onQuery: (table: Table) => void;
  onChanged: (plan: StructurePlan) => Promise<void>; changeBlocked: (table: Table) => boolean;
  tableMenu: (table: Table) => MenuItem[]; menuFor: (items: MenuItem[]) => HTMLAttributes<HTMLElement>;
};
const size = (bytes?: number|null) => bytes == null ? '—' : bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${(bytes/1024).toFixed(1)} KB`;
export function ObjectPage({ tab, database, session, engine, revision, tables, onFilter, onRefresh, onSchema, onErd, onDetails, onData, onQuery, onChanged, changeBlocked, tableMenu, menuFor }: Props) {
  const {t}=useLanguage(),schema=tab.kind==='schema';
  const [metadata,setMetadata]=useState<SchemaInfo|null>(null),[objects,setObjects]=useState<TableObjects|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [version,setVersion]=useState(0),[section,setSection]=useState('columns'),[action,setAction]=useState<StructureAction|null>(null);
  useEffect(()=>{
    let cancelled=false;setLoading(true);setError('');setMetadata(null);setObjects(null);
    Promise.all([api.schemaInfo(session,tab.objectSchema),schema||!tab.selected?Promise.resolve(null):api.tableInfo(session,tab.selected)])
      .then(([info,details])=>{if(!cancelled){setMetadata(info);setObjects(details);}})
      .catch(reason=>{if(!cancelled)setError(String(reason));})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[session,tab.id,tab.objectSchema,tab.selected?.name,schema,revision,version]);
  const allTables:TableInfo[]=metadata?.tables ?? tables.filter(table=>table.schema===tab.objectSchema);
  const shown=allTables.filter(table=>table.name.toLowerCase().includes(tab.filter.toLowerCase()));
  const columns=tab.details.filter(column=>`${column.name} ${column.dataType} ${column.comment??''}`.toLowerCase().includes(tab.filter.toLowerCase()));
  const tableMeta=metadata?.tables.find(table=>table.name===tab.selected?.name),info=schema?metadata?.info:tableMeta;
  const busy=tab.busy||loading;
  function openAction(next:StructureAction){
    if(next.kind!=='createTable'&&changeBlocked(next.table)){setError(t('먼저 데이터 탭의 변경 사항을 적용하거나 취소하고 실행 중인 작업을 완료하세요.'));return;}
    setAction(next);
  }
  async function applied(plan:StructurePlan){
    setAction(null);setError('');
    try{await onChanged(plan);setVersion(value=>value+1);}
    catch(reason){setError(t('구조 변경은 적용되었지만 새로고침에 실패했습니다.')+' '+String(reason));}
  }
  const alterTable=(table:TableInfo)=>openAction({kind:'alterTable',table,info:table});
  const dropTable=(table:TableInfo)=>openAction({kind:'dropTable',table,info:table});
  return <section className="object-page" role="tabpanel" id="query-panel" aria-labelledby={`tab-${tab.id}`} aria-busy={busy}>
    <header className="object-heading">
      <div className="object-path"><Database size={13}/>{database}<span>/</span>{schema?tab.objectSchema:<button onClick={()=>onSchema(tab.objectSchema)}>{tab.objectSchema}</button>}</div>
      <div className="object-title"><div>{schema?<Layers3 size={24}/>:<Table2 size={24}/>}<h1>{schema?tab.objectSchema:tab.selected?.name}</h1><span>{t(schema?'스키마':'테이블')}</span></div>
        <div className="object-actions">
          <button className="secondary-button" onClick={()=>onErd(tab.objectSchema)}>{t('ERD 열기')}</button>
          {!schema&&tab.selected&&<><button className="secondary-button" onClick={()=>onQuery(tab.selected!)}>{t('SELECT 쿼리 열기')}</button><button className="primary-button" onClick={()=>onData(tab.selected!)}>{t('데이터 보기')}</button></>}
          <button className="icon-button" aria-label={t('상세 새로고침')} disabled={busy} onClick={()=>{setVersion(value=>value+1);onRefresh();}}><RefreshCw size={16} className={busy?'spin':''}/></button>
        </div>
      </div>
      <dl className="object-properties">
        <div><dt>{engine==='postgres'?t('DB 인코딩'):'Charset'}</dt><dd>{(engine==='postgres'?metadata?.info.charset:info?.charset)??'—'}</dd></div>
        <div><dt>{engine==='postgres'?t('DB Collation'):'Collation'}</dt><dd>{(engine==='postgres'?metadata?.info.collation:info?.collation)??'—'}</dd></div>
        <div><dt>{t('소유자')}</dt><dd>{info?.owner??'—'}</dd></div>
        {!schema&&<><div><dt>{t('엔진')}</dt><dd>{tableMeta?.engine??'—'}</dd></div><div><dt>{t('추정 행 수')}</dt><dd>{tableMeta?.estimatedRows?.toLocaleString()??'—'}</dd></div><div><dt>{t('크기')}</dt><dd>{size(tableMeta?.sizeBytes)}</dd></div></>}
        <div className="object-comment"><dt>{t('설명')}</dt><dd>{info?.comment||'—'}</dd></div>
      </dl>
    </header>
    <div className="object-section-bar">
      {schema?<strong>{t('테이블')} <span>{allTables.length}</span></strong>:<div className="object-subtabs" role="tablist" aria-label={t('테이블 정보')}>
        {(['columns','indexes','constraints'] as const).map(value=><button key={value} role="tab" aria-selected={section===value} onClick={()=>setSection(value)}>{t(value==='columns'?'컬럼':value==='indexes'?'인덱스':'제약조건')} <span>{value==='columns'?tab.details.length:objects?.[value].length??0}</span></button>)}
      </div>}
      <div className="object-actions">
        {schema?<button className="primary-button" disabled={busy||!metadata} onClick={()=>openAction({kind:'createTable',table:{schema:tab.objectSchema,name:''}})}><Plus size={14}/>{t('테이블 추가')}</button>
          :<><button className="secondary-button" disabled={busy||!tableMeta} onClick={()=>tableMeta&&alterTable(tableMeta)}>{t('테이블 변경')}</button><button className="secondary-button danger-text" disabled={busy||!tableMeta} onClick={()=>tableMeta&&dropTable(tableMeta)}>{t('테이블 삭제')}</button>
            <button className="primary-button" disabled={busy||!tab.loaded} onClick={()=>tab.selected&&openAction({kind:'addColumn',table:tab.selected})}><Plus size={14}/>{t('컬럼 추가')}</button></>}
      </div>
    </div>
    {(schema||section==='columns')&&<div className="object-search-row"><label className="search-field"><Search size={14}/><input aria-label={t(schema?'스키마 내 테이블 검색':'컬럼 검색')} placeholder={t('검색')} value={tab.filter} onChange={e=>onFilter(e.target.value)}/></label></div>}
    {(error||tab.error)&&<div className="error-banner" role="alert">{error||tab.error}</div>}
    <div className="object-table-scroll">
      {schema?<table className="object-table"><thead><tr>{['이름','엔진','Charset','Collation','추정 행 수','크기','설명',''].map((label,i)=><th key={i}>{t(label)}</th>)}</tr></thead>
        <tbody>{shown.map(table=><tr key={table.name} onDoubleClick={()=>onDetails(table)} {...menuFor([...tableMenu(table),{label:t('테이블 변경'),action:()=>alterTable(table),disabled:busy||!metadata,divider:true},{label:t('테이블 삭제'),action:()=>dropTable(table),disabled:busy||!metadata}])}>
          <td><button className="object-name" onClick={()=>onDetails(table)}><Table2 size={15}/>{table.name}</button></td>
          <td>{table.engine??'—'}</td><td>{table.charset??'—'}</td><td>{table.collation??'—'}</td><td>{table.estimatedRows?.toLocaleString()??'—'}</td><td>{size(table.sizeBytes)}</td><td>{table.comment||'—'}</td>
          <td className="object-row-actions"><button onClick={()=>onDetails(table)}>{t('테이블 상세')}</button><button onClick={()=>onData(table)}>{t('데이터 보기')}</button><button disabled={busy||!metadata} onClick={()=>alterTable(table)}>{t('변경')}</button><button disabled={busy||!metadata} onClick={()=>dropTable(table)}>{t('삭제')}</button></td>
        </tr>)}</tbody></table>:section==='columns'?<table className="object-table"><thead><tr>{['이름','자료형','기본키','NULL 허용','기본값','Charset','Collation','추가 속성','설명',''].map((label,i)=><th key={i}>{t(label)}</th>)}</tr></thead>
        <tbody>{columns.map(column=><tr key={column.name} {...menuFor([{label:t('컬럼 변경'),action:()=>tab.selected&&openAction({kind:'alterColumn',table:tab.selected,column}),disabled:busy},{label:t('컬럼 삭제'),action:()=>tab.selected&&openAction({kind:'dropColumn',table:tab.selected,column}),disabled:busy}])}>
          <td><span className="column-name">{column.primary&&<KeyRound size={13}/>}<strong>{column.name}</strong></span></td>
          <td><code>{column.dataType}</code></td><td>{column.primary?'PK':'—'}</td><td>{t(column.nullable?'허용':'허용 안 함')}</td><td><code>{column.defaultValue??'—'}</code></td>
          <td>{column.charset??'—'}</td><td>{column.collation??'—'}</td><td>{column.extra||'—'}</td><td>{column.comment||'—'}</td>
          <td className="object-row-actions"><button disabled={busy} onClick={()=>tab.selected&&openAction({kind:'alterColumn',table:tab.selected,column})}>{t('변경')}</button><button disabled={busy} onClick={()=>tab.selected&&openAction({kind:'dropColumn',table:tab.selected,column})}>{t('삭제')}</button></td>
        </tr>)}</tbody></table>:<table className="object-table"><thead><tr><th>{t('이름')}</th><th>{t('정의')}</th></tr></thead><tbody>{objects?.[section as 'indexes'|'constraints'].map(item=><tr key={item.name}><td>{item.name}</td><td><code className="object-definition">{item.definition}</code></td></tr>)}</tbody></table>}
      {(schema?!shown.length:section==='columns'?!columns.length:!objects?.[section as 'indexes'|'constraints'].length)&&<div className="object-empty">{t(busy?'데이터를 불러오는 중...':error?'정보를 불러오지 못했습니다.':'일치하는 결과가 없습니다.')}</div>}
    </div>
    {action&&<StructureDialog key={action.kind+action.column?.name} action={action} session={session} engine={engine} onClose={()=>setAction(null)} onApplied={plan=>void applied(plan)}/>}
  </section>;
}
