import { invoke } from '@tauri-apps/api/core';
import { desktop } from './api';
import { ModalSurface } from './components/ModalSurface';
import { ContextMenu, type MenuState, type MenuItem } from './ContextMenu';
import { useConfirm } from './components/ConfirmProvider';
import { ErdChangeDialog, type ErdEditor } from './ErdChangeDialog';
import { rebaseErd, stageErd, type ErdChange, type ErdPlan, type ErdApplyResult } from './erd-changes';
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, NodeResizeControl, NodeToolbar, Background, Controls, MiniMap, Handle, Position, MarkerType, BaseEdge, getBezierPath, getStraightPath, getSmoothStepPath, useReactFlow, useUpdateNodeInternals, type EdgeProps, type Node, type NodeProps, type Connection } from '@xyflow/react';
import { Download, GitBranch, LayoutGrid, RefreshCw, Undo2, Redo2, X } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './erd.css';
import { useLanguage } from './i18n';
import { readErd } from './api';
import { arrange, readSavedErd, tableId, visibleColumns, type ColumnMode, type ErdDocument, type ErdTable, type Relation, type TableStyle } from './erd-model';
import type { Theme } from './theme';

type TableNodeData = { onStyle:(style:Partial<TableStyle>,record?:boolean)=>void; onAdd:(kind:'column'|'index')=>void; readOnly:boolean; disabled:boolean; labels:{color:string;column:string;index:string;width:string}; pending:number; table: ErdTable; columns: ErdTable['columns']; foreignColumns: string[]; style: TableStyle; emptyLabel: string };
type TableNode = Node<TableNodeData, 'table'>;
function ErdTableNode({ id, data, selected }: NodeProps<TableNode>) {
  const { table, columns, style } = data;
  const updateInternals=useUpdateNodeInternals();
  const columnKey=columns.map(c=>c.name).join("\0");
  useEffect(()=>{updateInternals(id);},[id,columnKey,style.width,updateInternals]);
  const rgb = style.color.match(/\w\w/g)!.map(v => parseInt(v, 16));
  const contrast = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 155 ? '#17202c' : '#fff';
  return <div className={`erd-table-node ${style.shape} ${selected ? 'is-selected' : ''}`} style={{ width: style.width, borderColor: style.color }}>
    {selected&&!data.disabled&&<><NodeResizeControl position="right" resizeDirection="horizontal" minWidth={220} maxWidth={520} onResizeStart={()=>data.onStyle({})} onResize={(_,params)=>data.onStyle({width:Math.round(params.width)},false)}><span aria-label={data.labels.width}>↔</span></NodeResizeControl><NodeToolbar className="erd-node-toolbar" position={Position.Top}><label title={data.labels.color}><Input type="color" aria-label={data.labels.color} value={style.color} onChange={e=>data.onStyle({color:e.target.value})}/></label><Button size="sm" variant="outline" disabled={data.readOnly} onClick={()=>data.onAdd('column')}>{data.labels.column}</Button><Button size="sm" variant="outline" disabled={data.readOnly} onClick={()=>data.onAdd('index')}>{data.labels.index}</Button></NodeToolbar></>}
    <header style={{ background: style.color, color: contrast }}>
      <Handle type="target" position={Position.Left} id="in"/>
      <small>{table.table.schema}{data.pending>0&&<span className="erd-pending-badge">+{data.pending}</span>}</small><strong>{table.table.name}</strong>
      <Handle type="source" position={Position.Right} id="out"/>
    </header>
    <div className="erd-columns">{columns.map(column => <div key={column.name} className="erd-column" data-column={column.name}><Handle type="target" position={Position.Left} id={`in:${encodeURIComponent(column.name)}`} aria-label={`${table.table.name}.${column.name} target`}/><Handle type="source" position={Position.Right} id={`out:${encodeURIComponent(column.name)}`} aria-label={`${table.table.name}.${column.name} source`}/>
      <span className="erd-key">{column.primary ? 'PK' : ''}{data.foreignColumns.includes(column.name) ? ' FK' : ''}</span>
      <span title={column.name}>{column.name}</span><code title={column.dataType}>{column.dataType}</code>
    </div>)}
    {!columns.length && <p className="erd-no-columns">{data.emptyLabel}</p>}</div>
  </div>;
}
const nodeTypes = { table: ErdTableNode };
function RelationshipEdge(props: EdgeProps) {
  const shape = props.data?.shape;
  const [path, labelX, labelY] = shape === 'straight' ? getStraightPath(props) : shape === 'default' ? getBezierPath(props) : getSmoothStepPath(props);
  return <BaseEdge path={path} labelX={labelX} labelY={labelY + Number(props.data?.labelOffset ?? 0)}
    label={props.label} style={props.style} markerStart={props.markerStart} markerEnd={props.markerEnd}
    labelStyle={props.labelStyle} labelBgStyle={props.labelBgStyle}/>;
}
const edgeTypes = { relationship: RelationshipEdge };
type Props = { readOnly?:boolean; canApply?:()=>boolean; onApplied?:()=>void; onBusyChange?:(busy:boolean)=>void; session: string; schema: string; storageKey: string; initial: ErdDocument | null; onChange: (document: ErdDocument) => void; theme: Theme };
export default function ErdPage(props: Props) { return <ReactFlowProvider><ErdCanvas {...props}/></ReactFlowProvider>; }

