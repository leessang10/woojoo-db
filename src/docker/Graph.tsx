import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Node, type NodeProps, type Viewport } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { Box, Container as ContainerIcon, Database, Folder, MemoryStick, Network, Plug, LayoutGrid, Scan } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Theme } from '../theme';
import { kindLabel, text, tone, type GraphNode, type Topology } from './model';
import '@xyflow/react/dist/style.css';

type NodeData = { item: GraphNode; language: string; dim: boolean };
type DockerNode = Node<NodeData, 'docker'>;
const icons = { image: Box, container: ContainerIcon, volume: Database, bind: Folder, tmpfs: MemoryStick, network: Network, port: Plug };
function ResourceNode({ data, selected }: NodeProps<DockerNode>) {
  const { item, language } = data; const Icon = icons[item.kind];
  return <div className={`docker-node kind-${item.kind} ${selected ? 'selected' : ''} ${data.dim ? 'dim' : ''}`} data-tone={item.container ? tone(item.container) : 'neutral'}>
    <Handle type="target" position={Position.Left}/><Handle type="source" position={Position.Right}/>
    <header><Icon size={15}/><span>{kindLabel(item.kind, language)}</span>{item.container && <i className="docker-status-dot"/>}</header>
    <strong title={item.label}>{item.label}</strong><small title={item.detail}>{item.detail}</small>
  </div>;
}
const nodeTypes = { docker: ResourceNode };
function layout(items: GraphNode[], edges: Topology['edges']) {
  const g = new dagre.graphlib.Graph({ multigraph: true }); g.setGraph({ rankdir: 'LR', nodesep: 42, ranksep: 165 }); g.setDefaultEdgeLabel(() => ({}));
  items.forEach(n => g.setNode(n.id, { width: 250, height: 110 }));
  edges.forEach(e => g.setEdge(e.source, e.target, {}, e.id)); dagre.layout(g);
  return Object.fromEntries(items.map(n => { const p = g.node(n.id); return [n.id, { x: p.x - 125, y: p.y - 55 }]; }));
}
function savedView(key: string): { positions?: Record<string, { x: number; y: number }>; viewport?: Viewport } {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; }
}
type Props = { graph: Topology; selected: string; onSelect: (id: string) => void; language: string; theme: Theme; storageKey: string };
export function DockerGraph(props: Props) { return <ReactFlowProvider><Canvas {...props}/></ReactFlowProvider>; }
function Canvas({ graph, selected, onSelect, language, theme, storageKey }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<DockerNode>([]);
  const flow = useReactFlow<DockerNode>(); const saved = useRef(savedView(storageKey));
  const [layoutVersion, setLayoutVersion] = useState(0);
  const related = useMemo(() => new Set([selected, ...graph.edges.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target])]), [graph, selected]);
  useEffect(() => {
    const positions = layout(graph.nodes, graph.edges);
    setNodes(previous => graph.nodes.map(item => ({ id: item.id, type: 'docker', position: previous.find(n => n.id === item.id)?.position ?? saved.current.positions?.[item.id] ?? positions[item.id], selected: item.id === selected, data: { item, language, dim: !!selected && !related.has(item.id) } })));
  }, [graph, selected, language, related, setNodes, layoutVersion]);
  const edges = useMemo(() => graph.edges.map(e => ({ ...e, type: 'smoothstep', style: { stroke: 'var(--muted-foreground)', opacity: !selected || e.source === selected || e.target === selected ? .8 : .13 }, labelStyle: { fill: 'var(--foreground)', fontSize: 11 }, labelBgStyle: { fill: 'var(--background)', fillOpacity: .95 }, labelBgPadding: [6, 4] as [number, number] })), [graph, selected]);
  function save(viewport = flow.getViewport()) {
    saved.current = { positions: { ...saved.current.positions, ...Object.fromEntries(flow.getNodes().map(n => [n.id, n.position])) }, viewport };
    try { localStorage.setItem(storageKey, JSON.stringify(saved.current)); } catch { /* Session only. */ }
  }
  return <div className="docker-canvas" aria-label={text(language, 'Docker 리소스 관계도', 'Docker resource topology')}>
    <div className="docker-canvas-actions"><Button variant="outline" size="sm" onClick={() => { const positions = layout(graph.nodes, graph.edges); setNodes(ns => ns.map(n => ({ ...n, position: positions[n.id] }))); saved.current.positions = { ...saved.current.positions, ...positions }; setLayoutVersion(v => v + 1); requestAnimationFrame(() => { void flow.fitView({ padding: .2 }); save(); }); }}><LayoutGrid size={14}/>{text(language, '자동 배치', 'Arrange')}</Button><Button variant="outline" size="sm" onClick={() => void flow.fitView({ padding: .2 })}><Scan size={14}/>{text(language, '화면 맞춤', 'Fit')}</Button></div>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeClick={(_, n) => onSelect(n.id)} onPaneClick={() => onSelect('')} onNodeDragStop={() => save()} onMoveEnd={(_, viewport) => save(viewport)} defaultViewport={saved.current.viewport} fitView={!saved.current.viewport} fitViewOptions={{ padding: .2 }} minZoom={.15} maxZoom={1.8} nodesConnectable={false} deleteKeyCode={null} colorMode={theme === 'dark' ? 'dark' : 'light'}>
      <Background gap={22} size={1}/><Controls showInteractive={false}/><MiniMap pannable zoomable nodeColor="var(--muted-foreground)"/>
    </ReactFlow>
    {!graph.nodes.length && <div className="docker-graph-empty">{text(language, '표시할 리소스가 없습니다.', 'No resources to display.')}</div>}
  </div>;
}
