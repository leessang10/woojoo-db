import { useEffect, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useNodesInitialized, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { Archive, Bell, Circle, Database, Download, Inbox, LayoutGrid, Loader2, Network, Radio, RefreshCw, Server, Split, Target, X, Zap, type LucideIcon } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useLanguage } from '../i18n';
import type { Theme } from '../theme';
import { awsCancel, awsError, awsTopologyQuery, type TopologyKind } from '../aws';
import { AwsError } from './AwsError';
import { requestId, type AwsTab } from './model';
import { buildTopology, collectTopology, type InfraNode, type Inventory } from './topology-data';
import { layoutTopology, type ViewMode } from './topology-layout';

const ICONS: Record<string, LucideIcon> = { vpc: Network, subnet: LayoutGrid, ec2: Server, rds: Database, elb: Split, target: Target, s3: Archive, lambda: Zap, sqs: Inbox, sns: Bell, events: Radio };
type Data = { resource: InfraNode; mode: ViewMode; label: string };
function ResourceNode({ data }: NodeProps<Node<Data>>) {
  const r = data.resource, Icon = ICONS[r.kind] ?? Circle;
  return <div className={`infra-card infra-${r.kind}`} title={`${r.name}\n${r.subtitle}\n${r.id}`}>
    <Handle type="target" position={Position.Left} isConnectable={false}/>
    <span className="infra-icon"><Icon size={16}/></span>
    <small>{r.kind.toUpperCase()}</small>
    {data.mode !== 'icons' && <strong>{r.name}</strong>}
    {data.mode === 'detail' && <><span>{r.subtitle}</span><code>{r.id}</code></>}
    <Handle type="source" position={Position.Right} isConnectable={false}/>
    <Handle id="logs-out" type="source" position={Position.Top} isConnectable={false}/>
    <Handle id="logs-in" type="target" position={Position.Top} isConnectable={false}/>
  </div>;
}
const GroupNode = ({ data }: NodeProps<Node<Data>>) => <div className="infra-group-label" title={data.resource.id}>{data.label}</div>;
const nodeTypes = { resource: ResourceNode, group: GroupNode };
function FitView({ fitted }: { fitted: { current: boolean } }) {
  const ready = useNodesInitialized(), flow = useReactFlow();
  useEffect(() => { if (!ready || fitted.current) return; const frame = requestAnimationFrame(() => { fitted.current = true; void flow.fitView({ padding: 0.15 }); }); return () => cancelAnimationFrame(frame); }, [ready, fitted, flow]);
  return null;
}

