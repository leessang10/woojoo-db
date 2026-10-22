import { ObjectDefinitions } from './ObjectDefinitions';
import { StructureTools } from './StructureTools';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState, type HTMLAttributes } from 'react';
import { Database, KeyRound, Layers3, RefreshCw, Search, Table2, Plus, Pencil, Trash2 } from 'lucide-react';
import { useLanguage } from './i18n';
import type { Engine, SchemaInfo, Table, TableInfo, TableObjects } from './model';
import type { WorkspaceTab } from './workspace-tabs';
import type { MenuItem } from './ContextMenu';
import { StructureDialog, type StructureAction } from './StructureDialog';
import type { StructurePlan } from './structure';
import * as api from './api';

type Props = {
  onSql:(sql:string)=>void; readOnly?:boolean; tab: WorkspaceTab; database: string; session: string; engine: Engine; revision: number; tables: Table[];
  onFilter: (value: string) => void; onRefresh: () => void; onSchema: (schema: string) => void; onErd: (schema: string) => void;
  onDetails: (table: Table) => void; onData: (table: Table) => void; onQuery: (table: Table) => void;
  onChanged: (plan: StructurePlan) => Promise<void>; changeBlocked: (table: Table) => boolean;
  tableMenu: (table: Table) => MenuItem[]; menuFor: (items: MenuItem[]) => HTMLAttributes<HTMLElement>;
};
const size = (bytes?: number|null) => bytes == null ? '—' : bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${(bytes/1024).toFixed(1)} KB`;
export function ObjectPage({ onSql, readOnly, tab, database, session, engine, revision, tables, onFilter, onRefresh, onSchema, onErd, onDetails, onData, onQuery, onChanged, changeBlocked, tableMenu, menuFor }: Props) {
  const {t,language}=useLanguage(),schema=tab.kind==='schema';
  const [metadata,setMetadata]=useState<SchemaInfo|null>(null),[objects,setObjects]=useState<TableObjects|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [actionTarget,setActionTarget]=useState<HTMLDivElement|null>(null);
  const [version,setVersion]=useState(0),[section,setSection]=useState(schema?'tables':'columns'),[action,setAction]=useState<StructureAction|null>(null);
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
    if(readOnly){setError(t('읽기 전용 연결입니다. 구조를 변경할 수 없습니다.'));return;}
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
  const properties = <dl className="object-properties">
        <div><dt>{engine==='postgres'?t('DB 인코딩'):'Charset'}</dt><dd>{(engine==='postgres'?metadata?.info.charset:info?.charset)??'—'}</dd></div>
        <div><dt>{engine==='postgres'?t('DB Collation'):'Collation'}</dt><dd>{(engine==='postgres'?metadata?.info.collation:info?.collation)??'—'}</dd></div>
        <div><dt>{t('소유자')}</dt><dd>{info?.owner??'—'}</dd></div>
        {!schema&&<><div><dt>{t('엔진')}</dt><dd>{tableMeta?.engine??'—'}</dd></div><div><dt>{t('추정 행 수')}</dt><dd>{tableMeta?.estimatedRows?.toLocaleString()??'—'}</dd></div><div><dt>{t('크기')}</dt><dd>{size(tableMeta?.sizeBytes)}</dd></div></>}
        <div className="object-comment"><dt>{t('설명')}</dt><dd>{info?.comment||'—'}{!schema&&engine!=='sqlite'&&<Button variant="outline" size="xs" className="object-comment-edit" aria-label={language==='ko'?'설명 수정':'Edit comment'} title={readOnly?t('읽기 전용 연결'):undefined} disabled={busy||!tableMeta||readOnly} onClick={()=>tableMeta&&openAction({kind:'alterTable',table:tableMeta,info:tableMeta,focus:'comment'})}><Pencil size={12}/>{language==='ko'?'수정':'Edit'}</Button>}</dd></div>
      </dl>;
  return <section className="object-page compact-object-page" role="tabpanel" id="query-panel" aria-labelledby={`tab-${tab.id}`} aria-busy={busy}>
    <header className="object-heading">
      <div className="object-title"><div>{schema?<Layers3 size={24}/>:<Table2 size={24}/>}<h1>{schema?tab.objectSchema:tab.selected?.name}</h1></div>
        <div className="object-actions">
          <Button variant="outline" size="sm" onClick={()=>onErd(tab.objectSchema)}>{t('ERD 열기')}</Button>
          <Button variant="outline" size="icon-sm" aria-label={t('상세 새로고침')} disabled={busy} onClick={()=>{setVersion(value=>value+1);onRefresh();}}><RefreshCw size={16} className={busy?'spin':''}/></Button>
        </div>
      </div>
    </header>
    <div className="object-section-bar">
      <div className="object-subtabs" role="tablist" aria-label={schema?(language==='ko'?'스키마 정보':'Schema information'):t('테이블 정보')}>
        {(schema?['details','tables','views','routines','triggers']:['details','columns','indexes','constraints','views','routines','triggers','ddl']).map(value=>{
          const labels:Record<string,string[]>= {details:['상세','Details'],tables:['테이블','Tables'],columns:['컬럼','Columns'],indexes:['인덱스','Indexes'],constraints:['제약조건','Constraints'],views:['뷰','Views'],routines:['루틴','Routines'],triggers:['트리거','Triggers'],ddl:['DDL','DDL']};
          const count=value==='tables'?allTables.length:value==='columns'?tab.details.length:value==='indexes'||value==='constraints'?objects?.[value].length:undefined;
          return <Button variant="ghost" size="bare" key={value} id={'object-tab-'+tab.id+'-'+value} role="tab" aria-controls={'object-content-'+tab.id} aria-selected={section===value} onClick={()=>setSection(value)}>{labels[value][language==='ko'?0:1]}{count!==undefined&&<span>{count}</span>}</Button>;
        })}
      </div>
      <div className="object-actions object-section-actions">
        <div className="object-definition-actions" ref={setActionTarget}/>
          {!schema&&tab.selected&&<><Button variant="outline" size="sm" onClick={()=>onData(tab.selected!)}>{t('데이터 보기')}</Button><Button variant="outline" size="sm" onClick={()=>onQuery(tab.selected!)}>{t('SELECT 쿼리 열기')}</Button></>}
          {!schema&&<Button variant="outline" size="sm" aria-label={t('테이블 수정')} title={readOnly?t('읽기 전용 연결'):undefined} disabled={busy||!tableMeta||readOnly} onClick={()=>tableMeta&&alterTable(tableMeta)}><Pencil size={14}/>{t('테이블 수정')}</Button>}
        {schema?section==='tables'&&<Button variant="default" size="sm" title={readOnly?t('읽기 전용 연결'):undefined} disabled={busy||!metadata||readOnly} onClick={()=>openAction({kind:'createTable',table:{schema:tab.objectSchema,name:''}})}><Plus size={14}/>{t('테이블 추가')}</Button>
          :<>
            {section==='columns'&&<Button variant="default" size="sm" title={readOnly?t('읽기 전용 연결'):undefined} disabled={busy||!tab.loaded||readOnly} onClick={()=>tab.selected&&openAction({kind:'addColumn',table:tab.selected})}><Plus size={14}/>{t('컬럼 추가')}</Button>}{(section==='indexes'||section==='constraints')&&<StructureTools constraintsOnly session={session} engine={engine} schema={tab.objectSchema} table={tab.selected} objects={objects} readOnly={readOnly} onSql={onSql} onChanged={()=>{setVersion(v=>v+1);onRefresh();}}/>}</>}
          {!schema&&<><span className="action-separator" aria-hidden="true"/><Button variant="ghost" size="sm" className="danger-text" title={readOnly?t('읽기 전용 연결'):undefined} disabled={busy||!tableMeta||readOnly} onClick={()=>tableMeta&&dropTable(tableMeta)}><Trash2 size={14}/>{t('테이블 삭제')}</Button></>}
      </div>
    </div>
    {(section==='tables'||section==='columns')&&<div className="object-search-row"><label className="search-field"><Search size={14}/><Input aria-label={t(schema?'스키마 내 테이블 검색':'컬럼 검색')} placeholder={t('검색')} value={tab.filter} onChange={e=>onFilter(e.target.value)}/></label></div>}
    {(error||tab.error)&&<div className="error-banner" role="alert">{error||tab.error}</div>}
    <div className="object-table-scroll" role="tabpanel" id={'object-content-'+tab.id} aria-labelledby={'object-tab-'+tab.id+'-'+section}>
      {section==='details'?<>{!schema&&<div className="object-path"><Database size={13}/>{database}<span>/</span>{schema?tab.objectSchema:<Button variant="ghost" size="bare" onClick={()=>onSchema(tab.objectSchema)}>{tab.objectSchema}</Button>}</div>}{properties}</>:['views','routines','triggers','ddl'].includes(section)?<ObjectDefinitions key={tab.id+section+version+':'+revision} session={session} engine={engine} schema={tab.objectSchema} table={tab.selected} section={section} actionTarget={actionTarget} onSql={onSql}/>:<>
      {schema?<table className="object-table"><thead><tr>{['이름','엔진','Charset','Collation','추정 행 수','크기','설명',''].map((label,i)=><th key={i}>{t(label)}</th>)}</tr></thead>
        <tbody>{shown.map(table=><tr key={table.name} onDoubleClick={()=>onDetails(table)} {...menuFor([...tableMenu(table),{label:t('테이블 수정'),action:()=>alterTable(table),disabled:busy||!metadata||readOnly,divider:true},{label:t('테이블 삭제'),action:()=>dropTable(table),disabled:busy||!metadata||readOnly}])}>
          <td><Button variant="ghost" size="bare" className="object-name" onClick={()=>onDetails(table)}><Table2 size={15}/>{table.name}</Button></td>
          <td>{table.engine??'—'}</td><td>{table.charset??'—'}</td><td>{table.collation??'—'}</td><td>{table.estimatedRows?.toLocaleString()??'—'}</td><td>{size(table.sizeBytes)}</td><td>{table.comment||'—'}</td>
          <td className="object-row-actions"><Button variant="outline" size="sm" onClick={()=>onDetails(table)}>{t('테이블 상세')}</Button><Button variant="outline" size="sm" onClick={()=>onData(table)}>{t('데이터 보기')}</Button><Button variant="outline" size="sm" className="row-icon-action" aria-label={t('테이블 수정')+': '+table.name} title={readOnly?t('읽기 전용 연결'):t('테이블 수정')} disabled={busy||!metadata||readOnly} onClick={()=>alterTable(table)}><Pencil size={13}/></Button><Button variant="outline" size="sm" className="row-icon-action danger-text" aria-label={t('테이블 삭제')+': '+table.name} title={readOnly?t('읽기 전용 연결'):t('테이블 삭제')} disabled={busy||!metadata||readOnly} onClick={()=>dropTable(table)}><Trash2 size={13}/></Button></td>
        </tr>)}</tbody></table>:section==='columns'?<table className="object-table"><thead><tr>{['이름','자료형','기본키','NULL 허용','기본값','Charset','Collation','추가 속성','설명',''].map((label,i)=><th key={i}>{t(label)}</th>)}</tr></thead>
        <tbody>{columns.map(column=><tr key={column.name} {...menuFor([{label:t('컬럼 수정'),action:()=>tab.selected&&openAction({kind:'alterColumn',table:tab.selected,column}),disabled:busy||readOnly},{label:t('컬럼 삭제'),action:()=>tab.selected&&openAction({kind:'dropColumn',table:tab.selected,column}),disabled:busy||readOnly}])}>
          <td><span className="column-name">{column.primary&&<KeyRound size={13}/>}<strong>{column.name}</strong></span></td>
          <td><code>{column.dataType}</code></td><td>{column.primary?'PK':'—'}</td><td>{t(column.nullable?'허용':'허용 안 함')}</td><td><code>{column.defaultValue??'—'}</code></td>
          <td>{column.charset??'—'}</td><td>{column.collation??'—'}</td><td>{column.extra||'—'}</td><td>{column.comment||'—'}</td>
          <td className="object-row-actions"><Button variant="outline" size="sm" className="row-icon-action" aria-label={t('컬럼 수정')+': '+column.name} title={readOnly?t('읽기 전용 연결'):t('컬럼 수정')} disabled={busy||readOnly} onClick={()=>tab.selected&&openAction({kind:'alterColumn',table:tab.selected,column})}><Pencil size={13}/></Button><Button variant="outline" size="sm" className="row-icon-action danger-text" aria-label={t('컬럼 삭제')+': '+column.name} title={readOnly?t('읽기 전용 연결'):t('컬럼 삭제')} disabled={busy||readOnly} onClick={()=>tab.selected&&openAction({kind:'dropColumn',table:tab.selected,column})}><Trash2 size={13}/></Button></td>
        </tr>)}</tbody></table>:<table className="object-table"><thead><tr><th>{t('이름')}</th><th>{t('정의')}</th></tr></thead><tbody>{objects?.[section as 'indexes'|'constraints'].map(item=><tr key={item.name}><td>{item.name}</td><td><code className="object-definition">{item.definition}</code></td></tr>)}</tbody></table>}
      {(schema?!shown.length:section==='columns'?!columns.length:!objects?.[section as 'indexes'|'constraints'].length)&&<div className="object-empty">{t(busy?'데이터를 불러오는 중...':error?'정보를 불러오지 못했습니다.':'일치하는 결과가 없습니다.')}</div>}
    </>}
    </div>
    {action&&<StructureDialog key={action.kind+action.column?.name} action={action} session={session} engine={engine} onClose={()=>setAction(null)} onApplied={plan=>void applied(plan)}/>}
  </section>;
}
