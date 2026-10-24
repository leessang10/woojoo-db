import { useEffect, useMemo, useRef, useState } from 'react';
import { Container as ContainerIcon, Loader2, PanelLeftClose, PanelLeftOpen, Power, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '../components/ConfirmProvider';
import { desktop } from '../api';
import { useLanguage } from '../i18n';
import type { Theme } from '../theme';
import { dockerAction, dockerContexts, dockerSnapshot, errorMessage, startDockerDesktop } from './api';
import { buildGraph, kindLabel, projects, text, type DockerContext, type Kind, type Snapshot } from './model';
import { DockerGraph } from './Graph';
import { DockerDetails } from './Details';
import { DockerLogs } from './Logs';
import { demoSnapshot } from './demo';
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
  const [engineStarting, setEngineStarting] = useState(false); const engineStartLock = useRef(false);
  const [revision, setRevision] = useState(0), [contextRevision, setContextRevision] = useState(0), [checked, setChecked] = useState(0), [demo, setDemo] = useState(false);
  const latest = useRef({ context, visible }); latest.current = { context, visible };
  const chain = useRef<Promise<void>>(Promise.resolve()); const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const actionLock = useRef(false); const pollBusy = useRef(false);
  const ready = useRef(false); ready.current = !!snapshot?.complete && snapshot.context === context && !error && !contextError && !demo && !engineStarting;
  const canStartEngine = desktop && !demo && !contextError && contexts.some(c => c.name === context && c.canStartDesktop) && error.includes('DOCKER_ENGINE_UNAVAILABLE');
  async function startEngine() {
    if (!canStartEngine || engineStartLock.current) return;
    const target = context; engineStartLock.current = true; setEngineStarting(true); setNotice('');
    try {
      await startDockerDesktop(target);
      if (latest.current.context === target) setNotice(tr('Docker 엔진이 준비되었습니다. 리소스를 불러옵니다.', 'Docker engine is ready. Loading resources.'));
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
    if (!visible || !context || (!desktop && !demo)) return;
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
  }, [context, visible, revision, demo]);
  const graph = useMemo(() => snapshot ? buildGraph(snapshot, project, language) : { nodes: [], edges: [] }, [snapshot, project, language]);
  const allGraph = useMemo(() => snapshot ? buildGraph(snapshot, '*', language) : { nodes: [], edges: [] }, [snapshot, language]);
  const filtered = useMemo(() => {
    const matching = graph.nodes.filter(n => (!kind || n.kind === kind) && (!filter || `${n.label} ${n.detail}`.toLowerCase().includes(filter.toLowerCase())));
    const nodes = matching.slice(0, 300), ids = new Set(nodes.map(n => n.id));
    return { nodes, edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)), omitted: matching.length - nodes.length };
  }, [graph, filter, kind]);
  const node = allGraph.nodes.find(n => n.id === selected);
  function select(id: string) {
    if (!graph.nodes.some(n => n.id === id)) { setProject('*'); save(projectKey(context), '*'); }
    setSelected(id);
  }
  function chooseProject(value: string) { setProject(value); save(projectKey(context), value); setSelected(''); setFilter(''); setKind(''); }
  async function act(action: string) {
    const c = node?.container; const targetContext = context;
    if (!c || !ready.current || actionLock.current) return;
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
  useEffect(() => {
    if (!visible) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'F5') { event.preventDefault(); if (!pollBusy.current) setRevision(v => v + 1); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [visible]);
  if (!visible) return null;
  return <>
    {sidebarOpen && <aside className="sidebar docker-sidebar" id="docker-sidebar"><header><ContainerIcon size={18}/><strong>Docker</strong></header><label>{tr('연결 대상', 'Context')}<select aria-label={tr('Docker 연결 대상', 'Docker context')} value={context} disabled={demo || actionBusy || engineStarting} onChange={e => setContext(e.target.value)}>{contexts.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label><small>{contexts.find(c => c.name === context)?.endpoint}</small><Button variant="ghost" size="sm" disabled={demo || engineStarting} onClick={() => setContextRevision(v => v + 1)}>{tr('연결 목록 새로고침', 'Reload contexts')}</Button><h3>{tr('프로젝트', 'Projects')}</h3>{snapshot && <nav aria-label={tr('Docker 프로젝트', 'Docker projects')}>{projects(snapshot).map(p => <Button key={p} variant="ghost" aria-pressed={project === p} onClick={() => chooseProject(p)}>{p}<span>{snapshot.containers.filter(c => c.project === p).length}</span></Button>)}<Button variant="ghost" aria-pressed={project === ''} onClick={() => chooseProject('')}>{tr('독립 실행', 'Standalone')}<span>{snapshot.containers.filter(c => !c.project).length}</span></Button><Button variant="ghost" aria-pressed={project === '*'} onClick={() => chooseProject('*')}>{tr('전체 리소스', 'All resources')}</Button></nav>}<p>{tr('컨테이너를 중심으로 이미지, 포트와 저장소의 연결을 확인하세요.', 'Explore images, ports and storage around each container.')}</p></aside>}
    <main className="docker-workspace" data-testid="docker-workspace">
      <header className="topbar"><div className="breadcrumb"><Button variant="ghost" size="bare" aria-label={tr('사이드바 전환', 'Toggle sidebar')} onClick={onToggleSidebar}>{sidebarOpen ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}</Button><ContainerIcon size={16}/><strong>Docker</strong><span>{context} / {project === '*' ? tr('전체 리소스', 'All resources') : project || tr('독립 실행', 'Standalone')}</span></div><Button variant="outline" size="sm" disabled={!context || loading || demo || actionBusy} onClick={() => setRevision(v => v + 1)}><RefreshCw size={14} className={loading ? 'spin' : ''}/>{tr('새로고침', 'Refresh')}</Button></header>
      {demo && <div className="docker-banner">{tr('데모 데이터 · 실제 Docker 연결이 아닙니다.', 'Demo data · not connected to Docker.')}</div>}
      {contextError && <div role="alert" className="docker-banner docker-warning">{errorMessage(contextError, language)}</div>}
      {error && <div role="alert" className="docker-banner docker-warning docker-engine-error"><p>{errorMessage(error, language).split('\n')[0]}</p>{checked > 0 && <strong>{tr('마지막 조회 결과입니다. 현재 상태를 확인할 수 없습니다.', 'Showing old data. Current state is unknown.')}</strong>}{canStartEngine && <Button size="sm" disabled={engineStarting} onClick={() => void startEngine()}>{engineStarting ? <Loader2 size={14} className="spin"/> : <Power size={14}/>}{engineStarting ? tr('Docker 시작 중…', 'Starting Docker…') : tr('Docker 켜기', 'Start Docker')}</Button>}<details><summary>{tr('오류 상세', 'Error details')}</summary><pre>{error}</pre></details></div>}
      {engineStarting && <div role="status" className="docker-banner">{tr('Docker Desktop을 시작하고 엔진이 준비될 때까지 기다립니다. 최대 약 2분이 걸릴 수 있습니다.', 'Starting Docker Desktop and waiting for the engine. This can take about two minutes.')}</div>}
      {notice && <div role="status" className="docker-banner">{notice}</div>}
      {!desktop && !demo ? <div className="docker-welcome"><ContainerIcon size={40}/><h1>{tr('Docker 리소스 관계도', 'Docker resource topology')}</h1><p>{tr('실제 Docker 연결은 데스크톱 앱에서 사용할 수 있습니다.', 'Connect to Docker in the desktop app.')}</p><Button onClick={() => { setDemo(true); setContext('demo'); setContexts([{ name: 'demo', endpoint: 'Demo', current: true }]); }}>{tr('데모 관계도 보기', 'View demo topology')}</Button></div> : !snapshot ? <div className="docker-welcome"><ContainerIcon size={40}/><p>{loading ? tr('Docker 리소스를 읽는 중…', 'Reading Docker resources…') : tr('Docker 엔진이 실행 중인지 확인하고 연결 대상을 선택하세요.', 'Check that Docker is running and select a context.')}</p></div> : <>
        <div className="docker-toolbar"><Search size={14}/><Input aria-label={tr('리소스 검색', 'Search resources')} placeholder={tr('이름·포트·경로 검색', 'Search name, port or path')} value={filter} onChange={e => setFilter(e.target.value)}/><select aria-label={tr('리소스 종류', 'Resource type')} value={kind} onChange={e => setKind(e.target.value as Kind | '')}><option value="">{tr('모든 종류', 'All types')}</option>{(['container', 'image', 'port', 'volume', 'bind', 'tmpfs', 'network'] as Kind[]).map(k => <option key={k} value={k}>{kindLabel(k, language)}</option>)}</select><span>{filtered.nodes.length} {tr('개 리소스', 'resources')}</span><small>{tr('마지막 확인', 'Last checked')} {checked ? new Date(checked).toLocaleTimeString(language === 'ko' ? 'ko-KR' : 'en-US') : '—'}</small></div>
        {!!snapshot.warnings.length && <details className="docker-banner docker-warning"><summary>{tr('일부 리소스를 확인하지 못했습니다. 실행 동작이 비활성화되었습니다.', 'Some resources could not be verified. Actions are disabled.')}</summary>{snapshot.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
        {filtered.omitted > 0 && <div className="docker-banner">{tr(`${filtered.omitted}개 생략 · 검색이나 종류 필터로 범위를 좁히세요.`, `${filtered.omitted} omitted · narrow the search or type filter.`)}</div>}
        <div className="docker-body"><div className="docker-visual"><DockerGraph key={`${context}:${project}`} graph={filtered} selected={selected} onSelect={select} language={language} theme={theme} storageKey={`woojoo-docker-layout:${context}:${project}`}/><details className="docker-resource-list"><summary>{tr('리소스 목록 / 범례', 'Resource list / legend')}</summary><div>{filtered.nodes.map(n => <Button key={n.id} variant="ghost" size="sm" aria-pressed={selected === n.id} onClick={() => select(n.id)}>{kindLabel(n.kind, language)} · {n.label}</Button>)}</div></details></div><DockerDetails node={node} snapshot={snapshot} language={language} disabled={!ready.current} busy={actionBusy} onAction={action => void act(action)} onSelect={select}/></div>
        {node?.container && <DockerLogs context={context} id={node.container.id} name={node.label} language={language} demo={demo}/>}
      </>}
    </main>
  </>;
}