export default function TopologyView(props: { tab: AwsTab; revision: number; theme: Theme }) {
  return <ReactFlowProvider><Topology {...props}/></ReactFlowProvider>;
}
function Topology({ tab, revision, theme }: { tab: AwsTab; revision: number; theme: Theme }) {
  const { t, language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [inventory, setInventory] = useState<Inventory>();
  const [nodes, setNodes] = useState<Node<Data>[]>([]), [edges, setEdges] = useState<Edge[]>([]);
  const [mode, setMode] = useState<ViewMode>('simple'), [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]), [selected, setSelected] = useState<InfraNode>(), [exporting, setExporting] = useState(false);
  const fitted = useRef(false), pending = useRef<Inventory | undefined>(undefined), publishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const epoch = useRef(0), running = useRef(new Set<string>()), canvas = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  function clearPublish() { clearTimeout(publishTimer.current); publishTimer.current = undefined; pending.current = undefined; }
  function flushPublish() { const snapshot = pending.current; clearPublish(); if (snapshot) setInventory(snapshot); }
  function stop() { for (const request of running.current) void awsCancel(request); running.current.clear(); }
  async function collect() {
    const id = ++epoch.current; stop(); clearPublish();
    const active = () => epoch.current === id;
    setBusy(true); setError(''); setMessage('');
    try {
      const read = async (kind: string, resource?: string, nextToken?: string) => {
        const request = requestId(); running.current.add(request);
        try { return await awsTopologyQuery({ profile: tab.profile, region: tab.region, kind: kind as TopologyKind, resource, nextToken, request }); }
        finally { running.current.delete(request); }
      };
      const result = await collectTopology(read, { account: '', profile: tab.profile, region: tab.region }, active, value => { if (active()) setProgress(value); }, true, snapshot => {
        if (!active()) return;
        pending.current = snapshot;
        if (publishTimer.current === undefined) publishTimer.current = setTimeout(() => { if (active()) flushPublish(); }, 750);
      });
      if (active()) { clearPublish(); setInventory(result); setSelected(current => current ? buildTopology(result).nodes.find(node => node.id === current.id) ?? (result.warnings.length ? current : undefined) : undefined); }
    } catch (reason) {
      if (active()) setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      if (active()) { flushPublish(); setBusy(false); setProgress(''); }
    }
  }
  useEffect(() => { void collect(); }, [revision]);
  useEffect(() => () => { epoch.current++; stop(); clearPublish(); }, []);
  useEffect(() => {
    if (!inventory) return;
    let active = true;
    const graph = buildTopology(inventory);
    setWarnings([...inventory.warnings, ...graph.warnings]);
    Promise.resolve().then(() => layoutTopology(graph, mode)).then(positions => {
      if (!active) return;
      const byId = new Map(graph.nodes.map(node => [node.id, node]));
      setNodes(positions.map(position => {
        const r = byId.get(position.id)!, group = r.kind === 'vpc' || r.kind === 'subnet';
        return { id: r.id, parentId: r.parent, extent: r.parent ? 'parent' as const : undefined, type: group ? 'group' : 'resource', position: { x: position.x, y: position.y }, style: { width: position.width, height: position.height }, className: group ? `infra-group infra-${r.kind}` : '', data: { resource: r, mode, label: `${r.kind.toUpperCase()} · ${r.name}${mode === 'detail' ? ` · ${r.subtitle}` : ''}` }, ariaLabel: `${r.kind}: ${r.name}. ${r.subtitle}` };
      }));
      setEdges(graph.edges.map(edge => ({ ...edge, label: mode === 'icons' ? undefined : edge.relation, sourceHandle: edge.relation === 'access logs' ? 'logs-out' : undefined, targetHandle: edge.relation === 'access logs' ? 'logs-in' : undefined, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed }, className: 'infra-edge' })));
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [inventory, mode]);
  async function exportImage(format: 'png' | 'pdf') {
    const viewport = canvas.current?.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport || !nodes.length || exporting) return;
    setExporting(true); setError(''); setMessage('');
    try {
      const { exportDiagram } = await import('../erd-export');
      // Export works on absolute positions; child nodes are stored relative to their group.
      const absolute = flow.getNodes().map(node => ({ ...node, position: flow.getInternalNode(node.id)?.internals.positionAbsolute ?? node.position, parentId: undefined }));
      if (await exportDiagram(viewport, absolute, format, `aws-${tab.profile}-${tab.region}`, theme === 'dark' ? '#181b20' : '#ffffff')) setMessage(tr('내보내기 완료', 'Export complete'));
    } catch (reason) { setError(String(reason)); }
    finally { setExporting(false); }
  }
  const count = (kind: string) => nodes.filter(node => node.data.resource.kind === kind).length;
  return <section className="aws-topology">
    <div className="result-toolbar aws-toolbar">
      <NativeSelect size="sm" aria-label={tr('표시 방식', 'Display')} value={mode} onChange={event => setMode(event.target.value as ViewMode)}>
        <NativeSelectOption value="icons">{tr('아이콘만', 'Icons')}</NativeSelectOption><NativeSelectOption value="simple">{tr('간단히', 'Simple')}</NativeSelectOption><NativeSelectOption value="detail">{tr('자세히', 'Detailed')}</NativeSelectOption>
      </NativeSelect>
      <span className="aws-count" role="status">{busy ? <><Loader2 size={13} className="spin"/> {tr('수집 중', 'Collecting')} {progress && `· ${progress}`}</> : inventory ? `VPC ${count('vpc')} · ${tr('서브넷', 'Subnets')} ${count('subnet')} · EC2 ${count('ec2')} · RDS ${count('rds')} · ELB ${count('elb')} · S3 ${count('s3')}` : ''}</span>
      <span className="tabs-spacer"/>
      {message && <span className="aws-updated" role="status">{message}</span>}
      <Button variant="outline" size="sm" disabled={!nodes.length || exporting || busy} onClick={() => void exportImage('png')}><Download size={14}/>PNG</Button>
      <Button variant="outline" size="sm" disabled={!nodes.length || exporting || busy} onClick={() => void exportImage('pdf')}><Download size={14}/>PDF</Button>
      {busy ? <Button variant="outline" size="sm" onClick={() => { epoch.current++; stop(); flushPublish(); setBusy(false); setProgress(''); }}><X size={14}/>{tr('중지', 'Stop')}</Button>
        : <Button variant="ghost" size="bare" className="icon-button" aria-label={tr('다시 수집', 'Collect again')} title={tr('다시 수집', 'Collect again') + ' · F5'} onClick={() => void collect()}><RefreshCw size={15}/></Button>}
    </div>
    <AwsError error={error} profile={tab.profile} onRetry={() => void collect()}/>
    {warnings.length > 0 && <details className="aws-warnings"><summary>{tr(`일부 리소스를 읽지 못했습니다 (${warnings.length})`, `Some resources could not be read (${warnings.length})`)}</summary><ul>{warnings.map((warning, index) => <li key={index}>{warning.replace(/AWS_[A-Z_]+/g, code => t(awsError(code)))}</li>)}</ul></details>}
    <div className="aws-topology-body">
      <div className="aws-topology-canvas" ref={canvas}>
        {nodes.length > 0 ? <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode={theme} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} minZoom={0.05} onNodeClick={(_, node) => setSelected(node.data.resource)} onPaneClick={() => setSelected(undefined)} proOptions={{ hideAttribution: true }}>
          <FitView fitted={fitted}/><Background/><Controls showInteractive={false}/><MiniMap pannable zoomable/>
        </ReactFlow> : !busy && inventory && <div className="empty-result"><Network size={28}/><h3>{tr('표시할 인프라가 없습니다', 'No infrastructure to show')}</h3><p>{tr(`${tab.region} 리전에서 VPC·EC2·RDS·ELB·S3를 찾지 못했습니다.`, `No VPC, EC2, RDS, ELB or S3 found in ${tab.region}.`)}</p></div>}
        {busy && !nodes.length && <div className="empty-result" role="status"><Loader2 size={22} className="spin"/><p>{tr('VPC·서브넷·EC2·RDS·ELB·S3 정보를 모으는 중…', 'Collecting VPC, subnet, EC2, RDS, ELB and S3 data…')}</p></div>}
      </div>
      {selected && <aside className="aws-topology-inspector" aria-label={tr('선택한 리소스', 'Selected resource')}>
        <div className="aws-inspector-heading"><small>{selected.kind.toUpperCase()}</small><Button variant="ghost" size="bare" className="icon-button" aria-label={tr('닫기', 'Close')} onClick={() => setSelected(undefined)}><X size={14}/></Button></div>
        <h3 title={selected.name}>{selected.name}</h3><p>{selected.subtitle}</p><code>{selected.id}</code>
        <pre className="aws-json">{JSON.stringify(selected.raw, null, 2)}</pre>
      </aside>}
    </div>
  </section>;
}
