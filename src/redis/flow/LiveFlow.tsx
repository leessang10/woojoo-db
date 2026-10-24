import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, ReactFlow, applyNodeChanges, type Node, type NodeProps, type NodeChange } from '@xyflow/react';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Database, Pause, Play, Settings2, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import type { Theme } from '../../theme';
import type { RedisApi } from '../api';
import { ttlText, type KeyMeta, type RedisValue, type SavedView } from '../model';
import type { FlowEvent } from './observation';
import { useObservation } from './useObservation';
import '@xyflow/react/dist/style.css';
import './flow.css';

type Props = { api: RedisApi; session: string; active: boolean; demo: boolean; mode: 'cache' | 'queue'; keys: KeyMeta[]; pattern: string; queue?: SavedView; queues: SavedView[]; onQueue: (view: SavedView) => void; theme: Theme; ko: boolean; separator: string };
type CardData = { value: RedisValue; effects: FlowEvent[]; lastEvent?: FlowEvent; ko: boolean; now: number; direction?: SavedView['direction']; name?: string };
type CardNode = Node<CardData>;
const words: Record<FlowEvent['kind'], [string, string]> = { enqueue: ['유입', 'Enqueued'], dequeue: ['인출', 'Dequeued'], completed: ['완료', 'Completed'], failed: ['실패', 'Failed'], retry: ['재시도', 'Retry'], hit: ['조회 적중', 'Hit'], miss: ['조회 실패', 'Miss'], write: ['갱신', 'Updated'], created: ['생성', 'Created'], deleted: ['삭제', 'Deleted'], expired: ['만료', 'Expired'], ttl: ['TTL 변경', 'TTL changed'], changed: ['변화 감지', 'Change observed'], discovered: ['발견', 'Discovered'], missing: ['사라짐', 'Missing'], length: ['길이 변화', 'Length changed'] };
const label = (kind: FlowEvent['kind'], ko: boolean) => words[kind][ko ? 0 : 1];
const eventLabel = (event: FlowEvent, ko: boolean) => event.origin === 'snapshot' && event.kind === 'changed' ? (event.label === 'preview' ? (ko ? '조회 구간 변화' : 'Sample changed') : event.label === 'type' ? (ko ? '자료형 변경' : 'Type changed') : (ko ? '값 변경' : 'Value changed')) : label(event.kind, ko);
const shownKey = (value: RedisValue) => value.key.utf8 ? value.key.text : `base64:${value.key.base64}`;
function CacheNode({ data }: NodeProps<CardNode>) {
  const effect = data.effects.at(-1), ttl = Number(data.value.ttlMs);
  const expiry = useRef({ deadline: data.value.observedAt + ttl, duration: ttl });
  if (Math.abs(expiry.current.deadline - data.value.observedAt - ttl) > 1500) expiry.current = { deadline: data.value.observedAt + ttl, duration: ttl };
  const remaining = data.value.ttlMs !== null && ttl >= 0 ? String(Math.max(0, ttl - Math.max(0, data.now - data.value.observedAt))) : data.value.ttlMs;
  return <div className={`rf-cache-card ${effect ? `rf-effect-${effect.kind}` : ''}`} data-testid="cache-flow-node">
    {effect && <i key={`${effect.sourceId}:${effect.id}`} className={`rf-cache-pulse rf-pulse-${effect.kind}`} data-testid="cache-pulse"/>}
    <header><Database size={15}/><span>{data.value.type}</span><span className="rf-ttl">{ttlText(remaining, data.ko)}</span></header>
    <strong title={shownKey(data.value)}>{shownKey(data.value)}</strong>
    <footer><span>{effect || data.lastEvent ? eventLabel((effect ?? data.lastEvent)!, data.ko) : data.ko ? '기준값' : 'Baseline'}</span><span>{data.value.length ?? '—'} {data.value.type === 'string' ? 'bytes' : data.ko ? '항목' : 'items'}</span></footer>
    <div className="rf-ttl-line"><i style={{ width: ttl >= 0 ? `${Math.max(0, Math.min(100, Number(remaining) / Math.max(expiry.current.duration, 1) * 100))}%` : '100%' }}/></div>
  </div>;
}
function QueueNode({ data }: NodeProps<CardNode>) {
  const rows = data.value.rows.slice(0, 8), length = data.value.length ?? '—';
  const moving = data.effects.filter(e => ['enqueue', 'dequeue', 'retry', 'completed', 'failed', 'length'].includes(e.kind)).slice(-12);
  return <div className="rf-queue-node" data-testid="queue-cylinder">
    <header><span><strong>{data.name || shownKey(data.value)}</strong><small>{shownKey(data.value)}</small></span><span className="rf-queue-count">{length}<small>{data.value.type === 'stream' ? (data.ko ? '보관 이벤트' : 'stored events') : (data.ko ? '대기 항목' : 'queued items')}</small></span></header>
    <div className={`rf-cylinder ${data.direction === 'left' ? 'rf-reversed' : ''}`}>
      <div className="rf-cylinder-body"/><div className="rf-cylinder-cap rf-cylinder-left"/><div className="rf-cylinder-cap rf-cylinder-right"/>
      <div className="rf-job-stack">{rows.map((row, i) => <div className="rf-job" key={data.value.type === 'stream' ? row.id : `slot-${i}`}><i/><span>{data.value.type === 'stream' ? row.id : `#${i + 1}`}</span><small>{row.cells.map(c => c.utf8 ? c.text : '[binary]').join(' ').slice(0, 34)}</small></div>)}{Number(length) > rows.length && <span className="rf-job-more">+{(BigInt(length) - BigInt(rows.length)).toLocaleString()}</span>}</div>
      {moving.map((event, i) => <div key={`${event.sourceId}:${event.id}`} data-testid="queue-job-motion" data-kind={event.kind} className={`rf-moving-job rf-motion-${event.kind} ${data.direction === 'unknown' && event.origin !== 'demo' ? 'rf-no-direction' : ''}`} style={{ top: `${44 + i % 3 * 34}px` }}><i/>{event.jobId ?? (event.delta ? `${event.delta > 0 ? '+' : ''}${event.delta}` : label(event.kind, data.ko))}</div>)}
    </div>
    <footer><span>{data.direction === 'unknown' ? (data.ko ? '인출 방향 미지정' : 'Pop direction unspecified') : data.direction === 'left' ? '← LPOP' : 'RPOP →'}</span><span>{data.value.type === 'stream' ? (data.ko ? 'ACK와 원본 삭제는 별개' : 'ACK does not delete the log') : (data.ko ? '내부 카드는 현재 조회 구간' : 'Cards show the current sample')}</span></footer>
    <div className="rf-queue-events">{data.effects.slice(-4).map(e => <span className={`rf-event-${e.kind}`} key={`${e.sourceId}:${e.id}`}>{eventLabel(e, data.ko)} {e.jobId ?? ''}</span>)}</div>
  </div>;
}
const nodeTypes = { cache: CacheNode, queue: QueueNode };

