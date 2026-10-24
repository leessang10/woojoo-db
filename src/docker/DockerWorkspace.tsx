import { SidebarTitle } from '../components/SidebarTitle';
import { ContextMenu, type MenuState } from '../ContextMenu';
import { ResourceTable, type ResourceMenuEvent } from './ResourceTable';
import { counts, filterGraph, groupAssignments, overviewGraph, type StatusFilter } from './view';
import { NativeSelect } from '@/components/ui/native-select';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Container as ContainerIcon, Loader2, PanelLeftClose, PanelLeftOpen, Power, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '../components/ConfirmProvider';
import { desktop } from '../api';
import { useLanguage } from '../i18n';
import type { Theme } from '../theme';
import { dockerAction, dockerContexts, dockerSnapshot, errorMessage, startDockerDesktop } from './api';
import { buildGraph, isDefaultNetwork, kindLabel, projects, text, type DockerContext, type Kind, type Snapshot, type GraphNode } from './model';
import { DockerGraph } from './Graph';
import { DockerDetails } from './Details';
import { DockerLogs } from './Logs';
import { demoSnapshot } from './demo';
import { ComposeManager } from './ComposeManager';
import { StorageManager } from './StorageManager';
import { invoke } from '@tauri-apps/api/core';
import './docker.css';

