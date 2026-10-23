import dagre from '@dagrejs/dagre';
import type { InfraGraph } from './topology-data';
export type ViewMode = 'icons' | 'simple' | 'detail';
type Box = { x: number; y: number; width: number; height: number };
// Space a VPC or subnet keeps around its children, with room for its label on top.
const PAD = { top: 44, side: 20, bottom: 20 };

/** Lays the graph out left to right with dagre; positions are relative to each node's parent group, parents first. */
export function layoutTopology(graph: InfraGraph, mode: ViewMode) {
  const size = mode === 'icons' ? [82, 76] : mode === 'simple' ? [220, 86] : [280, 132];
  const groupKinds = new Set(['vpc', 'subnet']);
  const parents = new Set(graph.nodes.map(node => node.parent).filter(Boolean) as string[]);
  const isGroup = (id: string, kind: string) => groupKinds.has(kind) && parents.has(id);
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 110, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of graph.nodes) g.setNode(node.id, isGroup(node.id, node.kind) ? {} : { width: size[0], height: size[1] });
  for (const node of graph.nodes) if (node.parent) g.setParent(node.id, node.parent);
  for (const edge of graph.edges) g.setEdge(edge.source, edge.target, mode === 'icons' ? {} : { width: 100, height: 20, labelpos: 'c' }, edge.id);
  dagre.layout(g);

  const absolute = new Map<string, Box>();
  for (const node of graph.nodes) {
    if (isGroup(node.id, node.kind)) continue;
    const placed = g.node(node.id);
    absolute.set(node.id, { x: placed.x - size[0] / 2, y: placed.y - size[1] / 2, width: size[0], height: size[1] });
  }
  // Groups wrap their children, deepest first, so a VPC also wraps its subnets.
  const depth = (id: string): number => { const parent = graph.nodes.find(node => node.id === id)?.parent; return parent ? 1 + depth(parent) : 0; };
  const groups = graph.nodes.filter(node => isGroup(node.id, node.kind)).sort((a, b) => depth(b.id) - depth(a.id));
  for (const group of groups) {
    const boxes = graph.nodes.filter(node => node.parent === group.id).map(node => absolute.get(node.id)).filter(Boolean) as Box[];
    const left = Math.min(...boxes.map(box => box.x)) - PAD.side, top = Math.min(...boxes.map(box => box.y)) - PAD.top;
    const right = Math.max(...boxes.map(box => box.x + box.width)) + PAD.side, bottom = Math.max(...boxes.map(box => box.y + box.height)) + PAD.bottom;
    absolute.set(group.id, { x: left, y: top, width: right - left, height: bottom - top });
  }
  return graph.nodes
    .map(node => ({ node, depth: depth(node.id) }))
    .sort((a, b) => a.depth - b.depth)
    .map(({ node }) => {
      const box = absolute.get(node.id)!, parent = node.parent ? absolute.get(node.parent) : undefined;
      return { id: node.id, x: box.x - (parent?.x ?? 0), y: box.y - (parent?.y ?? 0), width: box.width, height: box.height };
    });
}
