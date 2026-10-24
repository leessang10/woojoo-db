export type Container = {
  id: string; name: string; imageId: string; image: string; project: string; service: string;
  state: string; health: string; exitCode: number; oom: boolean; error: string; finishedAt: string;
  restartCount: number; networkMode: string; healthOutput: string;
  ports: { privatePort: string; hostIp: string; hostPort: string }[];
  mounts: { kind: string; name: string; source: string; target: string; rw: boolean }[];
  networks: { id: string; name: string; ip: string }[];
};
export type Resource = { id: string; name: string; project: string; detail: string };
export type Snapshot = { context: string; containers: Container[]; images: Resource[]; volumes: Resource[]; networks: Resource[]; warnings: string[]; complete: boolean };
export type DockerContext = { name: string; endpoint: string; current: boolean };
export type Kind = 'container' | 'image' | 'port' | 'volume' | 'bind' | 'tmpfs' | 'network';
export type GraphNode = { id: string; kind: Kind; label: string; detail: string; resourceId: string; container?: Container };
export type GraphEdge = { id: string; source: string; target: string; label: string };
export type Topology = { nodes: GraphNode[]; edges: GraphEdge[] };
export const nodeId = (context: string, kind: Kind, id: string) => JSON.stringify([context, kind, id]);
export const text = (language: string, ko: string, en: string) => language === 'ko' ? ko : en;
export function kindLabel(kind: Kind, language: string) {
  return ({ container: text(language, '컨테이너', 'Container'), image: text(language, '이미지', 'Image'), port: text(language, '호스트 포트', 'Host port'), volume: text(language, 'Docker 볼륨', 'Docker volume'), bind: text(language, '호스트 폴더', 'Host path'), tmpfs: text(language, '임시 메모리', 'Temporary memory'), network: text(language, '네트워크', 'Network') })[kind];
}
export function statusLabel(c: Container, language: string): string {
  const state = ({ running: text(language, '실행 중', 'Running'), exited: text(language, '종료됨', 'Exited'), restarting: text(language, '재시작 중', 'Restarting'), paused: text(language, '일시정지', 'Paused'), created: text(language, '생성됨', 'Created'), dead: text(language, '사용 불가', 'Dead'), removing: text(language, '제거 중', 'Removing') } as Record<string, string>)[c.state] ?? c.state;
  if (c.state === 'exited' || c.state === 'dead') return `${state} · ${text(language, '종료 코드', 'Exit code')} ${c.exitCode}`;
  if (c.state !== 'running') return state;
  const health = ({ healthy: text(language, '헬스체크 통과', 'Healthy'), unhealthy: text(language, '헬스체크 실패', 'Unhealthy'), starting: text(language, '헬스체크 준비 중', 'Healthcheck starting') } as Record<string, string>)[c.health] ?? text(language, '정상 여부 미확인', 'Unverified health');
  return `${state} · ${health}`;
}
export function tone(c: Container): 'good' | 'bad' | 'warn' | 'neutral' {
  if (c.health === 'unhealthy' || c.state === 'dead' || (c.state === 'exited' && c.exitCode !== 0)) return 'bad';
  if (c.state === 'running' && c.health === 'healthy') return 'good';
  if (c.state === 'running' || c.state === 'restarting') return 'warn';
  return 'neutral';
}
export function projects(s: Snapshot): string[] {
  return [...new Set([...s.containers, ...s.volumes, ...s.networks].map(c => c.project).filter(Boolean))].sort();
}
export function buildGraph(s: Snapshot, project: string, language: string): Topology {
  const nodes = new Map<string, GraphNode>(); const edges: GraphEdge[] = [];
  const add = (kind: Kind, id: string, label: string, detail: string, container?: Container) => {
    const key = nodeId(s.context, kind, id);
    nodes.set(key, { id: key, kind, label, detail, resourceId: id, container }); return key;
  };
  const edge = (source: string, target: string, label: string) => edges.push({ id: JSON.stringify([source, target, label, edges.length]), source, target, label });
  const containers = s.containers.filter(c => project === '*' || c.project === project);
  for (const c of containers) {
    const id = add('container', c.id, c.name, statusLabel(c, language), c);
    const image = s.images.find(i => i.id === c.imageId);
    edge(add('image', c.imageId, image?.name || c.image || c.imageId, image ? image.detail : text(language, '이미지 메타데이터 미확인', 'Image metadata unavailable')), id, text(language, '생성 이미지', 'Created from'));
    c.ports.filter(p => p.hostPort).forEach(p => {
      const address = p.hostIp.includes(':') ? `[${p.hostIp}]` : p.hostIp || '0.0.0.0';
      edge(add('port', `${address}:${p.hostPort}/${p.privatePort.split('/')[1] ?? 'tcp'}`, `${address}:${p.hostPort}`, text(language, 'Docker 호스트 공개 포트', 'Published on Docker host')), id, `→ ${p.privatePort}`);
    });
    c.mounts.forEach(m => {
      const kind: Kind = m.kind === 'volume' ? 'volume' : m.kind === 'tmpfs' ? 'tmpfs' : 'bind';
      const key = kind === 'volume' ? m.name : kind === 'tmpfs' ? `${c.id}:${m.target}` : m.source;
      const label = kind === 'volume' ? m.name : kind === 'tmpfs' ? m.target : m.source;
      edge(id, add(kind, key, label, kind === 'tmpfs' ? text(language, '컨테이너 메모리 · 비영구', 'Container memory · ephemeral') : kind === 'bind' ? text(language, 'Docker 호스트의 실제 경로', 'Path on Docker host') : text(language, 'Docker가 관리하는 저장소', 'Storage managed by Docker')), `${m.target} · ${m.rw ? text(language, '읽기/쓰기', 'Read/write') : text(language, '읽기 전용', 'Read only')}`);
    });
    c.networks.forEach(n => edge(id, add('network', n.id || n.name, n.name, s.networks.find(r => r.id === n.id)?.detail ?? ''), text(language, '네트워크 소속', 'Member of')));
  }
  const include = (r: Resource) => project === '*' || !!project && r.project === project;
  for (const [kind, resources] of [['image', s.images], ['volume', s.volumes], ['network', s.networks]] as const) {
    for (const r of resources.filter(include)) {
      const referenced = s.containers.some(c => kind === 'image' ? c.imageId === r.id : kind === 'volume' ? c.mounts.some(m => m.kind === 'volume' && m.name === r.id) : c.networks.some(n => n.id === r.id));
      if (!nodes.has(nodeId(s.context, kind, r.id))) add(kind, r.id, r.name, referenced ? text(language, '다른 프로젝트의 컨테이너에서 사용', 'Referenced by another project') : s.complete ? text(language, '현재 컨테이너 참조 없음', 'No current container reference') : text(language, '참조 상태 미확인', 'References unverified'));
    }
  }
  return { nodes: [...nodes.values()], edges };
}

const MAX_LOG_BYTES = 2 * 1024 * 1024;
export function appendLogs(previous: string[], incoming: string[]): { lines: string[]; truncated: boolean } {
  const all = [...previous, ...incoming]; let truncated = all.length > 5000;
  const lines = all.slice(-5000); const encoder = new TextEncoder(); let bytes = 0; let start = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const size = encoder.encode(lines[i]).length + 1;
    if (bytes + size > MAX_LOG_BYTES) { truncated = true; break; }
    bytes += size; start = i;
  }
  // A single oversized entry is discarded rather than slicing through UTF-8.
  return { lines: lines.slice(start), truncated };
}