function read(key: string, fallback = '') { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function save(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Session only. */ } }
const projectKey = (context: string) => `woojoo-docker-project:${context}`;
export function DockerWorkspace({ visible, sidebarOpen, onToggleSidebar, theme }: { visible: boolean; sidebarOpen: boolean; onToggleSidebar: () => void; theme: Theme }) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => text(language, ko, en);
  const { requestConfirm } = useConfirm();
  const [contexts, setContexts] = useState<DockerContext[]>([]), [context, setContext] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [project, setProject] = useState('');
  const [selected, setSelected] = useState(''), [filter, setFilter] = useState(''), [kind, setKind] = useState<Kind | ''>('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(false), [actionBusy, setActionBusy] = useState(false);
  const [contextError, setContextError] = useState('');
  const [view, setView] = useState<'graph' | 'list'>(() => read('woojoo-docker-view') === 'list' ? 'list' : 'graph');
  const [status, setStatus] = useState<StatusFilter>(''), [focusOnly, setFocusOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  useEffect(() => { setMenu(null); }, [context, project, visible, view]);
  useEffect(() => { setFocusOnly(false); setExpanded(new Set()); }, [context, project]);
  const [maintenance, setMaintenance] = useState(false);
  const [createRevision, setCreateRevision] = useState(0);
  const [editProject, setEditProject] = useState(''), [editRevision, setEditRevision] = useState(0);
  const [engineStarting, setEngineStarting] = useState(false); const engineStartLock = useRef(false);
  const [revision, setRevision] = useState(0), [contextRevision, setContextRevision] = useState(0), [checked, setChecked] = useState(0), [demo, setDemo] = useState(false);
  const latest = useRef({ context, visible }); latest.current = { context, visible };
  const chain = useRef<Promise<void>>(Promise.resolve()); const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const actionLock = useRef(false); const pollBusy = useRef(false);
  const ready = useRef(false); ready.current = !!snapshot?.complete && snapshot.context === context && !error && !contextError && !demo && !engineStarting && !maintenance;
  const localDesktop = desktop && !demo && contexts.some(c => c.name === context && c.canStartDesktop);
  const engineUnavailable = error.includes('DOCKER_ENGINE_UNAVAILABLE');
  const engineRunning = !!snapshot && snapshot.context === context && !error && !contextError && !engineStarting && !maintenance;
  const canStartEngine = desktop && !demo && !contextError && contexts.some(c => c.name === context && c.canStartDesktop) && error.includes('DOCKER_ENGINE_UNAVAILABLE');
  async function startEngine() {
    if (!canStartEngine || engineStartLock.current || maintenance) return;
    const target = context; engineStartLock.current = true; setEngineStarting(true); setNotice('');
    try {
      await startDockerDesktop(target);
    } catch (e) { if (latest.current.context === target) setNotice(errorMessage(e, language)); }
    finally {
      engineStartLock.current = false; setEngineStarting(false);
      if (latest.current.context === target) setRevision(v => v + 1);
    }
  }
  useEffect(() => {
    if (!visible || !desktop || demo) return;
    let cancelled = false;
    void dockerContexts().then(list => {
      if (cancelled) return; setContexts(list); setContextError('');
      setContext(previous => list.some(c => c.name === previous) ? previous : list.find(c => c.name === read('woojoo-docker-context'))?.name ?? list.find(c => c.current)?.name ?? list[0]?.name ?? '');
      if (!list.length) setContextError(tr('사용 가능한 Docker context가 없습니다.', 'No Docker contexts available.'));
    }).catch(e => { if (!cancelled) setContextError(String(e)); });
    return () => { cancelled = true; };
  }, [visible, contextRevision, demo]);
  useEffect(() => {
    setSnapshot(null); snapshotRef.current = null; setChecked(0); setSelected(''); setNotice(''); setError('');
    setProject(read(projectKey(context))); if (context) save('woojoo-docker-context', context);
  }, [context]);
  useEffect(() => {
    if (!visible || !context || maintenance || (!desktop && !demo)) return;
    if (demo) { setSnapshot(demoSnapshot); setChecked(Date.now()); setProject('woojoo'); setError(''); return; }
    let cancelled = false; let timer: ReturnType<typeof setTimeout>; let lastResources = 0;
    let resourceSnapshot: Snapshot | null = null;
    function poll() {
      chain.current = chain.current.catch(() => {}).then(async () => {
        if (cancelled) return;
        pollBusy.current = true; setLoading(true);
        const resources = !resourceSnapshot || Date.now() - lastResources >= 30000;
        try {
          const next = await dockerSnapshot(context, resources);
          if (cancelled || next.context !== context) return;
          if (resources) { resourceSnapshot = next; lastResources = Date.now(); }
          const merged = resources || !resourceSnapshot ? next : { ...next, images: resourceSnapshot.images, volumes: resourceSnapshot.volumes, networks: resourceSnapshot.networks, complete: next.complete && resourceSnapshot.complete, warnings: [...new Set([...next.warnings, ...resourceSnapshot.warnings])] };
          setSnapshot(merged); snapshotRef.current = merged; setError(''); setChecked(Date.now());
          setProject(current => { const options = projects(merged); const wanted = read(projectKey(context), current); return wanted === '*' || wanted === '' && merged.containers.some(c => !c.project) || options.includes(wanted) ? wanted : options[0] ?? ''; });
        } catch (e) { if (!cancelled) setError(String(e)); }
        finally { pollBusy.current = false; if (!cancelled) { setLoading(false); timer = setTimeout(poll, 5000); } }
      });
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [context, visible, revision, demo, maintenance]);
  const graph = useMemo(() => snapshot ? buildGraph(snapshot, project, language) : { nodes: [], edges: [] }, [snapshot, project, language]);
  const allGraph = useMemo(() => snapshot ? buildGraph(snapshot, '*', language) : { nodes: [], edges: [] }, [snapshot, language]);
  const matching = useMemo(() => filterGraph(graph, filter, kind, status, focusOnly ? selected : ''), [graph, filter, kind, status, focusOnly, selected]);
  const assignments = useMemo(() => groupAssignments(graph, snapshot ?? undefined), [graph, snapshot]);
  const overview = project === '*' && !filter.trim() && !kind && !status && !focusOnly;
  const groups = useMemo(() => overview ? [...new Set(assignments.values())].sort().map(id => ({
    id, label: id === 'shared' ? tr('공유 리소스', 'Shared resources') : id === 'unreferenced' ? tr('기타 리소스', 'Other resources') : id.slice(8) || tr('독립 실행', 'Standalone'),
    summary: id.startsWith('project:') ? counts(snapshot?.containers.filter(c => c.project === id.slice(8)) ?? [], language) : tr('펼쳐서 리소스 확인', 'Expand to inspect resources'),
    expanded: expanded.has(id), onToggle: () => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
  })) : undefined, [overview, assignments, snapshot, language, expanded]);
  const filtered = useMemo(() => {
    const source = overview ? overviewGraph(matching, expanded, selected, assignments) : matching;
    const nodes = source.nodes.slice(0, 300), ids = new Set(nodes.map(n => n.id));
    return { nodes, edges: source.edges.filter(e => ids.has(e.source) && ids.has(e.target)), omitted: source.nodes.length - nodes.length };
  }, [matching, overview, expanded, selected, assignments]);
  const node = allGraph.nodes.find(n => n.id === selected);
  useEffect(() => { if (snapshot && selected && !node) { setSelected(''); setFocusOnly(false); } }, [snapshot, selected, node]);
  function select(id: string) {
    if (id && !graph.nodes.some(n => n.id === id)) { setProject('*'); save(projectKey(context), '*'); }
    setSelected(id); if (!id) setFocusOnly(false);
  }
  function chooseProject(value: string) { setProject(value); save(projectKey(context), value); setSelected(''); setFilter(''); setKind(''); setStatus(''); }
  async function act(action: string, targetNode = node, targetContext = context) {
    const c = targetNode?.container;
    if (!c || latest.current.context !== targetContext || !ready.current || actionLock.current) return;
    actionLock.current = true; setActionBusy(true); setNotice('');
    try {
      if (action !== 'start' && !await requestConfirm(`${targetContext} / ${c.name}\n${tr('이 컨테이너를', 'Apply to this container:')} ${action}?`, { title: tr('Docker 실행 동작', 'Docker action'), confirmLabel: action, destructive: true })) return;
      if (!latest.current.visible || latest.current.context !== targetContext || !ready.current) return;
      if (!snapshotRef.current?.complete || snapshotRef.current.context !== targetContext || !snapshotRef.current.containers.some(item => item.id === c.id)) return;
      await dockerAction(targetContext, c.id, action);
      if (latest.current.context === targetContext) setNotice(tr('동작을 완료했습니다. 상태를 다시 확인합니다.', 'Action completed. Refreshing state.'));
    } catch (e) { if (latest.current.context === targetContext) setNotice(errorMessage(e, language)); }
    finally { actionLock.current = false; setActionBusy(false); if (latest.current.context === targetContext) setRevision(v => v + 1); }
  }
  async function removeResource(targetNode = node, targetContext = context) {
    if (latest.current.context !== targetContext || !targetNode || isDefaultNetwork(targetNode) || !ready.current || actionLock.current || !['container', 'image', 'volume', 'network'].includes(targetNode.kind)) return;
    const target = targetNode;
    actionLock.current = true; setActionBusy(true);
    try {
      const detail = target.kind === 'volume' ? tr('볼륨 안의 데이터가 영구 삭제됩니다.', 'Data inside this volume will be permanently deleted.') : target.kind === 'container' ? tr('컨테이너 내부 데이터가 삭제됩니다.\n연결된 볼륨은 보존합니다. 실행 중이면 먼저 중지하세요.', 'Container-local data is deleted.\nMounted volumes are preserved. Stop the container first if running.') : tr('사용 중인 리소스는 삭제할 수 없습니다.', 'Resources in use cannot be removed.');
      if (!await requestConfirm(`${targetContext} / ${target.label}\n${detail}`, { title: tr('리소스 삭제', 'Delete resource'), confirmLabel: tr('삭제', 'Delete'), destructive: true })) return;
      if (!latest.current.visible || latest.current.context !== targetContext || !ready.current) return;
      await invoke('docker_resource_remove', { context: targetContext, kind: target.kind, id: target.resourceId });
      setSelected(''); setNotice(tr('리소스를 삭제했습니다.', 'Resource removed.'));
    } catch (e) { setNotice(errorMessage(e, language)); }
    finally { actionLock.current = false; setActionBusy(false); setRevision(v => v + 1); }
  }
  async function renameContainer(name: string) {
    const target = node?.container, targetContext = context;
    if (!target || !ready.current || actionLock.current) return;
    actionLock.current = true; setActionBusy(true);
    try { await invoke('docker_container_rename', { context: targetContext, id: target.id, name }); }
    catch (e) { setNotice(errorMessage(e, language)); }
    finally { actionLock.current = false; setActionBusy(false); setRevision(v => v + 1); }
  }
  useEffect(() => {
    if (!visible) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'F5') { event.preventDefault(); if (!pollBusy.current) setRevision(v => v + 1); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [visible]);
  function resourceMenu(event: ResourceMenuEvent, target: GraphNode) {
    event.preventDefault(); event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect(), targetContext = context, c = target.container;
    const blocked = !ready.current || actionBusy;
    setMenu({ x: 'clientX' in event ? event.clientX : box.left + 20, y: 'clientY' in event ? event.clientY : box.top + 20, trigger: event.currentTarget as HTMLElement, items: [
      { label: tr('상세 보기', 'View details'), action: () => select(target.id) },
      { label: tr('이름 복사', 'Copy name'), action: () => { void navigator.clipboard?.writeText(target.label).catch(() => {}); } },
      { label: tr('ID 복사', 'Copy ID'), action: () => { void navigator.clipboard?.writeText(target.resourceId).catch(() => {}); } },
      ...(c ? [
        { label: tr('로그 보기', 'View logs'), action: () => { select(target.id); requestAnimationFrame(() => document.querySelector('.docker-logs')?.scrollIntoView({ block: 'nearest' })); }, divider: true },
        ...(['start', 'stop', 'restart'] as const).map(action => ({ label: ({ start: tr('시작', 'Start'), stop: tr('중지', 'Stop'), restart: tr('재시작', 'Restart') })[action], disabled: blocked || !(action === 'start' ? ['created', 'exited'] : action === 'stop' ? ['running', 'restarting'] : ['running', 'exited', 'restarting']).includes(c.state), action: () => { void act(action, target, targetContext); } })),
      ] : []),
      ...(['container', 'image', 'volume', 'network'].includes(target.kind) ? [{ label: tr('리소스 삭제', 'Delete resource'), destructive: true, divider: true, disabled: blocked || isDefaultNetwork(target) || !!c && ['running', 'restarting', 'paused'].includes(c.state), action: () => { void removeResource(target, targetContext); } }] : []),
    ] });
  }
  const toolbar = snapshot && <div className="docker-toolbar">
    <label className="docker-search"><Search size={14}/><Input aria-label={tr('리소스 검색', 'Search resources')} placeholder={tr('이름·포트·경로 검색', 'Search name, port or path')} value={filter} onChange={e => setFilter(e.target.value)}/></label>
    <NativeSelect aria-label={tr('리소스 종류', 'Resource type')} value={kind} onChange={e => setKind(e.target.value as Kind | '')}><option value="">{tr('모든 종류', 'All types')}</option>{(['container', 'image', 'port', 'volume', 'bind', 'tmpfs', 'network'] as Kind[]).map(k => <option key={k} value={k}>{kindLabel(k, language)}</option>)}</NativeSelect>
    <NativeSelect aria-label={tr('상태 필터', 'State filter')} value={status} onChange={e => setStatus(e.target.value as StatusFilter)}><option value="">{tr('모든 상태', 'All states')}</option><option value="running">{tr('실행 중', 'Running')}</option><option value="stopped">{tr('중지됨', 'Stopped')}</option><option value="error">{tr('오류', 'Errors')}</option></NativeSelect>
    <Button variant="outline" size="sm" disabled={!node} aria-pressed={focusOnly} onClick={() => setFocusOnly(v => !v)}>{tr('연결된 항목만', 'Related only')}</Button>
    <div className="docker-view-switch" role="group" aria-label={tr('리소스 보기', 'Resource view')}>{(['graph', 'list'] as const).map(value => <Button key={value} variant="ghost" size="sm" aria-pressed={view === value} onClick={() => { setView(value); save('woojoo-docker-view', value); }}>{value === 'graph' ? tr('관계도', 'Graph') : tr('목록', 'List')}</Button>)}</div>
    <small title={tr('마지막 확인', 'Last checked') + ' ' + (checked ? new Date(checked).toLocaleTimeString() : '—')}>{matching.nodes.length} {tr('개 리소스', 'resources')}</small>
  </div>;
  if (!visible) return null;
  return <>
    <aside hidden={!sidebarOpen} className="sidebar docker-sidebar" id="docker-sidebar"><SidebarTitle icon={ContainerIcon} title="Docker"/><section className="docker-connection" aria-label={tr('Docker 연결', 'Docker connection')}><div className="docker-connection-heading"><label htmlFor="docker-context">{tr('연결 대상', 'Context')}</label><Button variant="ghost" size="icon-sm" aria-label={tr('연결 목록 새로고침', 'Reload contexts')} title={tr('연결 목록 새로고침', 'Reload contexts')} disabled={demo || actionBusy || engineStarting || maintenance} onClick={() => setContextRevision(v => v + 1)}><RefreshCw size={14}/></Button></div><NativeSelect id="docker-context" aria-label={tr('Docker 연결 대상', 'Docker context')} value={context} disabled={demo || actionBusy || engineStarting || maintenance} onChange={e => setContext(e.target.value)}>{contexts.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</NativeSelect></section><div className="docker-project-heading"><h3>{tr('프로젝트', 'Projects')}</h3>{desktop && <Button size="xs" disabled={demo || actionBusy || engineStarting || maintenance || !context} onClick={() => setCreateRevision(v => v + 1)}>{tr('새 프로젝트', 'New project')}</Button>}</div>{snapshot && <nav aria-label={tr('Docker 프로젝트', 'Docker projects')}>{projects(snapshot).map(p => <Button key={p} variant="ghost" aria-pressed={project === p} onClick={() => chooseProject(p)}><span className="docker-project-name">{p}<small>{counts(snapshot.containers.filter(c => c.project === p), language)}</small></span></Button>)}<Button variant="ghost" aria-pressed={project === ''} onClick={() => chooseProject('')}><span className="docker-project-name">{tr('독립 실행', 'Standalone')}<small>{counts(snapshot.containers.filter(c => !c.project), language)}</small></span></Button><Button variant="ghost" aria-pressed={project === '*'} onClick={() => chooseProject('*')}>{tr('전체 리소스', 'All resources')}</Button></nav>}<div className="docker-maintenance">{desktop && <StorageManager context={context} language={language} disabled={demo || actionBusy || engineStarting} onBusy={setMaintenance} onChanged={() => setRevision(v => v + 1)}/>}{localDesktop && <Button className="docker-engine-launcher" variant="outline" size="sm" disabled={!canStartEngine || engineStarting || actionBusy || maintenance} data-running={engineRunning || undefined} onClick={() => void startEngine()}>{engineStarting ? <Loader2 size={14} className="spin"/> : engineRunning ? <span className="docker-engine-dot" aria-hidden="true"/> : <Power size={14}/>}{engineStarting ? tr('Docker 시작 중…', 'Starting Docker…') : engineRunning ? tr('Docker 실행 중', 'Docker running') : tr('Docker 켜기', 'Start Docker')}</Button>}</div></aside>
    <main className="docker-workspace" data-testid="docker-workspace">
      <header className="topbar"><div className="breadcrumb"><Button variant="ghost" size="bare" aria-label={tr('사이드바 전환', 'Toggle sidebar')} aria-expanded={sidebarOpen} aria-controls="docker-sidebar" onClick={onToggleSidebar}>{sidebarOpen ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}</Button><ContainerIcon size={16}/><strong>Docker</strong><span>{context} / {project === '*' ? tr('전체 리소스', 'All resources') : project || tr('독립 실행', 'Standalone')}</span></div><Button variant="outline" size="sm" disabled={!context || loading || demo || actionBusy || maintenance} onClick={() => setRevision(v => v + 1)}><RefreshCw size={14} className={loading ? 'spin' : ''}/>{tr('새로고침', 'Refresh')}</Button></header>
      {demo && <div className="docker-banner">{tr('데모 데이터 · 실제 Docker 연결이 아닙니다.', 'Demo data · not connected to Docker.')}</div>}
      {desktop && <ComposeManager createRevision={createRevision} context={context} language={language} theme={theme} disabled={demo || actionBusy || engineStarting || maintenance} onChanged={() => setRevision(v => v + 1)} editProject={editProject} editRevision={editRevision} toolbar={toolbar}/>} {!desktop && toolbar}
      {contextError && <div role="alert" className="docker-banner docker-warning">{errorMessage(contextError, language)}</div>}
      {error && (!engineUnavailable || checked > 0) && <div role="alert" className="docker-banner docker-warning docker-engine-error">{!engineUnavailable && <p>{errorMessage(error, language).split('\n')[0]}</p>}{checked > 0 && <strong>{tr('마지막 조회 결과입니다. 현재 상태를 확인할 수 없습니다.', 'Showing old data. Current state is unknown.')}</strong>}{canStartEngine && !sidebarOpen && <Button variant="outline" size="sm" onClick={onToggleSidebar}>{tr('연결 설정', 'Connection settings')}</Button>}<details><summary>{tr('오류 상세', 'Error details')}</summary><pre>{error}</pre></details></div>}
      {notice && <div role="status" className="docker-banner">{notice}</div>}
      {!desktop && !demo ? <div className="docker-welcome"><ContainerIcon size={40}/><h1>{tr('Docker 리소스 관계도', 'Docker resource topology')}</h1><p>{tr('실제 Docker 연결은 데스크톱 앱에서 사용할 수 있습니다.', 'Connect to Docker in the desktop app.')}</p><Button onClick={() => { setDemo(true); setContext('demo'); setContexts([{ name: 'demo', endpoint: 'Demo', current: true }]); }}>{tr('데모 관계도 보기', 'View demo topology')}</Button></div> : !snapshot ? <div className="docker-welcome"><ContainerIcon size={40}/></div> : <>
        {!!snapshot.warnings.length && <details className="docker-banner docker-warning"><summary>{tr('일부 리소스를 확인하지 못했습니다. 실행 동작이 비활성화되었습니다.', 'Some resources could not be verified. Actions are disabled.')}</summary>{snapshot.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
        {view === 'graph' && filtered.omitted > 0 && <div className="docker-banner">{tr(`${filtered.omitted}개 생략 · 검색이나 종류 필터로 범위를 좁히세요.`, `${filtered.omitted} omitted · narrow the search or type filter.`)}</div>}
        <div className="docker-body"><div className="docker-visual">{view === 'graph' ? <DockerGraph key={`${context}:${project}:${overview}`} graph={filtered} selected={selected} onSelect={select} language={language} theme={theme} storageKey={`woojoo-docker-layout:${context}:${project}${overview ? ':overview' : ''}`} onResourceMenu={resourceMenu} groups={groups} assignments={assignments}/> : <ResourceTable nodes={matching.nodes} selected={selected} language={language} onSelect={select} onMenu={resourceMenu}/>} </div><DockerDetails node={node} snapshot={snapshot} language={language} disabled={!ready.current} busy={actionBusy} onAction={action => void act(action)} onSelect={select} onRename={name => void renameContainer(name)} onRemove={() => void removeResource()} onEdit={() => { setEditProject(node?.container?.project || project); setEditRevision(v => v + 1); }}/></div>
        {node?.container && <DockerLogs context={context} id={node.container.id} name={node.label} language={language} demo={demo}/>}
      </>}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)}/>}
    </main>
  </>;
}