function ErdCanvas({ session, schema, storageKey, initial, onChange, theme, readOnly=false, canApply, onApplied, onBusyChange }: Props) {
  const { t, language } = useLanguage();
  const tr=(ko:string,en:string)=>language==='ko'?ko:en;
  const {requestConfirm}=useConfirm();
  const [editor,setEditor]=useState<ErdEditor|null>(null);
  const [menu,setMenu]=useState<MenuState|null>(null);
  const [plan,setPlan]=useState<ErdPlan|null>(null);
  const [applying,setApplying]=useState(false);
  const applyCallback=useRef(onBusyChange);applyCallback.current=onBusyChange;
  useEffect(()=>{applyCallback.current?.(applying);return()=>{applyCallback.current?.(false);};},[applying]);
  const [document, setDocument] = useState<ErdDocument | null>(initial);
  const documentRef = useRef(document); documentRef.current = document;
  const callback = useRef(onChange); callback.current = onChange;
  const [busy, setBusy] = useState(!initial);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(true);
  const [selected, setSelected] = useState('');
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [message, setMessage] = useState('');
  const undo = useRef<ErdDocument[]>([]), redo = useRef<ErdDocument[]>([]);
  const [, renderHistory] = useState(0);
  const alive = useRef(true);
  const flow = useReactFlow<TableNode>();
  const root = useRef<HTMLDivElement>(null);
  function commit(next: ErdDocument, record = true) {
    if (record && documentRef.current) {
      undo.current = [...undo.current.slice(-39), documentRef.current];
      redo.current = [];
    }
    documentRef.current = next;
    setDocument(next); callback.current(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(true); } catch { setSaved(false); }
    renderHistory(value => value + 1);
  }
  function fit() { requestAnimationFrame(() => requestAnimationFrame(() => void flow.fitView({ padding: .2, maxZoom: 1 }))); }
  async function refresh() {
    if (busy) return;
    if(documentRef.current?.pending?.length&&!await requestConfirm(tr('미적용 구조 변경을 취소하고 새로고침할까요?','Discard pending schema changes and refresh?')))return;
    setBusy(true); setError('');
    try {
      const data = await readErd(session, schema);
      if (alive.current) { commit(rebaseErd(data, documentRef.current, []));undo.current=[];redo.current=[]; fit(); }
    } catch (reason) { if (alive.current) setError(String(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    if (!initial) {
      readErd(session, schema).then(data => {
        if (!cancelled) { commit(rebaseErd(data, readSavedErd(storageKey)), false); fit(); }
      }).catch(reason => { if (!cancelled) setError(String(reason)); })
        .finally(() => { if (!cancelled) setBusy(false); });
    }
    return () => { cancelled = true; alive.current = false; };
  }, [session, schema, storageKey]);
  function stepHistory(back: boolean) {
    const from = back ? undo : redo, to = back ? redo : undo;
    const next = from.current.pop();
    if (!next || !documentRef.current) return;
    to.current.push(documentRef.current); commit(next, false); setSelected('');
  }
  const nodes: TableNode[] = useMemo(() => document?.schema.tables.map(table => {
    const id = tableId(table.table), style = document.styles[id];
    return { id:encodeURIComponent(id), type: 'table', dragHandle:'header', position: { x: style.x, y: style.y }, measured: sizes[id], selected: selected === id,
      data: { table, style, readOnly, disabled:busy||exporting||applying,
        labels:{color:tr('테이블 색상','Table color'),column:tr('컬럼 추가','Add column'),index:tr('인덱스 추가','Add index'),width:tr('너비 조절','Resize width')},
        pending:(document.pending??[]).filter(op=>tableId(op.table)===id).length,
        onStyle:(change,record=true)=>{const current=documentRef.current;if(current)commit({...current,styles:{...current.styles,[id]:{...current.styles[id],...change}}},record);},
        onAdd:kind=>setEditor({kind,tableId:id}),columns: visibleColumns(table, document.mode, document.schema),
        foreignColumns: document.schema.foreignKeys.filter(key => tableId(key.source) === id).flatMap(key => key.sourceColumns), emptyLabel: t('표시할 키가 없습니다.') } };
  }) ?? [], [document, selected, language, sizes, readOnly,busy,exporting,applying]);
  const edges = useMemo(() => document?.relations.map((edge, index, relations) => ({
    id: edge.id, source: encodeURIComponent(edge.source), target: encodeURIComponent(edge.target), sourceHandle: document.schema.tables.find(t=>tableId(t.table)===edge.source)?.columns.some(c=>c.name===edge.sourceColumns[0]&&visibleColumns(document.schema.tables.find(t=>tableId(t.table)===edge.source)!,document.mode,document.schema).includes(c))?'out:'+encodeURIComponent(edge.sourceColumns[0]):'out', targetHandle:document.schema.tables.find(t=>tableId(t.table)===edge.target)?.columns.some(c=>c.name===edge.targetColumns[0]&&visibleColumns(document.schema.tables.find(t=>tableId(t.table)===edge.target)!,document.mode,document.schema).includes(c))?'in:'+encodeURIComponent(edge.targetColumns[0]):'in', type: 'relationship',
    data: { shape: edge.path, labelOffset: edge.labelOffset ?? relations.slice(0, index).filter(previous => [previous.source, previous.target].sort().join('|') === [edge.source, edge.target].sort().join('|')).length * 26 },
    label: edge.label, selected: selected === edge.id,
    style: { stroke: edge.color, strokeWidth: 2, strokeDasharray: edge.dashed ? '6 4' : undefined },
    labelStyle: { fill: theme === 'dark' ? '#e2e6ec' : '#252a33', fontSize: 11 },
    labelBgStyle: { fill: theme === 'dark' ? '#20242b' : '#fff' },
    markerEnd: edge.arrow === 'end' || edge.arrow === 'both' ? { type: MarkerType.ArrowClosed, color: edge.color, width: 18, height: 18 } : undefined,
    markerStart: edge.arrow === 'start' || edge.arrow === 'both' ? { type: MarkerType.ArrowClosed, color: edge.color, width: 18, height: 18 } : undefined,
    reconnectable: edge.custom,
  })) ?? [], [document, selected, theme]);
  const chosenTable = document?.schema.tables.find(table => tableId(table.table) === selected);
  const chosenRelation = document?.relations.find(edge => edge.id === selected);
  function updateTable(change: Partial<TableStyle>) {
    if (document && chosenTable) commit({ ...document, styles: { ...document.styles, [selected]: { ...document.styles[selected], ...change } } });
  }
  function updateRelation(change: Partial<Relation>) {
    if (document && chosenRelation) commit({ ...document, relations: document.relations.map(edge => edge.id === selected ? { ...edge, ...change } : edge) });
  }
  function connect(connection: Connection) {
    const current = documentRef.current;
    if (!current || !connection.source || !connection.target) return;
    setEditor({kind:'relation',tableId:decodeURIComponent(connection.source),targetId:decodeURIComponent(connection.target),column:connection.sourceHandle?.startsWith('out:')?decodeURIComponent(connection.sourceHandle.slice(4)):undefined,targetColumn:connection.targetHandle?.startsWith('in:')?decodeURIComponent(connection.targetHandle.slice(3)):undefined});
  }
  function deleteRelation() {
    if (!document || !chosenRelation) return;
    if(document.pending?.some(op=>op.id===selected)){commit(rebaseErd(document.baseSchema??document.schema,document,document.pending.filter(op=>op.id!==selected)));setSelected('');return;}
    commit({ ...document, relations: document.relations.filter(edge => edge.id !== selected),
      hiddenRelations: document.schema.foreignKeys.some(key => key.id === selected) ? [...document.hiddenRelations, selected] : document.hiddenRelations });
    setSelected('');
  }
  async function download(format: 'png' | 'pdf') {
    if (exporting || !nodes.length) return;
    setExporting(true); setError(''); setMessage('');
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const viewport = root.current?.querySelector<HTMLElement>('.react-flow__viewport');
      if (!viewport) throw new Error(t('ERD 캔버스를 찾을 수 없습니다.'));
      const { exportDiagram } = await import('./erd-export');
      const result = await exportDiagram(viewport, flow.getNodes(), format, `${schema}-erd`, theme === 'dark' ? '#181b20' : '#ffffff');
      if (alive.current && result) setMessage(t('내보내기 완료'));
    } catch (reason) { if (alive.current) setError(String(reason)); }
    finally { if (alive.current) setExporting(false); }
  }
  const disabled = busy || exporting || applying;
  const pending=document?.pending??[];
  function stage(change:ErdChange){
    const current=documentRef.current;if(!current||readOnly)return;
    const next=stageErd(current,change),id=tableId(change.table);
    if(change.kind==='createTable')next.styles[id]={...next.styles[id],...(editor?.position??{x:Math.max(0,...Object.values(current.styles).map(s=>s.x+s.width))+80,y:40})};
    commit(next);setSelected(id);if(change.kind==='createTable')fit();
  }
  async function reviewChanges(){
    if(!documentRef.current?.pending?.length||readOnly||applying)return;
    if(canApply&&!canApply()){setError(tr('다른 탭의 실행과 데이터 편집을 먼저 완료하세요.','Finish running operations and data edits in other tabs first.'));return;}
    if(!desktop){setError(tr('DB 커밋은 데스크톱 앱에서 사용할 수 있습니다.','Database commits are available in the desktop app.'));return;}
    setApplying(true);setError('');
    try{setPlan(await invoke<ErdPlan>('erd_plan',{id:session,operations:documentRef.current.pending}));}catch(e){setError(String(e));}finally{setApplying(false);}
  }
  async function applyChanges(){
    const current=documentRef.current;if(!current||!plan||readOnly||applying)return;
    if(canApply&&!canApply()){setError(tr('다른 탭의 실행과 데이터 편집을 먼저 완료하세요.','Finish running operations and data edits in other tabs first.'));setPlan(null);return;}
    setApplying(true);setError('');
    try{
      const result=await invoke<ErdApplyResult>('erd_apply',{id:session,operations:current.pending??[],expectedSnapshot:plan.expectedSnapshot});
      const remaining=(current.pending??[]).slice(result.completed);
      // Remove applied operations before refresh so an unavailable connection cannot cause replay.
      const appliedBase=rebaseErd(current.baseSchema??current.schema,current,(current.pending??[]).slice(0,result.completed)).schema;
      commit(rebaseErd(appliedBase,current,remaining),false);undo.current=[];redo.current=[];setPlan(null);
      try{const data=await readErd(session,schema);commit(rebaseErd(data,documentRef.current,remaining),false);}catch(e){setError(tr('변경은 적용되었지만 새로고침하지 못했습니다: ','Changes were applied but refresh failed: ')+String(e));}
      if(result.error)setError(result.error);
      if(!remaining.length)setMessage(tr('DB 구조 변경을 적용했습니다.','Schema changes applied.'));
      if(result.completed)onApplied?.();
    }catch(e){setError(String(e));setPlan(null);}finally{setApplying(false);}
  }
  function context(event:React.MouseEvent,items:MenuItem[]){event.preventDefault();event.stopPropagation();setMenu({x:event.clientX,y:event.clientY,items,trigger:event.currentTarget as HTMLElement});}
  function tableMenu(id:string,column?:string):MenuItem[]{return [
    {label:tr('컬럼 추가','Add column'),disabled:readOnly||disabled,action:()=>setEditor({kind:'column',tableId:id})},
    {label:tr('인덱스 추가','Add index'),disabled:readOnly||disabled,action:()=>setEditor({kind:'index',tableId:id,column})},
    {label:tr('관계 추가','Add relationship'),disabled:disabled,action:()=>setEditor({kind:'relation',tableId:id,column})},
    ...['#396da8','#388375','#8c62a8','#b67b3c'].map((color,i)=>({label:[tr('파랑','Blue'),tr('초록','Green'),tr('보라','Purple'),tr('주황','Orange')][i],divider:i===0,action:()=>{const current=documentRef.current;if(current)commit({...current,styles:{...current.styles,[id]:{...current.styles[id],color}}});}})),
  ];}
  function relationMenu(id:string):MenuItem[]{return [
    ...(['smoothstep','default','straight'] as const).map((path,i)=>({label:[t('직각선'),t('곡선'),t('직선')][i],action:()=>{const current=documentRef.current;if(current)commit({...current,relations:current.relations.map(r=>r.id===id?{...r,path}:r)});}})),
    {label:tr('점선 전환','Toggle dashed line'),action:()=>{const current=documentRef.current;if(current)commit({...current,relations:current.relations.map(r=>r.id===id?{...r,dashed:!r.dashed}:r)});}},
  ];}
  return <section className={`erd-page ${exporting ? 'erd-exporting' : ''}`} aria-label={`${schema} ERD`} aria-busy={disabled}>
    <div className="erd-toolbar">
      <strong><GitBranch size={16}/>{schema} <span>ERD</span></strong>
      <label>{t('컬럼 표시')}<NativeSelect size="sm" aria-label={t('컬럼 표시')} value={document?.mode ?? 'all'} disabled={!document || disabled} onChange={event => { if (document) commit({ ...document, mode: event.target.value as ColumnMode }); }}>
        <NativeSelectOption value="pk">{t('PK만 보기')}</NativeSelectOption><NativeSelectOption value="keys">{t('PK, FK 보기')}</NativeSelectOption><NativeSelectOption value="all">{t('모든 컬럼 보기')}</NativeSelectOption>
      </NativeSelect></label>
      <Button variant="ghost" size="bare" title={t('자동 배치')} aria-label={t('자동 배치')} disabled={!document || disabled} onClick={() => { if (document) { commit(arrange(document)); fit(); } }}><LayoutGrid size={16}/></Button>
      <Button variant="ghost" size="bare" title={t('화면에 맞추기')} disabled={!nodes.length || disabled} onClick={fit}>{t('전체 보기')}</Button>
      <Button variant="ghost" size="bare" title={t('실행 취소')} aria-label={t('실행 취소')} disabled={!undo.current.length || disabled} onClick={() => stepHistory(true)}><Undo2 size={16}/></Button>
      <Button variant="ghost" size="bare" title={t('다시 실행')} aria-label={t('다시 실행')} disabled={!redo.current.length || disabled} onClick={() => stepHistory(false)}><Redo2 size={16}/></Button>
      <Button variant="ghost" size="bare" title={t('메타데이터 새로고침')} aria-label={t('메타데이터 새로고침')} disabled={disabled} onClick={() => void refresh()}><RefreshCw size={16} className={busy ? 'spin' : ''}/></Button>
      <Button variant="outline" size="sm" disabled={!document||disabled||readOnly} onClick={()=>setEditor({kind:'table',tableId:schema})}>{tr('테이블 추가','Add table')}</Button>
      <Button size="sm" disabled={!pending.length||disabled||readOnly} onClick={()=>void reviewChanges()}>{tr('커밋','Commit')}{pending.length>0?' ('+pending.length+')':''}</Button>
      <span className="tabs-spacer"/>
      <Button variant="ghost" size="bare" disabled={!nodes.length || disabled} onClick={() => void download('png')}><Download size={14}/>PNG</Button>
      <Button variant="ghost" size="bare" disabled={!nodes.length || disabled} onClick={() => void download('pdf')}><Download size={14}/>PDF</Button>
    </div>
    {error && <div className="error-banner" role="alert">{error}<Button variant="ghost" size="bare" aria-label={t('닫기')} onClick={() => setError('')}><X size={14}/></Button></div>}
    <div className="erd-body">
      <div className="erd-canvas" ref={root}>
        {chosenRelation&&<div className="erd-edge-toolbar"><span>{chosenRelation.label||tr('가상 관계','Virtual relationship')}</span><Input type="color" aria-label={tr('캔버스 선 색상','Canvas line color')} value={chosenRelation.color} onChange={e=>updateRelation({color:e.target.value})}/>{(['smoothstep','default','straight'] as const).map((path,i)=><Button key={path} size="sm" variant={chosenRelation.path===path?'default':'outline'} onClick={()=>updateRelation({path})}>{[t('직각선'),t('곡선'),t('직선')][i]}</Button>)}</div>}
        <ReactFlow<TableNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} colorMode={theme} fitView fitViewOptions={{padding:.2,maxZoom:1}} minZoom={.05} maxZoom={2}
          ariaLabelConfig={{ 'controls.ariaLabel': t('캔버스 조작'), 'controls.zoomIn.ariaLabel': t('확대'), 'controls.zoomOut.ariaLabel': t('축소'), 'controls.fitView.ariaLabel': t('화면에 맞추기'), 'minimap.ariaLabel': t('미니맵') }}
          nodesDraggable={!disabled} nodesConnectable={!disabled} edgesReconnectable={!disabled} elementsSelectable={!disabled} deleteKeyCode={null}
          onPaneContextMenu={event=>context(event as React.MouseEvent,[{label:tr('테이블 추가','Add table'),disabled:readOnly||disabled,action:()=>setEditor({kind:'table',tableId:schema,position:flow.screenToFlowPosition({x:event.clientX,y:event.clientY})})},{label:t('자동 배치'),disabled:disabled,action:()=>{if(document){commit(arrange(document));fit();}}},{label:t('전체 보기'),action:fit},{label:tr('커밋','Commit'),disabled:!pending.length||disabled||readOnly,action:()=>void reviewChanges()}])}
          onNodeContextMenu={(event,node)=>{setSelected(decodeURIComponent(node.id));context(event,tableMenu(decodeURIComponent(node.id),(event.target as HTMLElement).closest<HTMLElement>('[data-column]')?.dataset.column));}}
          onEdgeContextMenu={(event,edge)=>{setSelected(edge.id);context(event,relationMenu(edge.id));}}
          onNodeClick={(_, node) => setSelected(decodeURIComponent(node.id))} onEdgeClick={(_, edge) => setSelected(edge.id)} onPaneClick={() => setSelected('')}
          onNodeDragStart={() => { if (documentRef.current) { undo.current = [...undo.current.slice(-39), documentRef.current]; redo.current = []; } }}
          onNodesChange={changes => {
            for (const change of changes) if (change.type === 'dimensions' && change.dimensions) {
              const dimensions = change.dimensions;
              setSizes(previous => previous[decodeURIComponent(change.id)]?.width === dimensions.width && previous[decodeURIComponent(change.id)]?.height === dimensions.height ? previous : { ...previous, [decodeURIComponent(change.id)]: dimensions });
            }
            const current = documentRef.current; if (!current || disabled) return;
            const positions = changes.filter(change => change.type === 'position' && change.position);
            if (!positions.length) return;
            const styles = { ...current.styles };
            for (const change of positions) if (change.type === 'position' && change.position && styles[decodeURIComponent(change.id)]) styles[decodeURIComponent(change.id)] = { ...styles[decodeURIComponent(change.id)], ...change.position };
            commit({ ...current, styles }, false);
          }}
          onConnect={connect}
          onReconnect={(edge, connection) => { if (document && connection.source && connection.target) commit({ ...document, relations: document.relations.map(item => item.id === edge.id ? { ...item, source: decodeURIComponent(connection.source), target: decodeURIComponent(connection.target), sourceColumns: connection.sourceHandle?.startsWith('out:')?[decodeURIComponent(connection.sourceHandle.slice(4))]:[], targetColumns: connection.targetHandle?.startsWith('in:')?[decodeURIComponent(connection.targetHandle.slice(3))]:[], custom: true } : item) }); }}
        ><Background gap={24} size={1}/><Controls showInteractive={false}/><MiniMap pannable zoomable nodeColor={node => (node.data as TableNodeData).style.color}/></ReactFlow>
        {(!document || !nodes.length) && <div className="erd-empty">{t(busy ? 'ERD 생성 중…' : error ? '정보를 불러오지 못했습니다.' : '표시할 테이블이 없습니다.')}</div>}
      </div>
      <aside className="erd-inspector">
        <h3>{t('속성')}</h3>
        <label>{t('선택 항목')}<NativeSelect size="sm" aria-label={t('선택 항목')} value={selected} onChange={event => setSelected(event.target.value)}>
          <NativeSelectOption value="">{t('선택 안 함')}</NativeSelectOption>
          <optgroup label={t('테이블')}>{document?.schema.tables.map(table => <NativeSelectOption key={tableId(table.table)} value={tableId(table.table)}>{table.table.schema}.{table.table.name}</NativeSelectOption>)}</optgroup>
          <optgroup label={t('관계')}>{document?.relations.map(edge => <NativeSelectOption key={edge.id} value={edge.id}>{edge.label || t('사용자 관계')}</NativeSelectOption>)}</optgroup>
        </NativeSelect></label>
        <fieldset disabled={disabled}>
          {chosenTable && document && <>
            <label>{t('테이블 색상')}<Input aria-label={t('테이블 색상')} type="color" value={document.styles[selected].color} onChange={event => updateTable({ color: event.target.value })}/></label>
            <label>{t('테이블 모양')}<NativeSelect size="sm" aria-label={t('테이블 모양')} value={document.styles[selected].shape} onChange={event => updateTable({ shape: event.target.value as TableStyle['shape'] })}>
              <NativeSelectOption value="square">{t('사각형')}</NativeSelectOption><NativeSelectOption value="rounded">{t('둥근 모서리')}</NativeSelectOption><NativeSelectOption value="card">{t('카드')}</NativeSelectOption>
            </NativeSelect></label>
            <label>{t('테이블 너비')}<Input aria-label={t('테이블 너비')} type="range" min="220" max="520" step="10" value={document.styles[selected].width} onChange={event => updateTable({ width: Number(event.target.value) })}/><output>{document.styles[selected].width}px</output></label>
          </>}
          {chosenRelation && document && <>
            <p className="erd-origin">{t(chosenRelation.custom ? '사용자 관계' : 'DB 외래키')}</p>
            <label>{t('관계 이름')}<Input aria-label={t('관계 이름')} value={chosenRelation.label} onChange={event => updateRelation({ label: event.target.value })}/></label>
            <label>{t('관계 이름 위치')}<Input aria-label={t('관계 이름 위치')} type="range" min="-120" max="120" step="4" value={chosenRelation.labelOffset ?? 0} onChange={event => updateRelation({ labelOffset: Number(event.target.value) })}/></label>
            <fieldset disabled={!chosenRelation.custom}>{(['source', 'target'] as const).map(side => {
              const columnsKey = side === 'source' ? 'sourceColumns' : 'targetColumns';
              const table = document.schema.tables.find(table => tableId(table.table) === chosenRelation[side]);
              return <div key={side}>
                <label>{t(side === 'source' ? '시작 테이블' : '대상 테이블')}<NativeSelect size="sm" aria-label={t(side === 'source' ? '시작 테이블' : '대상 테이블')} value={chosenRelation[side]} onChange={event => updateRelation({ [side]: event.target.value, [columnsKey]: [], custom: true })}>
                  {document.schema.tables.map(table => <NativeSelectOption key={tableId(table.table)} value={tableId(table.table)}>{table.table.schema}.{table.table.name}</NativeSelectOption>)}
                </NativeSelect></label>
                <label>{t(side === 'source' ? '시작 컬럼' : '대상 컬럼')}<NativeSelect size="sm" multiple aria-label={t(side === 'source' ? '시작 컬럼' : '대상 컬럼')} value={chosenRelation[columnsKey]} onChange={event => updateRelation({ [columnsKey]: [...event.target.selectedOptions].map(option => option.value), custom: true })}>
                  {table?.columns.map(column => <NativeSelectOption key={column.name} value={column.name}>{column.name}</NativeSelectOption>)}
                </NativeSelect></label>
              </div>;
            })}
            </fieldset><label>{t('선 색상')}<Input aria-label={t('선 색상')} type="color" value={chosenRelation.color} onChange={event => updateRelation({ color: event.target.value })}/></label>
            <label>{t('연결선 모양')}<NativeSelect size="sm" aria-label={t('연결선 모양')} value={chosenRelation.path} onChange={event => updateRelation({ path: event.target.value as Relation['path'] })}>
              <NativeSelectOption value="smoothstep">{t('직각선')}</NativeSelectOption><NativeSelectOption value="default">{t('곡선')}</NativeSelectOption><NativeSelectOption value="straight">{t('직선')}</NativeSelectOption>
            </NativeSelect></label>
            <label>{t('화살표')}<NativeSelect size="sm" aria-label={t('화살표')} value={chosenRelation.arrow} onChange={event => updateRelation({ arrow: event.target.value as Relation['arrow'] })}>
              <NativeSelectOption value="end">{t('끝')}</NativeSelectOption><NativeSelectOption value="start">{t('시작')}</NativeSelectOption><NativeSelectOption value="both">{t('양쪽')}</NativeSelectOption><NativeSelectOption value="none">{t('없음')}</NativeSelectOption>
            </NativeSelect></label>
            <label className="erd-checkbox"><Input type="checkbox" checked={chosenRelation.dashed} onChange={event => updateRelation({ dashed: event.target.checked })}/>{t('점선')}</label>
            <Button variant="outline" size="sm" className="secondary-button" onClick={deleteRelation}>{chosenRelation.custom||document.pending?.some(op=>op.id===selected)?t('관계 삭제'):tr('캔버스에서 숨기기','Hide on canvas')}</Button>
          </>}
          {!chosenTable && !chosenRelation && <p className="erd-hint">{t('테이블이나 연결선을 선택하여 편집하세요.')}</p>}
          <Button variant="outline" size="sm" className="secondary-button erd-add-relation" disabled={!nodes.length} onClick={() => { if (nodes.length) setEditor({kind:'relation'}); }}>{t('관계 추가')}</Button>
          {!!document?.hiddenRelations.length && <Button variant="outline" size="sm" className="secondary-button" onClick={() => { if (document) commit(rebaseErd(document.baseSchema??document.schema, { ...document, hiddenRelations: [] })); }}>{t('DB 관계 복원')}</Button>}
        </fieldset>
        {!!pending.length&&<div className="erd-pending-list"><h4>{tr('미적용 변경','Pending changes')} · {pending.length}</h4>{pending.map((op,i)=><div key={op.id}><span>{i+1}. {op.table.name} · {op.kind==='createTable'?tr('테이블 추가','Add table'):op.kind==='addColumn'?op.column.name:op.name}</span></div>)}<Button variant="outline" size="sm" disabled={disabled} onClick={async()=>{if(document&&await requestConfirm(tr('미적용 구조 변경을 모두 취소할까요?','Discard all pending schema changes?'))){commit(rebaseErd(document.baseSchema??document.schema,document,[]));}}}>{tr('변경 취소','Discard changes')}</Button></div>}
      </aside>
    </div>
    {menu&&<ContextMenu menu={menu} onClose={()=>setMenu(null)}/>}
    {editor&&document&&<ErdChangeDialog key={JSON.stringify(editor)} editor={editor} document={document} readOnly={readOnly} onClose={()=>setEditor(null)} onStage={stage} onVirtual={edge=>{const current=documentRef.current;if(current){commit({...current,relations:[...current.relations,edge]});setSelected(edge.id);}}}/>}
    {plan&&<ModalSurface title={tr('ERD 변경 커밋','Commit ERD changes')} locked={applying} onClose={()=>setPlan(null)}><div className="modal erd-commit-modal" role="dialog" aria-label={tr('ERD 변경 커밋','Commit ERD changes')}><h2>{tr('ERD 변경 커밋','Commit ERD changes')}</h2><p>{pending.length} {tr('개 변경','changes')}</p>{plan.warnings.map((warning,i)=><p key={i} className="structure-warning">{warning}</p>)}{!plan.transactional&&<p className="structure-warning">{tr('이 DB는 DDL을 자동 커밋합니다. 실패 전 적용된 변경은 유지됩니다.','This database commits DDL automatically. Changes completed before an error remain applied.')}</p>}<pre className="ddl-preview">{plan.sqls.join('\n\n')}</pre><div className="modal-actions"><Button variant="outline" disabled={applying} onClick={()=>setPlan(null)}>{tr('취소','Cancel')}</Button><Button disabled={applying||readOnly} onClick={()=>void applyChanges()}>{applying?tr('적용 중…','Applying…'):tr('DB에 적용','Apply to database')}</Button></div></div></ModalSurface>}
    <footer className="erd-footer"><span>{document?.schema.tables.length ?? 0} {t('테이블')} · {document?.relations.length ?? 0} {t('관계')}</span><span role="status">{exporting ? t('내보내는 중…') : message || (saved ? t('이 기기에 자동 저장') : t('저장 공간을 사용할 수 없어 이번 세션에만 유지됩니다.'))}</span></footer>
  </section>;
}
