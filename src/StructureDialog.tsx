import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ModalSurface } from "@/components/ModalSurface";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useLanguage } from './i18n';
import type { ColumnDetail, Engine, Table, TableInfo } from './model';
import { columnDraft, commonTypes, planStructure, type ColumnDraft, type StructureChange, type StructurePlan } from './structure';
import * as api from './api';

export type StructureAction = { kind: StructureChange['kind']; table: Table; column?: ColumnDetail; info?: TableInfo };
export function StructureDialog({ action, session, engine, onClose, onApplied }: { action: StructureAction; session: string; engine: Engine; onClose: () => void; onApplied: (plan: StructurePlan) => void }) {
  const {t}=useLanguage();
  const pg=engine==='postgres', create=action.kind==='createTable', tableAction=['createTable','alterTable','dropTable'].includes(action.kind), dropping=action.kind.startsWith('drop');
  const titles={createTable:'테이블 추가',alterTable:'테이블 변경',dropTable:'테이블 삭제',addColumn:'컬럼 추가',alterColumn:'컬럼 변경',dropColumn:'컬럼 삭제'};
  const [name,setName]=useState(create?'':action.table.name),[charset,setCharset]=useState(action.info?.charset??''),[collation,setCollation]=useState(action.info?.collation??''),[comment,setComment]=useState(action.info?.comment??'');
  const [columns,setColumns]=useState<ColumnDraft[]>([create?{...columnDraft(),name:'id',dataType:'bigint',nullable:false,primary:true}:columnDraft(action.column)]);
  const [plan,setPlan]=useState<StructurePlan|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[confirmation,setConfirmation]=useState('');
  const ref=useRef<HTMLDivElement>(null), closing=useRef(onClose), busy=useRef(pending);closing.current=onClose;busy.current=pending;
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!busy.current)closing.current();}
      if((event.ctrlKey||event.metaKey)&&['Enter','b',','].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();}
    };
    window.addEventListener('keydown',key,true);
    return()=>{window.removeEventListener('keydown',key,true);};
  },[]);
  const changeColumn=(index:number,value:Partial<ColumnDraft>)=>{setPlan(null);setColumns(previous=>previous.map((column,i)=>i===index?{...column,...value}:column));};
  async function preview(){
    setError('');setPending(true);
    try{
      const current=create?[]:await api.describeTable(session,action.table);
      const original=action.column?current.find(column=>column.name===action.column!.name):undefined;
      if(action.column&&!original)throw new Error(t('컬럼이 삭제되었습니다. 새로고침하세요.'));
      // Do not silently overwrite changes made since the edit form was opened.
      if(action.column&&JSON.stringify(original)!==JSON.stringify(action.column))throw new Error(t('테이블 구조가 변경되었습니다. 새로고침한 뒤 다시 검토하세요.'));
      const change:StructureChange={kind:action.kind,table:create?{...action.table,name}:action.table,name,charset,collation,comment,columns,original};
      setPlan(planStructure(engine,change,current));
    }catch(reason){setError(String(reason));}
    finally{setPending(false);}
  }
  async function apply(){
    if(!plan)return;setError('');setPending(true);
    try{await api.applyStructure(session,plan);onApplied(plan);}
    catch(reason){setError(String(reason));setPlan(null);setPending(false);}
  }
  const confirmName=action.column? action.column.name:`${action.table.schema}.${action.table.name}`;
  return <ModalSurface title={t(titles[action.kind])} onClose={onClose} locked={pending}><div ref={ref} className="modal structure-modal" role="dialog" aria-modal="true" aria-label={t(titles[action.kind])}>
    <div className="modal-heading"><h2>{t(titles[action.kind])}</h2><Button variant="ghost" size="bare" disabled={pending} onClick={onClose} aria-label={t('닫기')}><X size={20}/></Button></div>
    <p className="structure-target">{action.table.schema}{create?'':`.${action.table.name}`}{action.column?`.${action.column.name}`:''}</p>
    <fieldset disabled={pending} onChange={()=>setPlan(null)}>
      {tableAction&&!dropping&&<><label>{t('테이블 이름')}<Input aria-label={t('테이블 이름')} value={name} onChange={e=>setName(e.target.value)}/></label>
        {!pg&&<div className="form-row"><label>Charset<Input aria-label="Charset" value={charset} onChange={e=>setCharset(e.target.value)} placeholder="utf8mb4"/></label><label>Collation<Input aria-label="Collation" value={collation} onChange={e=>setCollation(e.target.value)} placeholder={t('DB 기본값')}/></label></div>}
        <label>{t('설명')}<Input aria-label={t('설명')} value={comment} onChange={e=>setComment(e.target.value)}/></label>
        {!pg&&action.kind==='alterTable'&&<p className="structure-note">{t('기본 charset 변경은 기존 컬럼의 문자셋을 변환하지 않습니다.')}</p>}
      </>}
      {!dropping&&(create||!tableAction)&&<><datalist id="column-types">{commonTypes.map(type=><NativeSelectOption key={type} value={type}/>)}</datalist>
        {columns.map((column,index)=><div className="column-draft" key={index}>
          <div className="column-draft-heading"><strong>{t('컬럼')} {index+1}</strong>{create&&columns.length>1&&<Button variant="ghost" size="bare" aria-label={t('입력 컬럼 제거')} onClick={()=>{setPlan(null);setColumns(previous=>previous.filter((_,i)=>i!==index));}}><X size={14}/></Button>}</div>
          <div className="form-row"><label>{t('컬럼 이름')}<Input aria-label={`${t('컬럼 이름')} ${index+1}`} value={column.name} onChange={e=>changeColumn(index,{name:e.target.value})}/></label>
            <label>{t('자료형')}<Input aria-label={`${t('자료형')} ${index+1}`} list="column-types" value={column.dataType} onChange={e=>changeColumn(index,{dataType:e.target.value})}/></label></div>
          <div className="column-flags"><label className="checkbox-label"><Input type="checkbox" disabled={action.kind==='alterColumn'} checked={column.primary} onChange={e=>changeColumn(index,{primary:e.target.checked,nullable:e.target.checked?false:column.nullable})}/>PK</label>
            <label className="checkbox-label"><Input type="checkbox" disabled={column.primary} checked={column.nullable} onChange={e=>changeColumn(index,{nullable:e.target.checked})}/>{t('NULL 허용')}</label></div>
          {!pg&&<div className="form-row"><label>Charset<Input aria-label={`Charset ${index+1}`} value={column.charset} onChange={e=>changeColumn(index,{charset:e.target.value})}/></label><label>Collation<Input aria-label={`Collation ${index+1}`} value={column.collation} onChange={e=>changeColumn(index,{collation:e.target.value})}/></label></div>}
          <div className="form-row"><label>{t('기본값 방식')}<NativeSelect size="sm" aria-label={`${t('기본값 방식')} ${index+1}`} value={column.defaultMode} onChange={e=>changeColumn(index,{defaultMode:e.target.value as ColumnDraft['defaultMode']})}>
            {action.kind==='alterColumn'&&<NativeSelectOption value="keep">{t('기존 값 유지')}</NativeSelectOption>}<NativeSelectOption value="none">{t('없음')}</NativeSelectOption><NativeSelectOption value="literal">{t('고정 값')}</NativeSelectOption><NativeSelectOption value="expression">{t('표현식')}</NativeSelectOption>
          </NativeSelect></label><label>{t('기본값')}<Input aria-label={`${t('기본값')} ${index+1}`} disabled={['none','keep'].includes(column.defaultMode)} value={column.defaultValue} onChange={e=>changeColumn(index,{defaultValue:e.target.value})}/></label></div>
          <label>{t('설명')}<Input aria-label={`${t('컬럼 설명')} ${index+1}`} value={column.comment} onChange={e=>changeColumn(index,{comment:e.target.value})}/></label>
        </div>)}
        {create&&<Button variant="outline" size="sm" className="secondary-button" onClick={()=>{setPlan(null);setColumns(previous=>[...previous,columnDraft()]);}}><Plus size={14}/>{t('컬럼 추가')}</Button>}
      </>}
    </fieldset>
    {dropping&&<p className="structure-warning">{t('삭제하면 데이터가 제거됩니다. 이 작업은 앱에서 되돌릴 수 없습니다.')}</p>}
    {session==='demo'?<p className="structure-note">{t('데모 구조만 변경되며 앱을 다시 열면 초기화됩니다.')}</p>:!pg&&<p className="structure-note">{t('MySQL/MariaDB 구조 변경은 자동 커밋되며 롤백할 수 없습니다.')}</p>}
    {plan&&<><pre className="ddl-preview" aria-label={t('실행 SQL')}>{plan.sqls.join(';\n\n')+';'}</pre>
      {dropping&&<label>{t('삭제 대상 이름 입력')}<Input aria-label={t('삭제 대상 이름 입력')} placeholder={confirmName} value={confirmation} disabled={pending} onChange={e=>setConfirmation(e.target.value)}/></label>}</>}
    {error&&<p role="alert" className="dialog-error">{error}</p>}
    <div className="modal-actions"><Button variant="outline" size="sm" className="secondary-button" disabled={pending} onClick={onClose}>{t('취소')}</Button>
      {plan?<Button variant="default" size="sm" className="primary-button" disabled={pending||(dropping&&confirmation!==confirmName)} onClick={()=>void apply()}>{t(pending?'적용 중...':'구조 변경 적용')}</Button>
        :<Button variant="default" size="sm" className="primary-button" disabled={pending} onClick={()=>void preview()}>{t(pending?'처리 중…':'SQL 검토')}</Button>}
    </div>
  </div></ModalSurface>;
}
