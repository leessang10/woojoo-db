import { invoke } from '@tauri-apps/api/core';
import type { Topology, Kind } from './model';
export type ComposeProject = { id: string; context: string; name: string; path: string };
export type ComposeDocument = { project: ComposeProject; source: string };
export type ComposeService = { name: string; image: string; build: boolean; ports: string[]; volumes: string[]; mounts?: { kind: string; source: string; target: string }[]; depends: string[]; profiles: string[] };
export type ComposePreview = { token: string; services: ComposeService[]; volumes: string[] };
export function composeTopology(services: ComposeService[]): Topology {
  const graph: Topology = { nodes: [], edges: [] };
  function add(kind: Kind, key: string, label: string) {
    const id = JSON.stringify([kind, key]);
    if (!graph.nodes.some(n => n.id === id)) graph.nodes.push({ id, kind, resourceId: key, label, detail: 'Compose', });
    return id;
  }
  function edge(source: string, target: string, label: string) { graph.edges.push({ id: `${source}:${target}:${graph.edges.length}`, source, target, label }); }
  for (const service of services) {
    const container = add('container', service.name, service.name);
    edge(add('image', service.image || `build:${service.name}`, service.image || 'Dockerfile'), container, 'image');
    for (const port of service.ports) edge(add('port', `${service.name}:${port}`, port), container, 'port');
    const mounts = service.mounts ?? service.volumes.map(v => ({ kind: 'volume', source: v.split(':')[0], target: v.slice(v.indexOf(':') + 1) }));
    for (const mount of mounts) {
      const kind = mount.kind === 'bind' ? 'bind' : mount.kind === 'tmpfs' ? 'tmpfs' : 'volume';
      const key = mount.source || `${service.name}:${mount.target}`;
      edge(container, add(kind, key, mount.source || mount.target), mount.target || 'mount');
    }
    for (const dep of service.depends) edge(add('container', dep, dep), container, 'depends_on');
  }
  return graph;
}
export const composeList = () => invoke<ComposeProject[]>('compose_list');
export const composeImport = (context: string) => invoke<ComposeDocument | null>('compose_import', { context });
export const composeCreate = (context: string, name: string, source: string) => invoke<ComposeDocument | null>('compose_create', { context, name, source });
export const composeRead = (id: string) => invoke<ComposeDocument>('compose_read', { id });
export const composePreview = (id: string, source: string) => invoke<ComposePreview>('compose_preview', { id, source });
export const composeSave = (id: string, source: string, expected: string) => invoke<ComposeDocument>('compose_save', { id, source, expected });
export const composeAction = (id: string, token: string, action: string, service: string) => invoke<void>('compose_action', { id, token, action, service });
export const composeForget = (id: string) => invoke<void>('compose_forget', { id });
export type WizardService = { name: string; image: string; ports: string; volumes: string; environment: string; command: string; healthcheck: string; restart: string; depends: string[] };
export function newService(template: string): WizardService {
  const base: WizardService = { name: 'service', image: '', ports: '', volumes: '', environment: '', command: '', healthcheck: '', restart: 'unless-stopped', depends: [] };
  if (template === 'postgres') return { ...base, name: 'postgres', image: 'postgres:16', ports: '5432:5432', volumes: 'postgres-data:/var/lib/postgresql/data', environment: 'POSTGRES_PASSWORD=change-me', healthcheck: 'pg_isready -U postgres' };
  if (template === 'redis') return { ...base, name: 'redis', image: 'redis:7', ports: '6379:6379', volumes: 'redis-data:/data', command: 'redis-server --appendonly yes', healthcheck: 'redis-cli ping' };
  return base;
}
const lines = (value: string) => value.split('\n').map(v => v.trim()).filter(Boolean);
const literal = (value: string) => value.replaceAll('$', () => '$$');
export function generateCompose(name: string, services: WizardService[]) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error('프로젝트 이름은 소문자·숫자로 시작하고 소문자·숫자·_-만 사용할 수 있습니다.');
  if (!services.length) throw new Error('서비스를 하나 이상 추가하세요.');
  const result: Record<string, unknown> = {}, volumes: Record<string, object> = {};
  for (const s of services) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(s.name) || Object.hasOwn(result, s.name)) throw new Error('서비스 이름이 잘못되었거나 중복되었습니다.');
    if (!s.image.trim()) throw new Error(`${s.name}: 이미지를 입력하세요.`);
    const environment: Record<string, string> = {};
    for (const line of lines(s.environment)) {
      const eq = line.indexOf('=');
      if (eq < 1) throw new Error('환경변수는 KEY=value 형식으로 입력하세요.');
      environment[line.slice(0, eq)] = literal(line.slice(eq + 1));
    }
    const ports = lines(s.ports).map(port => {
      if (!/^\d+:\d+(\/(tcp|udp))?$/.test(port) || port.split(/[/:]/).slice(0, 2).some(p => +p < 1 || +p > 65535)) throw new Error('포트는 8080:80 형식이며 1~65535 범위여야 합니다.');
      return `127.0.0.1:${port}`;
    });
    const mounts = lines(s.volumes).map(mount => {
      const match = /^([a-zA-Z0-9][a-zA-Z0-9_.-]*):(\/[^:]+)(:ro)?$/.exec(mount);
      if (!match) throw new Error('마법사 볼륨은 data:/data 또는 data:/data:ro 형식입니다. 호스트 경로는 생성 후 Compose 편집에서 설정하세요.');
      volumes[match[1]] = {}; return literal(mount);
    });
    if (s.depends.some(d => d === s.name || !services.some(other => other.name === d))) throw new Error('의존 서비스 이름을 확인하세요.');
    result[s.name] = { image: literal(s.image.trim()), restart: s.restart, ...(ports.length && { ports }), ...(mounts.length && { volumes: mounts }), ...(Object.keys(environment).length && { environment }), ...(s.command && { command: literal(s.command) }), ...(s.healthcheck && { healthcheck: { test: ['CMD-SHELL', literal(s.healthcheck)], interval: '10s', timeout: '5s', retries: 5 } }), ...(s.depends.length && { depends_on: s.depends }) };
  }
  // JSON is a YAML-compatible Compose representation; avoids lossy hand-written YAML escaping.
  return JSON.stringify({ name, services: result, ...(Object.keys(volumes).length && { volumes }) }, null, 2) + '\n';
}
