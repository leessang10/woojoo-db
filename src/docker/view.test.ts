import { describe, it, expect } from 'vitest';
import { buildGraph, type Snapshot } from './model';
import { demoSnapshot } from './demo';
import { filterGraph, groupAssignments, matchesStatus, neighbors, overviewGraph } from './view';

describe('Docker exploration views', () => {
  const s: Snapshot = { ...demoSnapshot, containers: demoSnapshot.containers.map((c, i) => ({ ...c, project: `project-${i}`, state: i ? 'exited' : 'running', exitCode: i ? 1 : 0 })) };
  const graph = buildGraph(s, '*', 'en');
  it('starts with containers and reveals selected dependencies without losing the original graph', () => {
    const assignments = groupAssignments(graph);
    const collapsed = overviewGraph(graph, new Set(), '', assignments);
    expect(collapsed.nodes.every(n => n.kind === 'container')).toBe(true);
    const selected = collapsed.nodes[0].id;
    const revealed = overviewGraph(graph, new Set(), selected, assignments);
    expect(revealed.nodes.map(n => n.id)).toEqual(expect.arrayContaining([...neighbors(graph, selected)]));
    expect(graph.nodes.length).toBeGreaterThan(collapsed.nodes.length);
  });
  it('keeps kind, status, text and neighborhood filters composable', () => {
    const result = filterGraph(graph, '', 'container', 'error', '');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].container?.project).toBe('project-1');
    const selected = result.nodes[0].id;
    expect(filterGraph(graph, 'project-1', 'container', 'stopped', selected).nodes).toHaveLength(1);
    expect(filterGraph(graph, '', 'container', 'running', selected).nodes).toHaveLength(0);
  });
  it('does not call an unverified running container an error', () => {
    expect(matchesStatus({ ...s.containers[0], health: '' }, 'error')).toBe(false);
    expect(matchesStatus({ ...s.containers[0], health: 'unhealthy' }, 'error')).toBe(true);
  });
  it('separates dependencies shared across projects', () => {
    const base = s.containers[0];
    const shared = buildGraph({ ...s, containers: [base, { ...base, id: 'second', project: 'another' }] }, '*', 'en');
    const assignments = groupAssignments(shared);
    expect(assignments.get(shared.nodes.find(n => n.kind === 'image')!.id)).toBe('shared');
    expect(overviewGraph(shared, new Set(['shared']), '', assignments).nodes.some(n => n.kind === 'image')).toBe(true);
  });
});
