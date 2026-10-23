import { lazy, Suspense, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { AlertTriangle, Archive, ChevronRight, Cloud, Database, FileText, Loader2, Network, PanelLeftClose, PanelLeftOpen, PanelRight, RefreshCw, Server, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useLanguage } from '../i18n';
import { desktop } from '../api';
import type { Theme } from '../theme';
import type { AwsPreset } from '../AwsConnection';
import { awsCliInfo, awsEnvironment, type AwsCliInfo, type AwsEnvironment, type AwsRow, type AwsService } from '../aws';
import { AwsError } from './AwsError';
import { ResourceList, clearListCache } from './ResourceList';
import { Facts, ResourceDetail, canConnectRds } from './ResourceDetail';
import { AWS_SERVICES, looksProduction, readAwsContext, readAwsTabs, resourceId, resourceName, serviceLabel, tabKey, tabTitle, writeAwsContext, writeAwsTabs, type AwsTab } from './model';
import './aws.css';

const TopologyView = lazy(() => import('./TopologyView'));
const SERVICE_ICONS: Record<AwsService, LucideIcon> = { ec2: Server, rds: Database, s3: Archive, logs: FileText };
export type AwsCommands = { refresh?: () => void; closeTab?: () => void; togglePanel?: () => void };

/** The AWS work area: sidebar, tabs and right panel. It stays mounted while hidden so tabs keep their state. */
export function AwsWorkspace({ visible, sidebarOpen, onToggleSidebar, commandsRef, theme, onConnectRds }: {
  visible: boolean; sidebarOpen: boolean; onToggleSidebar: () => void; commandsRef: MutableRefObject<AwsCommands>; theme: Theme; onConnectRds: (preset: AwsPreset) => void;
}) {
  const { t, language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const saved = useRef(readAwsContext());
  const [info, setInfo] = useState<AwsCliInfo | null>(null), [infoError, setInfoError] = useState(''), [checking, setChecking] = useState(false), [cliCheck, setCliCheck] = useState(0);
  const [profile, setProfile] = useState(''), [env, setEnv] = useState<AwsEnvironment | null>(null), [envError, setEnvError] = useState(''), [envLoading, setEnvLoading] = useState(false), [envCheck, setEnvCheck] = useState(0);
  const [region, setRegion] = useState('');
  const initialTabs = useRef(readAwsTabs());
  const [tabs, setTabs] = useState<AwsTab[]>(initialTabs.current.tabs), [activeId, setActiveId] = useState(initialTabs.current.active);
  const [visited, setVisited] = useState<Set<string>>(() => new Set(initialTabs.current.active ? [initialTabs.current.active] : []));
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState<Record<string, AwsRow>>({});
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem('woojoo-aws-panel') !== 'closed'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('woojoo-aws-panel', panelOpen ? 'open' : 'closed'); } catch { /* Session-only preference. */ } }, [panelOpen]);
  useEffect(() => writeAwsTabs(tabs, activeId), [tabs, activeId]);
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0];

  // The app mounts this area on its first visit, so the database area never waits on AWS.
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false; setChecking(true); setInfoError('');
    awsCliInfo().then(value => {
      if (cancelled) return;
      setInfo(value);
      setProfile(current => value.profiles.includes(current) ? current : value.profiles.includes(saved.current.profile) ? saved.current.profile : value.profiles.includes('default') ? 'default' : value.profiles[0] ?? '');
    }).catch(reason => { if (!cancelled) setInfoError(String(reason)); }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [cliCheck]);
  useEffect(() => {
    if (!profile) { setEnv(null); return; }
    let cancelled = false; setEnvLoading(true); setEnvError(''); setEnv(null);
    awsEnvironment(profile).then(value => {
      if (cancelled) return;
      setEnv(value);
      setRegion(current => current && (profile === saved.current.profile || value.regions.includes(current)) ? current : profile === saved.current.profile && saved.current.region ? saved.current.region : value.region);
    }).catch(reason => { if (!cancelled) { setEnvError(String(reason)); setRegion(current => current || (profile === saved.current.profile ? saved.current.region : '')); } }).finally(() => { if (!cancelled) setEnvLoading(false); });
    return () => { cancelled = true; };
  }, [profile, envCheck]);
  useEffect(() => { if (profile && region) { saved.current = { profile, region }; writeAwsContext(profile, region); } }, [profile, region]);
  const regionValid = /^[a-z0-9-]{2,64}$/.test(region.trim());
  const ready = !!profile && regionValid;

  function activate(id: string) { setActiveId(id); setVisited(previous => previous.has(id) ? previous : new Set([...previous, id])); }
  function open(draft: Omit<AwsTab, 'id'>) {
    const key = tabKey(draft), existing = tabs.find(tab => tabKey(tab) === key);
    if (existing) { if (draft.row) setTabs(previous => previous.map(tab => tab.id === existing.id ? { ...tab, row: draft.row } : tab)); activate(existing.id); return; }
    const tab = { ...draft, id: crypto.randomUUID() };
    setTabs(previous => { const index = previous.findIndex(item => item.id === activeId); const next = [...previous]; next.splice(index < 0 ? next.length : index + 1, 0, tab); return next; });
    activate(tab.id);
  }
  const openService = (service: AwsService) => ready && open({ kind: 'resources', profile, region: region.trim(), service });
  const openTopology = () => ready && open({ kind: 'topology', profile, region: region.trim() });
  const openResource = (tab: AwsTab, row: AwsRow) => open({ kind: 'resource', profile: tab.profile, region: tab.region, service: tab.service, row });
  function close(id: string) {
    const index = tabs.findIndex(tab => tab.id === id), rest = tabs.filter(tab => tab.id !== id);
    setTabs(rest);
    if (id === active?.id && rest.length) activate(rest[Math.min(index, rest.length - 1)].id);
    setSelection(previous => { const next = { ...previous }; delete next[id]; return next; });
  }
  const refresh = (id = active?.id) => { if (id) setRevisions(previous => ({ ...previous, [id]: (previous[id] ?? 0) + 1 })); };
  commandsRef.current = { refresh: () => refresh(), closeTab: () => active && close(active.id), togglePanel: () => setPanelOpen(open => !open) };
  function connectRds(tab: AwsTab, row: AwsRow) { onConnectRds({ profile: tab.profile, region: tab.region, instance: row.DBInstanceIdentifier }); }

  const panelRow = active?.kind === 'resource' ? active.row : active ? selection[active.id] : undefined;
  const production = active ? looksProduction(active.profile) : looksProduction(profile);
  const icon = (tab: AwsTab) => { const Icon = tab.kind === 'topology' ? Network : SERVICE_ICONS[tab.service ?? 'ec2']; return <Icon size={14}/>; };
  // Same element positions whether shown or hidden, so the main pane never remounts.
  return <>
    {visible && sidebarOpen && <aside className="sidebar aws-sidebar" id="aws-sidebar" aria-label={tr('AWS 탐색기', 'AWS explorer')}>
      <div className="section-label"><span>{tr('계정', 'Account')}{info?.installed && <small className="aws-cli-version" title={info.version}>{info.version.split(' ')[0]}</small>}</span><Button variant="ghost" size="bare" title={tr('AWS CLI 다시 확인', 'Check AWS CLI again')} aria-label={t('AWS CLI 다시 확인')} disabled={checking || !desktop} onClick={() => { setInfo(null); setInfoError(''); setCliCheck(value => value + 1); }}><RefreshCw size={14} className={checking ? 'spin' : ''}/></Button></div>
      <div className="aws-context">
        {!desktop ? <p className="aws-note">{tr('AWS 작업 영역은 데스크톱 앱에서 사용할 수 있습니다.', 'The AWS work area is available in the desktop app.')}</p>
          : checking && !info ? <p className="aws-note" role="status"><Loader2 size={13} className="spin"/> {tr('AWS CLI 확인 중…', 'Checking AWS CLI…')}</p>
          : infoError ? <AwsError error={infoError} profile=""/>
          : info && !info.installed ? <p className="aws-note" role="status">{t('AWS CLI를 찾을 수 없습니다. 설치 후 앱을 다시 열거나 다시 확인하세요.')}</p>
          : info && !info.profiles.length ? <p className="aws-note" role="status">{t('저장된 AWS 프로필이 없습니다. aws configure 또는 aws configure sso로 프로필을 추가하세요.')}</p>
          : info && <>
            <label className="aws-field">{tr('프로필', 'Profile')}<NativeSelect size="sm" aria-label={t('AWS 프로필')} value={profile} onChange={event => setProfile(event.target.value)}>{info.profiles.map(value => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect></label>
            <label className="aws-field">{t('AWS 리전')}<Input aria-label={t('AWS 리전')} list="aws-workspace-regions" value={region} placeholder="ap-northeast-2" onChange={event => setRegion(event.target.value.trim().toLowerCase())}/><datalist id="aws-workspace-regions">{env?.regions.map(value => <option key={value} value={value}/>)}</datalist></label>
            <div className="aws-account" aria-live="polite">{envLoading ? <span className="aws-note"><Loader2 size={13} className="spin"/> {tr('계정 확인 중…', 'Checking account…')}</span> : env ? <span title={env.arn}>{t('AWS 계정')} <strong>{env.account}</strong></span> : null}</div>
            {envError && <AwsError error={envError} profile={profile} onRetry={() => setEnvCheck(value => value + 1)}/>}
            {region && !regionValid && <p className="aws-note">{tr('리전 코드를 확인하세요 (예: ap-northeast-2).', 'Check the region code (e.g. ap-northeast-2).')}</p>}
          </>}
      </div>
      <div className="divider"/>
      <div className="section-label"><span>{tr('리소스', 'Resources')}</span></div>
      <nav className="aws-nav" aria-label={tr('AWS 서비스', 'AWS services')}>
        {AWS_SERVICES.map(service => { const Icon = SERVICE_ICONS[service]; const current = active?.kind !== 'topology' && active?.service === service && active.profile === profile && active.region === region; return <Button key={service} variant="ghost" size="bare" className={`tree-table aws-nav-item ${current ? 'active' : ''}`} disabled={!ready} onClick={() => openService(service)}><Icon size={14}/><span>{tr(...serviceLabel[service])}</span></Button>; })}
        <Button variant="ghost" size="bare" className={`tree-table aws-nav-item ${active?.kind === 'topology' && active.profile === profile && active.region === region ? 'active' : ''}`} disabled={!ready} onClick={openTopology}><Network size={14}/><span>{tr('인프라 맵', 'Infrastructure map')}</span></Button>
      </nav>
      <p className="aws-sidebar-foot">{tr('로컬 AWS CLI 프로필로 조회합니다. 변경 작업은 상세 탭의 작업에서 검토 후 실행합니다.', 'Queries run through your local AWS CLI profiles. Changes are reviewed in a detail tab’s Actions view.')}</p>
    </aside>}
    {renderMain()}
    {visible && panelOpen && <aside className="history-sidebar aws-panel" id="aws-panel" aria-label={tr('리소스 요약', 'Resource summary')}>
      <div className="history-heading"><span>{tr('리소스 요약', 'RESOURCE SUMMARY')}</span><Button variant="ghost" size="bare" className="history-icon" aria-label={tr('패널 닫기', 'Close panel')} title={tr('패널 닫기', 'Close panel')} onClick={() => setPanelOpen(false)}><X size={14}/></Button></div>
      {active?.service && panelRow ? <div className="aws-panel-body">
        <h2 title={resourceName(active.service, panelRow)}>{resourceName(active.service, panelRow)}</h2>
        <small>{tr(...serviceLabel[active.service])} · {active.region}</small>
        <div className="aws-panel-actions">
          {active.kind === 'resources' && <Button variant="outline" size="xs" onClick={() => openResource(active, panelRow)}>{tr('상세 탭으로 열기', 'Open detail tab')}</Button>}
          <Button variant="outline" size="xs" onClick={() => void navigator.clipboard?.writeText(resourceId(active.service!, panelRow)).catch(() => {})}>{tr('ID 복사', 'Copy ID')}</Button>
          {active.service === 'rds' && <Button size="xs" disabled={!canConnectRds(panelRow)} onClick={() => connectRds(active, panelRow)}><Database size={12}/>{tr('DB 연결', 'Connect database')}</Button>}
        </div>
        <Facts tab={active} row={panelRow}/>
      </div> : <p className="history-empty aws-panel-empty">{active?.kind === 'topology' ? tr('맵에서 노드를 선택하면 캔버스 오른쪽에 정보가 표시됩니다.', 'Select a node on the map to see its details beside the canvas.') : tr('목록에서 리소스를 선택하면 요약이 여기에 표시됩니다.', 'Select a resource in a list to see its summary here.')}</p>}
    </aside>}
  </>;

  function renderMain() {
    return <main className="main aws-main" hidden={!visible} data-environment={production ? 'production' : undefined}>
      <header className="topbar"><div className="breadcrumb">
        <Button variant="ghost" size="bare" className="icon-button sidebar-toggle" aria-label={t(sidebarOpen ? '사이드바 접기' : '사이드바 펼치기')} title={t(sidebarOpen ? '사이드바 접기' : '사이드바 펼치기') + ' · Ctrl/Cmd+B'} aria-expanded={sidebarOpen} aria-controls="aws-sidebar" onClick={onToggleSidebar}>{sidebarOpen ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}</Button>
        {active && <nav className="breadcrumb-path" aria-label={tr('현재 위치', 'Location')}><Cloud size={14}/><span>{active.profile}</span><ChevronRight size={13}/><span>{active.region}</span><ChevronRight size={13}/>{active.kind === 'resource' && active.service ? <><span>{serviceLabel[active.service][language === 'ko' ? 0 : 1]}</span><ChevronRight size={13}/></> : null}<strong aria-current="page">{tr(...tabTitle(active))}</strong></nav>}
      </div><div className="topbar-right">
        {env && profile && <span className="connection-status" title={env.arn}><span className="live-dot" aria-hidden="true"/><span>{tr('계정', 'Account')} {env.account} · {profile}</span></span>}
        {production && <span className="env-banner" data-environment="production" role="note"><AlertTriangle size={13}/>PRODUCTION</span>}
        <Button variant="ghost" size="bare" className="icon-button history-toggle-button" aria-label={tr('리소스 요약 패널', 'Resource summary panel')} title={tr('리소스 요약 패널', 'Resource summary panel') + ' · Ctrl/Cmd+Alt+B'} aria-pressed={panelOpen} aria-controls="aws-panel" onClick={() => setPanelOpen(open => !open)}><PanelRight size={17}/></Button>
      </div></header>
      {!tabs.length ? <div className="workspace-empty"><Cloud size={28}/><h1>{tr('AWS 리소스를 살펴보세요', 'Explore your AWS resources')}</h1>
        <p className="connection-availability">{ready ? tr('왼쪽에서 서비스를 고르면 탭으로 열립니다.', 'Pick a service on the left to open it in a tab.') : tr('왼쪽에서 AWS 프로필과 리전을 선택하세요.', 'Choose an AWS profile and region on the left.')}</p>
        {ready && <div className="empty-connection-actions">{AWS_SERVICES.map(service => { const Icon = SERVICE_ICONS[service]; return <Button key={service} variant="outline" size="sm" onClick={() => openService(service)}><Icon size={14}/>{serviceLabel[service][language === 'ko' ? 0 : 1]}</Button>; })}<Button variant="outline" size="sm" onClick={openTopology}><Network size={14}/>{tr('인프라 맵', 'Infrastructure map')}</Button></div>}
      </div> : <>
        <div className="tabs"><div className="tab-list" role="tablist" aria-label={tr('AWS 탭', 'AWS tabs')} onWheel={event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY; }}>
          {tabs.map(tab => { const [ko, en] = tabTitle(tab); const name = tr(ko, en); const scope = `${tab.profile} · ${tab.region}`; return <div key={tab.id} className={`tab-item ${active?.id === tab.id ? 'active' : ''}`}>
            <Button variant="ghost" size="bare" role="tab" className="tab" id={`aws-tab-${tab.id}`} aria-selected={active?.id === tab.id} aria-controls={`aws-panel-${tab.id}`} tabIndex={active?.id === tab.id ? 0 : -1} title={`${name}\n${scope}`} onClick={() => activate(tab.id)} onAuxClick={event => { if (event.button === 1) close(tab.id); }}
              onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { const index = tabs.findIndex(item => item.id === tab.id), next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; activate(next.id); document.getElementById(`aws-tab-${next.id}`)?.focus(); } }}>
              {icon(tab)}<span>{name}</span>{(tab.profile !== profile || tab.region !== region) && <small className="aws-tab-scope">{tab.region}</small>}</Button>
            <Button variant="ghost" size="bare" className="tab-close" aria-label={t('탭 닫기 이름', { name })} title={t('탭 닫기')} onClick={() => close(tab.id)}><X size={13}/></Button>
          </div>; })}
        </div></div>
        {tabs.filter(tab => visited.has(tab.id) || tab.id === active?.id).map(tab => <div key={tab.id} className="aws-tab-panel" id={`aws-panel-${tab.id}`} role="tabpanel" aria-labelledby={`aws-tab-${tab.id}`} hidden={tab.id !== active?.id}>
          {tab.kind === 'resources' ? <ResourceList tab={tab} revision={revisions[tab.id] ?? 0} selected={tab.service && selection[tab.id] ? resourceId(tab.service, selection[tab.id]) : undefined} onSelect={row => setSelection(previous => ({ ...previous, [tab.id]: row }))} onOpen={row => openResource(tab, row)}/>
            : tab.kind === 'resource' ? <ResourceDetail tab={tab} revision={revisions[tab.id] ?? 0} onConnectRds={row => connectRds(tab, row)}/>
            : <Suspense fallback={<div className="object-empty"><Loader2 size={16} className="spin"/></div>}><TopologyView tab={tab} revision={revisions[tab.id] ?? 0} theme={theme}/></Suspense>}
        </div>)}
      </>}
    </main>;
  }
}
/** Forgets cached lists, e.g. after switching AWS credentials outside the app. */
export const resetAwsCaches = clearListCache;
