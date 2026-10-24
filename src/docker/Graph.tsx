import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Node, type NodeProps, type Viewport } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { Box, Container as ContainerIcon, Database, Folder, MemoryStick, Network, Plug, LayoutGrid, Scan, Plus, Minus, Map as MapIcon, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContextMenu, type MenuState } from '../ContextMenu';
import type { Theme } from '../theme';
import { kindLabel, text, tone, type GraphNode, type Topology } from './model';
import { neighbors } from './view';
import type { ResourceMenuEvent } from './ResourceTable';
import '@xyflow/react/dist/style.css';

type NodeData = { item: GraphNode; language: string; dim: boolean };
type DockerNode = Node<NodeData, 'docker'>;
export type ProjectGroup = { id: string; label: string; summary: string; expanded: boolean; onToggle: () => void };
type GroupNode = Node<{ group: ProjectGroup; language: string }, 'projectGroup'>;
type CanvasNode = DockerNode | GroupNode;
const icons = { image: Box, container: ContainerIcon, volume: Database, bind: Folder, tmpfs: MemoryStick, network: Network, port: Plug };
function ResourceNode({ data, selected }: NodeProps<DockerNode>) {
  const { item, language } = data; const Icon = icons[item.kind];
  return <div className={`docker-node kind-${item.kind} ${selected ? 'selected' : ''} ${data.dim ? 'dim' : ''}`} data-tone={item.container ? tone(item.container) : 'neutral'}>
    <Handle type="target" position={Position.Left}/><Handle type="source" position={Position.Right}/>
    <header><Icon size={15}/><span>{kindLabel(item.kind, language)}</span>{item.container && <i className="docker-status-dot"/>}</header>
    <strong title={item.label}>{item.label}</strong><small title={item.detail}>{item.detail}</small>
  </div>;
}
function ProjectNode({ data }: NodeProps<GroupNode>) {
  return <div className="docker-project-group"><header><div><strong>{data.group.label}</strong><small>{data.group.summary}</small></div><Button className="nodrag nopan" variant="outline" size="sm" aria-expanded={data.group.expanded} aria-label={`${data.group.label} ${text(data.language, '리소스 펼치기', 'Expand resources')}`} onClick={data.group.onToggle}>{data.group.expanded ? text(data.language, '접기', 'Collapse') : text(data.language, '펼치기', 'Expand')}</Button></header></div>;
}
const nodeTypes = { docker: ResourceNode, projectGroup: ProjectNode };
function layout(items: GraphNode[], edges: Topology['edges']) {
  const g = new dagre.graphlib.Graph({ multigraph: true }); g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 180 }); g.setDefaultEdgeLabel(() => ({}));
  items.forEach(n => g.setNode(n.id, { width: 250, height: 110 }));
  edges.forEach(e => g.setEdge(e.source, e.target, {}, e.id)); dagre.layout(g);
  return Object.fromEntries(items.map(n => { const p = g.node(n.id); return [n.id, { x: p.x - 125, y: p.y - 55 }]; }));
}
function savedView(key: string): { positions?: Record<string, { x: number; y: number }>; viewport?: Viewport } {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; }
}
type Props = { graph: Topology; selected: string; onSelect: (id: string) => void; language: string; theme: Theme; storageKey: string; onResourceMenu?: (event: ResourceMenuEvent, node: GraphNode) => void; groups?: ProjectGroup[]; assignments?: Map<string, string> };
export function DockerGraph(props: Props) { return <ReactFlowProvider><Canvas {...props}/></ReactFlowProvider>; }
function Canvas({ graph, selected, onSelect, language, theme, storageKey, onResourceMenu, groups, assignments }: Props) {
  const tr = (ko: string, en: string) => text(language, ko, en);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const flow = useReactFlow<CanvasNode>(); const saved = useRef(savedView(storageKey));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [minimap, setMinimap] = useState(() => { try { return localStorage.getItem('woojoo-docker-minimap') === 'true'; } catch { return false; } });
  const [zoom, setZoom] = useState(saved.current.viewport?.zoom ?? 1);
  const related = useMemo(() => neighbors(graph, selected), [graph, selected]);
  const initialNodes = useMemo(() => {
    const positions = layout(graph.nodes, graph.edges);
    const parents: GroupNode[] = [];
    const grouped = new Map<string, { parentId: string; position: { x: number; y: number } }>();
    let y = 0;
    groups?.forEach((group, index) => {
      const children = graph.nodes.filter(n => assignments?.get(n.id) === group.id);
      const childIds = new Set(children.map(n => n.id));
      const childEdges = graph.edges.filter(e => childIds.has(e.source) && childIds.has(e.target));
      const detailed = children.some(n => !n.container);
      const local = detailed ? layout(children, childEdges) : Object.fromEntries(children.map((n, i) => [n.id, { x: i % 2 * 280, y: Math.floor(i / 2) * 144 }]));
      const width = Math.max(580, ...children.map(n => local[n.id].x + 298));
      const height = Math.max(90, ...children.map(n => local[n.id].y + 220));
      const parentId = `group:${group.id}`;
      if (index % 2 === 0 && index > 0) y = Math.max(...parents.slice(-2).map(n => n.position.y + Number(n.style?.height))) + 36;
      const x = index % 2 ? Number(parents[index - 1].style?.width) + 36 : 0;
      parents.push({ id: parentId, type: 'projectGroup', position: { x, y }, style: { width, height }, data: { group, language }, draggable: false, selectable: false });
      children.forEach(n => grouped.set(n.id, { parentId, position: { x: 24 + local[n.id].x, y: 78 + local[n.id].y } }));
    });
    const resources: DockerNode[] = graph.nodes.map(item => ({ id: item.id, type: 'docker', position: grouped.get(item.id)?.position ?? positions[item.id], ...(grouped.has(item.id) ? { parentId: grouped.get(item.id)!.parentId, extent: 'parent' as const, draggable: false } : {}), selected: item.id === selected, data: { item, language, dim: !!selected && !related.has(item.id) } }));
    return [...parents, ...resources];
  }, [graph, selected, language, related, groups, assignments]);
  useEffect(() => {
    setNodes(previous => initialNodes.map(n => n.type === 'projectGroup' || groups ? n : { ...n, position: previous.find(p => p.id === n.id)?.position ?? saved.current.positions?.[n.id] ?? n.position }));
  }, [initialNodes, setNodes, groups]);
  const edges = useMemo(() => graph.edges.map(e => ({ ...e, label: groups && !selected ? undefined : <tspan><title>{e.label}</title>{e.label.length > 20 ? e.label.slice(0, 17) + '…' : e.label}</tspan>, type: 'smoothstep', style: { stroke: 'var(--muted-foreground)', opacity: !selected || e.source === selected || e.target === selected ? .8 : .13 }, labelStyle: { fill: 'var(--foreground)', fontSize: 11 }, labelBgStyle: { fill: 'var(--background)', fillOpacity: .95 }, labelBgPadding: [6, 4] as [number, number] })), [graph, selected, groups]);
  const groupShape = groups ? initialNodes.map(n => n.id).join('|') : '';
  useEffect(() => {
    if (!groupShape) return;
    const timer = setTimeout(() => { void flow.fitView({ padding: .15, minZoom: .15, maxZoom: .9, duration: 150 }); }, 80);
    return () => clearTimeout(timer);
  }, [groupShape, flow]);
  function save(viewport = flow.getViewport()) {
    saved.current = { positions: { ...saved.current.positions, ...Object.fromEntries(flow.getNodes().filter(n => n.type === 'docker').map(n => [n.id, n.position])) }, viewport };
    try { localStorage.setItem(storageKey, JSON.stringify(saved.current)); } catch { /* Session only. */ }
  }
  async function fit() { await flow.fitView({ padding: .15, maxZoom: 1, duration: 150 }); save(); }
  function arrange(reset = false) {
    if (reset) { saved.current = {}; try { localStorage.removeItem(storageKey); } catch { /* Session only. */ } }
    setNodes(initialNodes); saved.current.positions = Object.fromEntries(initialNodes.filter(n => n.type === 'docker').map(n => [n.id, n.position]));
    requestAnimationFrame(() => void fit());
  }
  function canvasMenu(event: ResourceMenuEvent) {
    event.preventDefault(); event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ x: 'clientX' in event ? event.clientX : box.left + 24, y: 'clientY' in event ? event.clientY : box.top + 24, trigger: event.currentTarget as HTMLElement, items: [
      { label: tr('화면 맞춤', 'Fit'), action: () => void fit() }, { label: tr('자동 배치', 'Arrange'), action: () => arrange() }, { label: tr('배치 초기화', 'Reset layout'), action: () => arrange(true), divider: true },
    ] });
  }
  return <div className="docker-canvas" tabIndex={0} aria-label={tr('Docker 리소스 관계도', 'Docker resource topology')} onContextMenu={canvasMenu} onKeyDown={event => {
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      const id = (event.target as HTMLElement).closest('.react-flow__node')?.getAttribute('data-id');
      const item = graph.nodes.find(n => n.id === id);
      if (item && onResourceMenu) onResourceMenu(event, item); else canvasMenu(event);
    }
  }}>
    <div className="docker-canvas-actions" aria-label={tr('관계도 도구', 'Graph tools')}>
      <Button variant="outline" size="sm" onClick={() => arrange()}><LayoutGrid size={14}/>{tr('자동 배치', 'Arrange')}</Button>
      <Button variant="outline" size="icon-sm" title={tr('화면 맞춤', 'Fit')} aria-label={tr('화면 맞춤', 'Fit')} onClick={() => void fit()}><Scan size={14}/></Button>
      <Button variant="outline" size="icon-sm" aria-label={tr('축소', 'Zoom out')} onClick={() => void flow.zoomOut()}><Minus size={14}/></Button>
      <span className="docker-zoom">{Math.round(zoom * 100)}%</span>
      <Button variant="outline" size="icon-sm" aria-label={tr('확대', 'Zoom in')} onClick={() => void flow.zoomIn()}><Plus size={14}/></Button>
      <Button variant="outline" size="icon-sm" title={tr('미니맵', 'Minimap')} aria-label={tr('미니맵', 'Minimap')} aria-pressed={minimap} onClick={() => setMinimap(value => { try { localStorage.setItem('woojoo-docker-minimap', String(!value)); } catch { /* Session only. */ } return !value; })}><MapIcon size={14}/></Button>
      <Button variant="outline" size="icon-sm" title={tr('배치 초기화', 'Reset layout')} aria-label={tr('배치 초기화', 'Reset layout')} onClick={() => arrange(true)}><RotateCcw size={14}/></Button>
    </div>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeClick={(_, n) => { if (n.type === 'docker') onSelect(n.id); }} onNodeContextMenu={(event, n) => { if (n.type === 'docker' && onResourceMenu) onResourceMenu(event, n.data.item); else canvasMenu(event); }} onPaneClick={() => onSelect('')} onNodeDragStop={() => save()} onMove={(_, viewport) => setZoom(viewport.zoom)} onMoveEnd={(_, viewport) => save(viewport)} defaultViewport={saved.current.viewport} fitView={!saved.current.viewport} fitViewOptions={{ padding: .15, minZoom: .15, maxZoom: 1 }} minZoom={.15} maxZoom={1.8} nodesConnectable={false} deleteKeyCode={null} colorMode={theme === 'dark' ? 'dark' : 'light'}>
      <Background gap={22} size={1}/>{minimap && <MiniMap pannable zoomable nodeColor="var(--muted-foreground)"/>}
    </ReactFlow>
    {!graph.nodes.length && !groups?.length && <div className="docker-graph-empty">{tr('표시할 리소스가 없습니다.', 'No resources to display.')}</div>}
    {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)}/>}
  </div>;
}