export function LiveFlow(props: Props) {
  const { ko, mode, queue, demo } = props, tr = (a: string, b: string) => ko ? a : b;
  const [running, setRunning] = useState(false), [interval, setIntervalMs] = useState(2000);
  const [settings, setSettings] = useState(false), [eventInput, setEventInput] = useState(''), [eventKey, setEventKey] = useState(''), [notifications, setNotifications] = useState(false);
  const [selected, setSelected] = useState(''), [now, setNow] = useState(Date.now());
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [quietOnly, setQuietOnly] = useState(false), [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const flow = useObservation({ ...props, running, queueKey: mode === 'queue' ? queue?.keyBase64 : undefined, active: props.active && pageVisible && (mode !== 'queue' || !!queue), eventKey, notifications, interval: mode === 'cache' ? Math.max(5000, interval) : interval });
  useEffect(() => { const change = () => setPageVisible(!document.hidden); document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change); }, []);
  useEffect(() => { if (!props.active || !pageVisible) return; setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [props.active, pageVisible]);
  useEffect(() => { setSelected(''); }, [mode, queue?.id, props.pattern]);
  const recent = flow.effects.filter(e => now - e.receivedAt < 2100).map(e => e.event);
  const [nodes, setNodes] = useState<Node[]>([]);
  const displayValues = useMemo(() => Object.values(flow.values).slice(0, 200), [flow.values]);
  useEffect(() => {
    const next: Node[] = [];
    const lastEvents = new Map<string, FlowEvent>();
    for (const event of flow.events) if (!event.late) lastEvents.set(event.keyBase64, event);
    if (mode === 'queue') {
      const value = queue && flow.values[queue.keyBase64];
      if (value) next.push({ id: value.key.base64, type: 'queue', position: { x: 50, y: 60 }, data: { value, effects: recent.filter(e => e.keyBase64 === value.key.base64), ko, now, direction: queue.direction, name: queue.name } });
    } else {
      const groups = new Map<string, RedisValue[]>();
      for (const value of displayValues) {
        if ((value.type === 'none' || value.ttlMs === '-2') && !recent.some(e => e.keyBase64 === value.key.base64)) continue;
        if (quietOnly && flow.events.some(e => e.keyBase64 === value.key.base64 && !['hit', 'miss'].includes(e.kind))) continue;
        const prefix = value.key.utf8 ? value.key.text.split(props.separator)[0] || '∅' : 'binary';
        groups.set(prefix, [...groups.get(prefix) ?? [], value]);
      }
      let y = 30;
      for (const [prefix, values] of groups) {
        const parentId = `prefix:${prefix}`, height = Math.ceil(values.length / 3) * 138 + 50;
        next.push({ id: parentId, type: 'group', position: { x: 30, y }, data: { label: prefix }, style: { width: 814, height }, className: 'rf-prefix-group', selectable: false });
        // A small title node keeps the namespace label visible at every zoom level.
        next.push({ id: `title:${prefix}`, parentId, position: { x: 16, y: 9 }, data: { label: `${prefix}${props.separator}* · ${values.length}` }, className: 'rf-prefix-title', draggable: false, selectable: false, style: { width: 760 } });
        values.forEach((value, i) => next.push({ id: value.key.base64, type: 'cache', parentId, extent: 'parent', position: { x: 16 + i % 3 * 264, y: 42 + Math.floor(i / 3) * 138 }, data: { value, effects: recent.filter(e => e.keyBase64 === value.key.base64), lastEvent: lastEvents.get(value.key.base64), ko, now } }));
        y += height + 24;
      }
    }
    setNodes(old => next.map(n => { const existing = old.find(x => x.id === n.id && x.parentId === n.parentId); return existing ? { ...n, position: existing.position, selected: existing.selected, measured: existing.measured } : n; }));
  }, [flow.values, flow.events, flow.effects, now, mode, queue, ko, quietOnly, props.separator, displayValues]);
  const detail = flow.values[selected];
  const status = flow.status === 'gap' ? tr('관측 공백 · 기준값 재설정', 'Observation gap · new baseline') : flow.status === 'notifications-unverified' ? tr('알림 범위 확인 불가', 'Notification coverage unverified') : demo ? tr('데모 이벤트', 'Demo events') : eventKey ? tr('서비스 이벤트 + 스냅샷', 'Service events + snapshots') : tr('스냅샷 관측', 'Snapshot observation');
  return <section className={`redis-live-flow ${reduced ? 'rf-reduced-motion' : ''}`} data-testid="redis-live-flow">
    <div className="rf-toolbar">
      {mode === 'queue' && <NativeSelect aria-label={tr('시각화할 큐', 'Queue to visualize')} value={queue?.id ?? ''} onChange={e => { const q = props.queues.find(q => q.id === e.target.value); if (q) props.onQueue(q); }}><option value="">{tr('큐 선택', 'Select queue')}</option>{props.queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}</NativeSelect>}
      <Button size="sm" variant={running ? 'outline' : 'default'} disabled={mode === 'queue' && !queue} onClick={() => setRunning(v => !v)}>{running ? <Pause size={13}/> : <Play size={13}/>} {running ? tr('관측 중지', 'Pause') : tr('관측 시작', 'Observe')}</Button>
      <span className={`rf-observing ${running && props.active ? 'active' : ''}`}><i/>{running && props.active ? tr('관측 중', 'Observing') : tr('정지', 'Paused')}</span>
      <span className="rf-source">{status}</span><span className="redis-toolbar-spacer"/>
      {mode === 'cache' && <label className="redis-check"><input type="checkbox" checked={quietOnly} onChange={e => setQuietOnly(e.target.checked)}/>{tr('변화 미관측', 'No changes observed')}</label>}
      <Button size="icon-sm" variant="ghost" aria-label={tr('관측 설정', 'Observation settings')} aria-expanded={settings} onClick={() => setSettings(v => !v)}><Settings2 size={15}/></Button>
    </div>
    {settings && <div className="rf-settings">
      <label>{tr('조회 간격', 'Poll interval')}<NativeSelect value={String(interval)} onChange={e => setIntervalMs(Number(e.target.value))}><option value="2000">{mode === 'cache' ? '5s' : '2s'}</option>{mode !== 'cache' && <option value="5000">5s</option>}<option value="10000">10s</option></NativeSelect></label>
      {!demo && <><form onSubmit={e => { e.preventDefault(); setEventKey(eventInput.trim()); }}><label htmlFor="redis-event-stream">{tr('관측용 Stream', 'Observation stream')}</label><Input id="redis-event-stream" placeholder="observability:redis" value={eventInput} onChange={e => setEventInput(e.target.value)}/><Button size="sm" type="submit">{tr('적용', 'Apply')}</Button></form><label className="redis-check"><input type="checkbox" checked={notifications} onChange={e => setNotifications(e.target.checked)}/>{tr('키 변경 알림', 'Key change notifications')}</label></>}
      <label className="redis-check"><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)}/>{tr('움직임 줄이기', 'Reduce motion')}</label>
    </div>}
    {flow.error && <p role="alert" className="redis-error rf-notice">{flow.error}</p>}
    <div className="rf-body"><div className="rf-canvas">
      <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} onNodesChange={(changes: NodeChange[]) => setNodes(old => applyNodeChanges(changes, old))} onNodeClick={(_, node) => { if (node.type === 'cache' || node.type === 'queue') setSelected(node.id); }} colorMode={props.theme} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1, nodes: mode === 'cache' ? nodes.filter(n => n.type === 'group').slice(0, 1) : undefined }} minZoom={0.2} maxZoom={1.5} nodesConnectable={false} deleteKeyCode={null} proOptions={{ hideAttribution: true }}><Background gap={22} size={1}/><Controls showInteractive={false}/></ReactFlow>
      {!nodes.length && <div className="rf-empty">{mode === 'queue' && !queue ? tr('저장한 큐를 선택하세요.', 'Select a saved queue.') : tr('관측할 키가 없습니다.', 'No keys to observe.')}</div>}
      <div className="rf-legend"><span><i className="blue"/>{tr('유입 · 갱신', 'Incoming · updated')}</span><span><i className="green"/>{tr('조회 · 완료', 'Hit · completed')}</span><span><i className="amber"/>{tr('미적중 · 재시도', 'Miss · retry')}</span><span><i className="red"/>{tr('실패 · 삭제', 'Failed · deleted')}</span></div>
    </div>{detail && <aside className="rf-detail"><header><strong>{tr('관측 상세', 'Observation detail')}</strong><Button variant="ghost" size="icon-xs" aria-label={tr('관측 상세 닫기', 'Close observation detail')} onClick={() => setSelected('')}><X size={14}/></Button></header><h3>{shownKey(detail)}</h3><p>{detail.type} · TTL {ttlText(detail.ttlMs, ko)}</p><p>{tr('마지막 조회', 'Last snapshot')} {new Date(detail.observedAt).toLocaleTimeString(ko ? 'ko-KR' : 'en-US')}</p><pre>{detail.text?.text ?? detail.rows.slice(0, 12).map(r => r.cells.map(c => c.text).join(' · ')).join('\n')}</pre><h4>{tr('최근 이벤트', 'Recent events')}</h4>{flow.events.filter(e => e.keyBase64 === selected).slice(-8).reverse().map(e => <p key={`${e.sourceId}:${e.id}`}>{eventLabel(e, ko)} · {e.origin}{e.late ? tr(' · 지연 도착', ' · late') : ''}</p>)}</aside>}</div>
    {demo && <div className="rf-demo-controls"><span>DEMO</span><Button variant="outline" size="sm" onClick={() => flow.simulate(mode === 'queue' ? 'enqueue' : 'hit')}><ArrowDownToLine size={13}/>{mode === 'queue' ? tr('job 유입', 'Enqueue job') : tr('캐시 조회', 'Cache hit')}</Button><Button variant="outline" size="sm" onClick={() => flow.simulate(mode === 'queue' ? 'dequeue' : 'write')}><ArrowUpFromLine size={13}/>{mode === 'queue' ? tr('job 인출', 'Dequeue job') : tr('캐시 갱신', 'Refresh cache')}</Button><Button variant="ghost" size="sm" onClick={() => flow.simulate(mode === 'queue' ? 'failed' : 'miss')}>{mode === 'queue' ? tr('실패', 'Failure') : tr('캐시 미적중', 'Cache miss')}</Button><span className="rf-demo-note">{tr('재현 이벤트 · Redis 데이터 변경 없음', 'Simulated events · no Redis writes')}</span></div>}
    <details className="rf-history"><summary><Activity size={13}/>{tr('이벤트 이력', 'Event history')} <span>{flow.events.length}</span><span className="redis-toolbar-spacer"/><small>{flow.updatedAt ? new Date(flow.updatedAt).toLocaleTimeString(ko ? 'ko-KR' : 'en-US') : '—'} · {mode === 'cache' ? tr('값 최대 12개씩 순환 조회', 'Values sampled in batches of 12') : tr('조회 구간 최대 100개', 'Up to 100 sampled entries')}</small></summary><div>{flow.events.slice(-100).reverse().map(e => <p key={`${e.sourceId}:${e.id}`}><time>{new Date(e.at).toLocaleTimeString(ko ? 'ko-KR' : 'en-US')}</time><strong>{eventLabel(e, ko)}</strong><span>{e.jobId ?? flow.values[e.keyBase64]?.key.text ?? e.keyBase64}</span><small>{e.origin}{e.late ? tr(' · 지연', ' · late') : ''}</small></p>)}{!flow.events.length && <p>{tr('아직 관측된 변화가 없습니다.', 'No changes observed yet.')}</p>}</div></details>
  </section>;
}
