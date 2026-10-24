import { describe, expect, it } from 'vitest';
import { appendLogs, buildGraph, projects, statusLabel, type Container, type Snapshot } from './model';

const c: Container = { id: 'abc', name: 'db', imageId: 'sha256:img', image: 'postgres:16', project: 'app', service: 'db', state: 'running', health: '', exitCode: 0, oom: false, error: '', finishedAt: '', restartCount: 0, networkMode: 'default', healthOutput: '', ports: [{ privatePort: '5432/tcp', hostIp: '127.0.0.1', hostPort: '15432' }, { privatePort: '80/tcp', hostIp: '', hostPort: '' }], mounts: [{ kind: 'volume', name: 'data', source: '/docker/data', target: '/data', rw: true }, { kind: 'bind', name: '', source: 'C:\\work', target: '/work', rw: false }, { kind: 'tmpfs', name: '', source: '', target: '/tmp', rw: true }], networks: [{ id: 'net', name: 'default', ip: '172.1.0.2' }] };
const s: Snapshot = { context: 'local', containers: [c], images: [{ id: 'sha256:img', name: 'postgres:16', project: '', detail: '' }], volumes: [{ id: 'data', name: 'data', project: 'app', detail: '/docker/data' }], networks: [{ id: 'net', name: 'default', project: 'app', detail: 'bridge' }], warnings: [], complete: true };
describe('Docker topology semantics', () => {
  it('connects actual published ports and distinct storage kinds without inventing an exposed binding', () => {
    const graph = buildGraph(s, 'app', 'en');
    expect(graph.nodes.filter(n => n.kind === 'port')).toHaveLength(1);
    expect(graph.nodes.find(n => n.kind === 'port')?.label).toBe('127.0.0.1:15432');
    expect(graph.nodes.map(n => n.kind)).toEqual(expect.arrayContaining(['image', 'container', 'volume', 'bind', 'tmpfs', 'network']));
    expect(graph.edges.map(e => e.label)).toContain('/work · Read only');
    expect(graph.nodes.find(n => n.kind === 'bind')?.label).toBe('C:\\work');
  });
  it('includes resource-only projects and shares one image/volume node', () => {
    const next = { ...s, containers: [c, { ...c, id: 'def', name: 'db2' }], volumes: [...s.volumes, { id: 'orphan', name: 'orphan', project: 'old', detail: '' }] };
    expect(projects(next)).toContain('old');
    expect(buildGraph(next, 'app', 'en').nodes.filter(n => n.kind === 'volume')).toHaveLength(1);
    expect(buildGraph(next, 'old', 'en').nodes.map(n => n.label)).toContain('orphan');
    expect(buildGraph(next, '*', 'en').nodes.filter(n => n.kind === 'image')).toHaveLength(1);
  });
  it('qualifies stable identifiers with context', () => {
    expect(buildGraph(s, '*', 'en').nodes[0].id).not.toBe(buildGraph({ ...s, context: 'remote' }, '*', 'en').nodes[0].id);
  });
  it('does not label resources referenced from another project as unreferenced', () => {
    const next = { ...s, containers: [{ ...c, project: 'other' }] };
    expect(buildGraph(next, 'app', 'en').nodes.find(n => n.kind === 'volume')?.detail).not.toContain('No current');
  });
  it('does not equate running with healthy or an old restart count with a loop', () => {
    expect(statusLabel(c, 'en')).toContain('Unverified');
    expect(statusLabel({ ...c, health: 'unhealthy' }, 'en')).toContain('Unhealthy');
    expect(statusLabel({ ...c, restartCount: 8 }, 'en')).not.toContain('Restarting');
    expect(statusLabel({ ...c, state: 'exited' }, 'en')).toContain('0');
  });
  it('bounds logs by bytes and line count and reports dropped data', () => {
    const result = appendLogs([], Array.from({ length: 5100 }, (_, i) => String(i)));
    expect(result.lines).toHaveLength(5000); expect(result.truncated).toBe(true);
    expect(appendLogs([], ['한'.repeat(800000)]).lines.join('').length).toBeLessThanOrEqual(699050);
  });
});
