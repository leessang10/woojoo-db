import {useState} from 'react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {NativeSelect as Select,NativeSelectOption as Option} from './components/ui/native-select';
import {ModalSurface} from './components/ModalSurface';
import {useLanguage} from './i18n';
import {tableId,type ErdDocument,type Relation} from './erd-model';
import type {ErdChange,ErdColumnDraft} from './erd-changes';
import {supportedType} from './structure';
export type ErdEditor={kind:'table'|'column'|'index'|'relation';tableId?:string;column?:string;targetId?:string;targetColumn?:string;position?:{x:number;y:number}};
const newColumn=():ErdColumnDraft=>({name:'',dataType:'text',nullable:true,primary:false});
export function ErdChangeDialog({editor,document,readOnly,onClose,onStage,onVirtual}:{editor:ErdEditor;document:ErdDocument;readOnly:boolean;onClose:()=>void;onStage:(change:ErdChange)=>void;onVirtual:(relation:Relation)=>void}){
 const {language}=useLanguage(),tr=(ko:string,en:string)=>language==='ko'?ko:en;
 const [name,setName]=useState(''),[columns,setColumns]=useState<ErdColumnDraft[]>(editor.kind==='table'?[{name:'id',dataType:'integer',nullable:false,primary:true}]:[newColumn()]);
 const [source,setSource]=useState(editor.tableId??tableId(document.schema.tables[0]?.table??{schema:'',name:''})),[target,setTarget]=useState(editor.targetId??tableId(document.schema.tables[1]?.table??document.schema.tables[0]?.table??{schema:'',name:''}));
 const [sourceColumns,setSourceColumns]=useState<string[]>(editor.column?[editor.column]:[]),[targetColumns,setTargetColumns]=useState<string[]>(editor.targetColumn?[editor.targetColumn]:[]);
 const [physical,setPhysical]=useState(!readOnly),[unique,setUnique]=useState(false),[error,setError]=useState('');
 const sourceTable=document.schema.tables.find(t=>tableId(t.table)===source),targetTable=document.schema.tables.find(t=>tableId(t.table)===target);
 const title=editor.kind==='table'?tr('테이블 추가','Add table'):editor.kind==='column'?tr('컬럼 추가','Add column'):editor.kind==='index'?tr('인덱스 추가','Add index'):tr('관계 추가','Add relationship');
 function submit(){try{
  if((editor.kind!=='relation'||physical)&&readOnly)throw new Error(tr('읽기 전용 연결입니다.','This connection is read only.'));
  const id=crypto.randomUUID();
  if(editor.kind==='relation'){
   if(!sourceTable||!targetTable||!sourceColumns.length||sourceColumns.length!==targetColumns.length)throw new Error(tr('연결할 컬럼을 같은 개수로 선택하세요.','Choose the same number of columns on each side.'));
   if(physical){if(!name.trim())throw new Error(tr('FK 이름을 입력하세요.','Enter a foreign key name.'));onStage({id,kind:'addForeignKey',table:sourceTable.table,target:targetTable.table,name:name.trim(),columns:sourceColumns,targetColumns});}
   else onVirtual({id:'custom-'+id,source,target,sourceColumns,targetColumns,label:name.trim(),color:'#7d8fa8',path:'smoothstep',arrow:'end',dashed:true,custom:true});
  }else if(editor.kind==='index'){
   if(!sourceTable||!name.trim()||!sourceColumns.length)throw new Error(tr('인덱스 이름과 컬럼을 입력하세요.','Enter an index name and select columns.'));
   onStage({id,kind:'addIndex',table:sourceTable.table,name:name.trim(),columns:sourceColumns,unique});
  }else{
   if(columns.some(c=>!c.name.trim()||!supportedType(c.dataType)))throw new Error(tr('컬럼 이름과 지원되는 자료형을 입력하세요.','Enter column names and supported data types.'));
   if(new Set(columns.map(c=>c.name.trim().toLowerCase())).size!==columns.length)throw new Error(tr('컬럼 이름이 중복됩니다.','Duplicate column names.'));
   if(editor.kind==='table'){
    if(!name.trim())throw new Error(tr('테이블 이름을 입력하세요.','Enter a table name.'));
    const table={schema:editor.tableId??document.schema.tables[0]?.table.schema??'main',name:name.trim()};
    if(document.schema.tables.some(t=>tableId(t.table)===tableId(table)))throw new Error(tr('같은 이름의 테이블이 있습니다.','A table with this name exists.'));
    onStage({id,kind:'createTable',table,columns:columns.map(c=>({...c,name:c.name.trim()}))});
   }else{if(!sourceTable)throw new Error('Select a table');if(sourceTable.columns.some(c=>c.name===columns[0].name.trim()))throw new Error(tr('같은 이름의 컬럼이 있습니다.','A column with this name exists.'));onStage({id,kind:'addColumn',table:sourceTable.table,column:{...columns[0],name:columns[0].name.trim()}});}
  }
  onClose();
 }catch(e){setError(String(e));}}
 const selectColumns=(side:'source'|'target')=>{const values=side==='source'?sourceColumns:targetColumns,set=side==='source'?setSourceColumns:setTargetColumns,table=side==='source'?sourceTable:targetTable;return <label>{side==='source'?tr('시작 컬럼','Source columns'):tr('대상 컬럼','Target columns')}<Select multiple aria-label={side==='source'?tr('시작 컬럼','Source columns'):tr('대상 컬럼','Target columns')} value={values} onChange={e=>set([...e.target.selectedOptions].map(o=>o.value))}>{table?.columns.map(c=><Option key={c.name} value={c.name}>{c.name}</Option>)}</Select></label>;};
 return <ModalSurface title={title} onClose={onClose}><form className="modal erd-change-modal" role="dialog" aria-label={title} onSubmit={e=>{e.preventDefault();submit();}}><div className="modal-heading"><h2>{title}</h2></div>
 {editor.kind!=='column'&&<label>{tr('이름','Name')}<Input autoFocus value={name} onChange={e=>setName(e.target.value)}/></label>}
 {editor.kind==='relation'&&<><label>{tr('관계 종류','Relationship type')}<Select value={physical?'physical':'virtual'} onChange={e=>setPhysical(e.target.value==='physical')}><Option value="physical" disabled={readOnly}>{tr('물리 FK · 커밋 시 DB에 적용','Physical FK · apply on commit')}</Option><Option value="virtual">{tr('가상 관계 · 다이어그램에 저장','Virtual relationship · diagram only')}</Option></Select></label><div className="erd-change-grid">{(['source','target'] as const).map(side=><div key={side}><label>{side==='source'?tr('시작 테이블','Source table'):tr('대상 테이블','Target table')}<Select value={side==='source'?source:target} onChange={e=>{if(side==='source'){setSource(e.target.value);setSourceColumns([]);}else{setTarget(e.target.value);setTargetColumns([]);}}}>{document.schema.tables.map(t=><Option key={tableId(t.table)} value={tableId(t.table)}>{t.table.schema}.{t.table.name}</Option>)}</Select></label>{selectColumns(side)}</div>)}</div></>}
 {editor.kind==='index'&&<>{selectColumns('source')}<label className="erd-checkbox"><Input type="checkbox" checked={unique} onChange={e=>setUnique(e.target.checked)}/>{tr('고유 인덱스','Unique index')}</label></>}
 {(editor.kind==='table'||editor.kind==='column')&&<><div className="erd-column-drafts">{columns.map((c,index)=><div className="erd-column-draft" key={index}><label>{tr('컬럼 이름','Column name')}<Input aria-label={tr('컬럼 이름','Column name')+' '+(index+1)} value={c.name} onChange={e=>setColumns(cols=>cols.map((x,i)=>i===index?{...x,name:e.target.value}:x))}/></label><label>{tr('자료형','Data type')}<Input aria-label={tr('자료형','Data type')+' '+(index+1)} value={c.dataType} onChange={e=>setColumns(cols=>cols.map((x,i)=>i===index?{...x,dataType:e.target.value}:x))}/></label><label className="erd-checkbox"><Input type="checkbox" checked={c.primary} onChange={e=>setColumns(cols=>cols.map((x,i)=>i===index?{...x,primary:e.target.checked,nullable:e.target.checked?false:x.nullable}:x))}/>PK</label><label className="erd-checkbox"><Input type="checkbox" checked={c.nullable} disabled={c.primary} onChange={e=>setColumns(cols=>cols.map((x,i)=>i===index?{...x,nullable:e.target.checked}:x))}/>NULL</label>{columns.length>1&&<Button type="button" variant="ghost" size="sm" onClick={()=>setColumns(cols=>cols.filter((_,i)=>i!==index))}>{tr('삭제','Remove')}</Button>}</div>)}</div>{editor.kind==='table'&&<Button type="button" variant="outline" size="sm" onClick={()=>setColumns(c=>[...c,newColumn()])}>{tr('컬럼 추가','Add column')}</Button>}</>}
 {error&&<p role="alert" className="dialog-error">{error}</p>}
 <div className="modal-actions"><Button type="button" variant="outline" onClick={onClose}>{tr('취소','Cancel')}</Button><Button type="submit">{editor.kind==='relation'&&!physical?tr('관계 추가','Add relationship'):tr('변경 대기열에 추가','Stage change')}</Button></div>
 </form></ModalSurface>;
}
