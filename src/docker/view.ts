import { tone, type Container, type Topology, type Kind, type Snapshot } from './model';
export type StatusFilter = '' | 'running' | 'stopped' | 'error';
export function matchesStatus(c: Container, status: StatusFilter) {
  return !status || (status === 'error' ? tone(c) === 'bad' : status === 'running' ? ['running', 'restarting'].includes(c.state) : ['created', 'exited', 'dead', 'paused'].includes(c.state));
}
export function counts(containers: Container[], language: string) {
  const running = containers.filter(c => matchesStatus(c, 'running')).length;
  const stopped = containers.filter(c => matchesStatus(c, 'stopped')).length;
  const errors = containers.filter(c => matchesStatus(c, 'error')).length;
  return language === 'ko' ? `실행 ${running} · 중지 ${stopped}${errors ? ` · 오류 ${errors}` : ''}` : `Running ${running} · Stopped ${stopped}${errors ? ` · Errors ${errors}` : ''}`;
}
export function neighbors(graph: Topology, id: string) {
  return new Set([id, ...graph.edges.filter(e => e.source === id || e.target === id).flatMap(e => [e.source, e.target])]);
}
export function filterGraph(graph: Topology, query: string, kind: Kind | '', status: StatusFilter, focus: string) {
  const related = focus ? neighbors(graph, focus) : null;
  const statusIds = new Set(graph.nodes.filter(n => n.container && matchesStatus(n.container, status)).flatMap(n => [...neighbors(graph, n.id)]));
  const q = query.trim().toLowerCase();
  const nodes = graph.nodes.filter(n => (!kind || n.kind === kind) && (!related || related.has(n.id)) && (!status || statusIds.has(n.id)) && (!q || `${n.label} ${n.detail} ${n.container?.project ?? ''} ${n.container?.image ?? ''} ${n.container?.ports.map(p => `${p.hostPort} ${p.privatePort}`).join(' ') ?? ''}`.toLowerCase().includes(q)));
  const ids = new Set(nodes.map(n => n.id));
  return { nodes, edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
}
/** Shared dependencies get a separate group; no ownership is invented. */
export function groupAssignments(graph: Topology, snapshot?: Snapshot) {
  const result = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.container) { result.set(n.id, `project:${n.container.project}`); continue; }
    const adjacent = neighbors(graph, n.id);
    const projects = [...new Set(graph.nodes.filter(c => c.container && adjacent.has(c.id)).map(c => c.container!.project))];
    const owner = snapshot && (n.kind === 'image' ? snapshot.images : n.kind === 'volume' ? snapshot.volumes : n.kind === 'network' ? snapshot.networks : []).find(r => r.id === n.resourceId)?.project;
    result.set(n.id, !projects.length && owner ? `project:${owner}` : projects.length === 1 ? `project:${projects[0]}` : projects.length > 1 ? 'shared' : 'unreferenced');
  }
  return result;
}
export function overviewGraph(graph: Topology, expanded: Set<string>, selected: string, assignments: Map<string, string>) {
  const adjacent = selected ? neighbors(graph, selected) : new Set<string>();
  const nodes = graph.nodes.filter(n => n.container || expanded.has(assignments.get(n.id) ?? 'unreferenced') || adjacent.has(n.id));
  const ids = new Set(nodes.map(n => n.id));
  return { nodes, edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
}
