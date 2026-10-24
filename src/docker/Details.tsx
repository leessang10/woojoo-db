import { Play, Square, RotateCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { buildGraph, isDefaultNetwork, kindLabel, statusLabel, text, tone, type GraphNode, type Snapshot } from './model';
type Props = { node: GraphNode | undefined; snapshot: Snapshot; language: string; disabled: boolean; busy: boolean; onAction: (action: string) => void; onSelect: (id: string) => void; onRemove: () => void; onEdit: () => void; onRename: (name: string) => void };
export function DockerDetails({ node, snapshot, language, disabled, busy, onAction, onSelect, onRemove, onEdit, onRename }: Props) {
  const tr = (ko: string, en: string) => text(language, ko, en);
  const [name, setName] = useState('');
  useEffect(() => setName(node?.container?.name || ''), [node?.id, node?.container?.name]);
  if (!node) return null;
  const c = node.container;
  const all = buildGraph(snapshot, '*', language);
  const neighbors = new Set(all.edges.filter(e => e.source === node.id || e.target === node.id).flatMap(e => [e.source, e.target])); neighbors.delete(node.id);
  const resource = [...snapshot.volumes, ...snapshot.networks, ...snapshot.images].find(r => r.id === node.resourceId);
  return <aside className="docker-details" aria-label={tr('리소스 상세', 'Resource details')}>
    <div className="docker-details-heading"><span className="docker-eyebrow">{kindLabel(node.kind, language)}</span><Button variant="ghost" size="icon-sm" aria-label={tr('상세 닫기', 'Close details')} onClick={() => onSelect('')}><X size={14}/></Button></div><h2>{node.label}</h2>
    {c?.project && <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>{tr('Compose 설정 수정', 'Edit Compose configuration')}</Button>}
    {c && !c.project && <><label>{tr('컨테이너 이름', 'Container name')}<input className="docker-rename-input" value={name} onChange={e => setName(e.target.value)}/></label><Button size="sm" variant="outline" disabled={disabled || busy || !name || name === c.name} onClick={() => onRename(name)}>{tr('이름 변경', 'Rename')}</Button><p>{tr('포트·이미지·마운트 변경은 컨테이너 재생성이 필요합니다. Compose 프로젝트로 구성해 관리하세요.', 'Changing ports, images or mounts requires recreating the container. Manage these settings through a Compose project.')}</p></>}
    {c ? <>
      <p className="docker-state" data-tone={tone(c)}>{statusLabel(c, language)}</p>
      <div className="docker-action-row">
        <Button size="sm" variant="outline" disabled={disabled || busy || !['created', 'exited'].includes(c.state)} onClick={() => onAction('start')}><Play size={13}/>{tr('시작', 'Start')}</Button>
        <Button size="sm" variant="outline" disabled={disabled || busy || !['running', 'restarting'].includes(c.state)} onClick={() => onAction('stop')}><Square size={13}/>{tr('중지', 'Stop')}</Button>
        <Button size="sm" variant="outline" disabled={disabled || busy || !['running', 'exited', 'restarting'].includes(c.state)} onClick={() => onAction('restart')}><RotateCw size={13}/>{tr('재시작', 'Restart')}</Button>
      </div>
      <dl><dt>Context</dt><dd>{snapshot.context}</dd><dt>ID</dt><dd>{c.id}</dd><dt>{tr('프로젝트 / 서비스', 'Project / service')}</dt><dd>{c.project || tr('독립 실행', 'Standalone')} / {c.service || '—'}</dd><dt>{tr('프로세스 상태', 'Process state')}</dt><dd>{c.state}</dd><dt>{tr('건강 상태', 'Health')}</dt><dd>{c.health || tr('헬스체크 미설정 · 정상 여부 미확인', 'No healthcheck · service health unverified')}</dd><dt>{tr('재시작 횟수', 'Restart count')}</dt><dd>{c.restartCount}</dd></dl>
      {(c.state === 'exited' || c.state === 'dead') && <p>{tr('종료 코드', 'Exit code')}: {c.exitCode}{c.exitCode === 0 && ` · ${tr('정상 작업 완료일 수 있습니다.', 'May be a successfully completed task.')}`}<br/>{c.finishedAt}</p>}
      {c.oom && <p className="docker-warning">{tr('메모리 부족으로 종료된 기록이 있습니다.', 'An out-of-memory termination was recorded.')}</p>}
      {c.error && <pre>{c.error}</pre>}{c.healthOutput && <><h3>{tr('최근 헬스체크 출력', 'Latest healthcheck output')}</h3><pre>{c.healthOutput}</pre></>}
      <h3>{tr('접속 포트', 'Ports')}</h3><p>{tr('왼쪽은 Docker 호스트, 오른쪽은 컨테이너 내부입니다.', 'Left: Docker host. Right: inside the container.')}</p>
      {c.networkMode === 'host' && <p>{tr('호스트 네트워크를 직접 사용합니다.', 'Uses the host network directly.')}</p>}
      {c.ports.length ? c.ports.map((p, i) => <code className="docker-detail-line" key={i}>{p.hostPort ? `${p.hostIp || '0.0.0.0'}:${p.hostPort} → ${p.privatePort}` : `${p.privatePort} · ${tr('호스트 미공개', 'Not published')}`}</code>) : <p>{tr('공개 포트 없음', 'No published ports')}</p>}
      <h3>{tr('저장소 마운트', 'Storage mounts')}</h3>
      {!c.mounts.length && <p>{tr('마운트 없음 · 데이터는 컨테이너 내부에만 저장될 수 있습니다.', 'No mounts · data may exist only inside the container.')}</p>}
      {c.mounts.map((m, i) => <div className="docker-mount" key={i}><strong>{m.kind === 'volume' ? tr('Docker 볼륨', 'Docker volume') : m.kind === 'tmpfs' ? tr('임시 메모리', 'Temporary memory') : tr('호스트 경로', 'Host path')}</strong><code>{m.name || m.source || 'tmpfs'}</code><span>↓ {tr('컨테이너 내부', 'Inside container')}</span><code>{m.target}</code><small>{m.rw ? tr('읽기/쓰기', 'Read/write') : tr('읽기 전용', 'Read only')}</small></div>)}
    </> : <><p>{node.detail}</p>{resource?.detail && <code className="docker-detail-line">{resource.detail}</code>}{node.kind === 'volume' && <p>{tr('Docker 엔진이 관리하는 저장소입니다. 경로는 Docker 호스트 기준이며 Windows 파일 경로와 다를 수 있습니다.', 'Storage managed by Docker. Its path belongs to the Docker host and may not be a Windows filesystem path.')}</p>}{node.kind === 'bind' && <p>{tr('Docker 호스트의 경로를 컨테이너에 연결합니다. 원격 또는 WSL 경로일 수 있습니다.', 'Mounts a Docker host path into a container. This may be a remote or WSL path.')}</p>}{node.kind === 'port' && <p>{tr('0.0.0.0과 ::는 모든 인터페이스의 바인딩 주소입니다. HTTP 서비스 또는 접속 성공을 뜻하지 않습니다.', '0.0.0.0 and :: bind all interfaces. A published port does not imply HTTP or successful connectivity.')}</p>}</>}
    <h3>{tr('연결된 리소스', 'Connected resources')}</h3>
    {all.nodes.filter(n => neighbors.has(n.id)).map(n => <Button key={n.id} variant="ghost" size="sm" className="docker-neighbor" onClick={() => onSelect(n.id)}>{n.label}{n.container?.project && <small>{n.container.project}</small>}</Button>)}
    {!neighbors.size && <p>{snapshot.complete ? tr('현재 컨테이너 참조 없음. 삭제 안전성을 뜻하지 않습니다.', 'No current container reference. This does not establish deletion safety.') : tr('일부 조회가 실패하여 참조 상태를 알 수 없습니다.', 'References are unverified because some queries failed.')}</p>}
    <div className="docker-danger-zone">{['container', 'image', 'volume', 'network'].includes(node.kind) && <Button size="sm" variant="destructive" disabled={disabled || busy || isDefaultNetwork(node)} onClick={onRemove}>{tr('리소스 삭제', 'Delete resource')}</Button>}</div>
  </aside>;
}
