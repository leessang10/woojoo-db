import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, BaseEdge, getBezierPath, getStraightPath, getSmoothStepPath, useReactFlow, type EdgeProps, type Node, type NodeProps, type Connection } from '@xyflow/react';
import { Download, GitBranch, LayoutGrid, RefreshCw, Undo2, Redo2, X } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './erd.css';
import { useLanguage } from './i18n';
import { readErd } from './api';
import { arrange, mergeSchema, readSavedErd, tableId, visibleColumns, type ColumnMode, type ErdDocument, type ErdTable, type Relation, type TableStyle } from './erd-model';
import type { Theme } from './theme';

type TableNodeData = { table: ErdTable; columns: ErdTable['columns']; foreignColumns: string[]; style: TableStyle; emptyLabel: string };
type TableNode = Node<TableNodeData, 'table'>;
function ErdTableNode({ data, selected }: NodeProps<TableNode>) {
  const { table, columns, style } = data;
  const rgb = style.color.match(/\w\w/g)!.map(v => parseInt(v, 16));
  const contrast = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 155 ? '#17202c' : '#fff';
  return <div className={`erd-table-node ${style.shape} ${selected ? 'is-selected' : ''}`} style={{ width: style.width, borderColor: style.color }}>
    <header style={{ background: style.color, color: contrast }}>
      <Handle type="target" position={Position.Left} id="in"/>
      <small>{table.table.schema}</small><strong>{table.table.name}</strong>
      <Handle type="source" position={Position.Right} id="out"/>
    </header>
    <div className="erd-columns">{columns.map(column => <div key={column.name} className="erd-column">
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
type Props = { session: string; schema: string; storageKey: string; initial: ErdDocument | null; onChange: (document: ErdDocument) => void; theme: Theme };
export default function ErdPage(props: Props) { return <ReactFlowProvider><ErdCanvas {...props}/></ReactFlowProvider>; }

function ErdCanvas({ session, schema, storageKey, initial, onChange, theme }: Props) {
  const { t, language } = useLanguage();
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
    setBusy(true); setError('');
    try {
      const data = await readErd(session, schema);
      if (alive.current) { commit(mergeSchema(data, documentRef.current)); fit(); }
    } catch (reason) { if (alive.current) setError(String(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    if (!initial) {
      readErd(session, schema).then(data => {
        if (!cancelled) { commit(mergeSchema(data, readSavedErd(storageKey)), false); fit(); }
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
    return { id, type: 'table', position: { x: style.x, y: style.y }, measured: sizes[id], selected: selected === id,
      data: { table, style, columns: visibleColumns(table, document.mode, document.schema),
        foreignColumns: document.schema.foreignKeys.filter(key => tableId(key.source) === id).flatMap(key => key.sourceColumns), emptyLabel: t('표시할 키가 없습니다.') } };
  }) ?? [], [document, selected, language, sizes]);
  const edges = useMemo(() => document?.relations.map((edge, index, relations) => ({
    id: edge.id, source: edge.source, target: edge.target, sourceHandle: 'out', targetHandle: 'in', type: 'relationship',
    data: { shape: edge.path, labelOffset: edge.labelOffset ?? relations.slice(0, index).filter(previous => [previous.source, previous.target].sort().join('|') === [edge.source, edge.target].sort().join('|')).length * 26 },
    label: edge.label, selected: selected === edge.id,
    style: { stroke: edge.color, strokeWidth: 2, strokeDasharray: edge.dashed ? '6 4' : undefined },
    labelStyle: { fill: theme === 'dark' ? '#e2e6ec' : '#252a33', fontSize: 11 },
    labelBgStyle: { fill: theme === 'dark' ? '#20242b' : '#fff' },
    markerEnd: edge.arrow === 'end' || edge.arrow === 'both' ? { type: MarkerType.ArrowClosed, color: edge.color, width: 18, height: 18 } : undefined,
    markerStart: edge.arrow === 'start' || edge.arrow === 'both' ? { type: MarkerType.ArrowClosed, color: edge.color, width: 18, height: 18 } : undefined,
    reconnectable: true,
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
    const edge: Relation = { id: `custom-${crypto.randomUUID()}`, source: connection.source, target: connection.target,
      sourceColumns: [], targetColumns: [], label: '', color: '#7d8fa8', path: 'smoothstep', arrow: 'end', dashed: true, custom: true };
    commit({ ...current, relations: [...current.relations, edge] }); setSelected(edge.id);
  }
  function deleteRelation() {
    if (!document || !chosenRelation) return;
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
  const disabled = busy || exporting;
  return <section className={`erd-page ${exporting ? 'erd-exporting' : ''}`} aria-label={`${schema} ERD`} aria-busy={disabled}>
    <div className="erd-toolbar">
      <strong><GitBranch size={16}/>{schema} <span>ERD</span></strong>
      <label>{t('컬럼 표시')}<select aria-label={t('컬럼 표시')} value={document?.mode ?? 'all'} disabled={!document || disabled} onChange={event => { if (document) commit({ ...document, mode: event.target.value as ColumnMode }); }}>
        <option value="pk">{t('PK만 보기')}</option><option value="keys">{t('PK, FK 보기')}</option><option value="all">{t('모든 컬럼 보기')}</option>
      </select></label>
      <button title={t('자동 배치')} aria-label={t('자동 배치')} disabled={!document || disabled} onClick={() => { if (document) { commit(arrange(document)); fit(); } }}><LayoutGrid size={16}/></button>
      <button title={t('화면에 맞추기')} disabled={!nodes.length || disabled} onClick={fit}>{t('전체 보기')}</button>
      <button title={t('실행 취소')} aria-label={t('실행 취소')} disabled={!undo.current.length || disabled} onClick={() => stepHistory(true)}><Undo2 size={16}/></button>
      <button title={t('다시 실행')} aria-label={t('다시 실행')} disabled={!redo.current.length || disabled} onClick={() => stepHistory(false)}><Redo2 size={16}/></button>
      <button title={t('메타데이터 새로고침')} aria-label={t('메타데이터 새로고침')} disabled={disabled} onClick={() => void refresh()}><RefreshCw size={16} className={busy ? 'spin' : ''}/></button>
      <span className="tabs-spacer"/>
      <button disabled={!nodes.length || disabled} onClick={() => void download('png')}><Download size={14}/>PNG</button>
      <button disabled={!nodes.length || disabled} onClick={() => void download('pdf')}><Download size={14}/>PDF</button>
    </div>
    {error && <div className="error-banner" role="alert">{error}<button aria-label={t('닫기')} onClick={() => setError('')}><X size={14}/></button></div>}
    <div className="erd-body">
      <div className="erd-canvas" ref={root}>
        <ReactFlow<TableNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} colorMode={theme} fitView minZoom={.05} maxZoom={2}
          ariaLabelConfig={{ 'controls.ariaLabel': t('캔버스 조작'), 'controls.zoomIn.ariaLabel': t('확대'), 'controls.zoomOut.ariaLabel': t('축소'), 'controls.fitView.ariaLabel': t('화면에 맞추기'), 'minimap.ariaLabel': t('미니맵') }}
          nodesDraggable={!disabled} nodesConnectable={!disabled} edgesReconnectable={!disabled} elementsSelectable={!disabled} deleteKeyCode={null}
          onNodeClick={(_, node) => setSelected(node.id)} onEdgeClick={(_, edge) => setSelected(edge.id)} onPaneClick={() => setSelected('')}
          onNodeDragStart={() => { if (documentRef.current) { undo.current = [...undo.current.slice(-39), documentRef.current]; redo.current = []; } }}
          onNodesChange={changes => {
            for (const change of changes) if (change.type === 'dimensions' && change.dimensions) {
              const dimensions = change.dimensions;
              setSizes(previous => previous[change.id]?.width === dimensions.width && previous[change.id]?.height === dimensions.height ? previous : { ...previous, [change.id]: dimensions });
            }
            const current = documentRef.current; if (!current || disabled) return;
            const positions = changes.filter(change => change.type === 'position' && change.position);
            if (!positions.length) return;
            const styles = { ...current.styles };
            for (const change of positions) if (change.type === 'position' && change.position && styles[change.id]) styles[change.id] = { ...styles[change.id], ...change.position };
            commit({ ...current, styles }, false);
          }}
          onConnect={connect}
          onReconnect={(edge, connection) => { if (document && connection.source && connection.target) commit({ ...document, relations: document.relations.map(item => item.id === edge.id ? { ...item, source: connection.source, target: connection.target, sourceColumns: [], targetColumns: [], custom: true } : item) }); }}
        ><Background gap={24} size={1}/><Controls showInteractive={false}/><MiniMap pannable zoomable nodeColor={node => (node.data as TableNodeData).style.color}/></ReactFlow>
        {(!document || !nodes.length) && <div className="erd-empty">{t(busy ? 'ERD 생성 중…' : error ? '정보를 불러오지 못했습니다.' : '표시할 테이블이 없습니다.')}</div>}
      </div>
      <aside className="erd-inspector">
        <h3>{t('속성')}</h3>
        <label>{t('선택 항목')}<select aria-label={t('선택 항목')} value={selected} onChange={event => setSelected(event.target.value)}>
          <option value="">{t('선택 안 함')}</option>
          <optgroup label={t('테이블')}>{document?.schema.tables.map(table => <option key={tableId(table.table)} value={tableId(table.table)}>{table.table.schema}.{table.table.name}</option>)}</optgroup>
          <optgroup label={t('관계')}>{document?.relations.map(edge => <option key={edge.id} value={edge.id}>{edge.label || t('사용자 관계')}</option>)}</optgroup>
        </select></label>
        <fieldset disabled={disabled}>
          {chosenTable && document && <>
            <label>{t('테이블 색상')}<input aria-label={t('테이블 색상')} type="color" value={document.styles[selected].color} onChange={event => updateTable({ color: event.target.value })}/></label>
            <label>{t('테이블 모양')}<select aria-label={t('테이블 모양')} value={document.styles[selected].shape} onChange={event => updateTable({ shape: event.target.value as TableStyle['shape'] })}>
              <option value="square">{t('사각형')}</option><option value="rounded">{t('둥근 모서리')}</option><option value="card">{t('카드')}</option>
            </select></label>
            <label>{t('테이블 너비')}<input aria-label={t('테이블 너비')} type="range" min="220" max="520" step="10" value={document.styles[selected].width} onChange={event => updateTable({ width: Number(event.target.value) })}/><output>{document.styles[selected].width}px</output></label>
          </>}
          {chosenRelation && document && <>
            <p className="erd-origin">{t(chosenRelation.custom ? '사용자 관계' : 'DB 외래키')}</p>
            <label>{t('관계 이름')}<input aria-label={t('관계 이름')} value={chosenRelation.label} onChange={event => updateRelation({ label: event.target.value })}/></label>
            <label>{t('관계 이름 위치')}<input aria-label={t('관계 이름 위치')} type="range" min="-120" max="120" step="4" value={chosenRelation.labelOffset ?? 0} onChange={event => updateRelation({ labelOffset: Number(event.target.value) })}/></label>
            {(['source', 'target'] as const).map(side => {
              const columnsKey = side === 'source' ? 'sourceColumns' : 'targetColumns';
              const table = document.schema.tables.find(table => tableId(table.table) === chosenRelation[side]);
              return <div key={side}>
                <label>{t(side === 'source' ? '시작 테이블' : '대상 테이블')}<select aria-label={t(side === 'source' ? '시작 테이블' : '대상 테이블')} value={chosenRelation[side]} onChange={event => updateRelation({ [side]: event.target.value, [columnsKey]: [], custom: true })}>
                  {document.schema.tables.map(table => <option key={tableId(table.table)} value={tableId(table.table)}>{table.table.schema}.{table.table.name}</option>)}
                </select></label>
                <label>{t(side === 'source' ? '시작 컬럼' : '대상 컬럼')}<select multiple aria-label={t(side === 'source' ? '시작 컬럼' : '대상 컬럼')} value={chosenRelation[columnsKey]} onChange={event => updateRelation({ [columnsKey]: [...event.target.selectedOptions].map(option => option.value), custom: true })}>
                  {table?.columns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}
                </select></label>
              </div>;
            })}
            <label>{t('선 색상')}<input aria-label={t('선 색상')} type="color" value={chosenRelation.color} onChange={event => updateRelation({ color: event.target.value })}/></label>
            <label>{t('연결선 모양')}<select aria-label={t('연결선 모양')} value={chosenRelation.path} onChange={event => updateRelation({ path: event.target.value as Relation['path'] })}>
              <option value="smoothstep">{t('직각선')}</option><option value="default">{t('곡선')}</option><option value="straight">{t('직선')}</option>
            </select></label>
            <label>{t('화살표')}<select aria-label={t('화살표')} value={chosenRelation.arrow} onChange={event => updateRelation({ arrow: event.target.value as Relation['arrow'] })}>
              <option value="end">{t('끝')}</option><option value="start">{t('시작')}</option><option value="both">{t('양쪽')}</option><option value="none">{t('없음')}</option>
            </select></label>
            <label className="erd-checkbox"><input type="checkbox" checked={chosenRelation.dashed} onChange={event => updateRelation({ dashed: event.target.checked })}/>{t('점선')}</label>
            <button className="secondary-button" onClick={deleteRelation}>{t('관계 삭제')}</button>
          </>}
          {!chosenTable && !chosenRelation && <p className="erd-hint">{t('테이블이나 연결선을 선택하여 편집하세요.')}</p>}
          <button className="secondary-button erd-add-relation" disabled={!nodes.length} onClick={() => { if (nodes.length) connect({ source: nodes[0].id, target: nodes[1]?.id ?? nodes[0].id, sourceHandle: 'out', targetHandle: 'in' }); }}>{t('관계 추가')}</button>
          {!!document?.hiddenRelations.length && <button className="secondary-button" onClick={() => { if (document) commit(mergeSchema(document.schema, { ...document, hiddenRelations: [] })); }}>{t('DB 관계 복원')}</button>}
        </fieldset>
        <p className="erd-note">{t('캔버스 편집은 DB 구조를 변경하지 않습니다.')}</p>
      </aside>
    </div>
    <footer className="erd-footer"><span>{document?.schema.tables.length ?? 0} {t('테이블')} · {document?.relations.length ?? 0} {t('관계')}</span><span role="status">{exporting ? t('내보내는 중…') : message || (saved ? t('이 기기에 자동 저장') : t('저장 공간을 사용할 수 없어 이번 세션에만 유지됩니다.'))}</span></footer>
  </section>;
}
