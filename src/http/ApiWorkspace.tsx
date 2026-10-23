import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Folder, FolderPlus, History, Import, PanelLeftClose, PanelLeftOpen, PanelRight, Plus, Search, Settings2, Trash2, Waypoints, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useConfirm } from '@/components/ConfirmProvider';
import { ContextMenu, type MenuItem, type MenuState } from '../ContextMenu';
import { useLanguage } from '../i18n';
import { matchesProduction, useSettings } from '../settings';
import type { Theme } from '../theme';
import * as store from './api';
import { CurlDialog, EnvironmentDialog, NameDialog } from './Dialogs';
import { RequestPanel } from './RequestPanel';
import type { Result } from './ResponseView';
import { blankSpec, buildOutgoing, formatDuration, normalizeSpec, readApiTabs, requestTitle, sameSpec, specFromOutgoing, statusTone, writeApiTabs, type ApiTab, type Environment, type HistoryEntry, type RequestSpec, type SavedRequest, type Workspace } from './model';
import './http.css';

export type ApiCommands = { send?: () => void; save?: () => void; newTab?: () => void; closeTab?: () => void; togglePanel?: () => void };
type Naming = { title: string; initial: string; withCollection?: boolean; collectionId?: string | null; submit: (name: string, collectionId: string | null) => void };
const COLLAPSED_KEY = 'woojoo-api-collapsed';
const PANEL_KEY = 'woojoo-api-panel';

/** The API work area: saved requests in local SQLite, request tabs, and a history panel. */
export function ApiWorkspace({ visible, sidebarOpen, onToggleSidebar, commandsRef, theme }: {
  visible: boolean; sidebarOpen: boolean; onToggleSidebar: () => void; commandsRef: MutableRefObject<ApiCommands>; theme: Theme;
}) {
  const { t, language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  useSettings(); // Re-renders when the production words change.
  const { requestConfirm } = useConfirm();
  const [workspace, setWorkspace] = useState<Workspace>({ collections: [], requests: [], environments: [], activeEnvironment: null });
  const [loadError, setLoadError] = useState('');
  const initialTabs = useRef(readApiTabs());
  const [tabs, setTabs] = useState<ApiTab[]>(initialTabs.current.tabs), [activeId, setActiveId] = useState(initialTabs.current.active);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')); } catch { return new Set(); } });
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem(PANEL_KEY) === 'open'; } catch { return false; } });
  const [history, setHistory] = useState<HistoryEntry[]>([]), [historySearch, setHistorySearch] = useState(''), [historyRevision, setHistoryRevision] = useState(0);
  const [naming, setNaming] = useState<Naming | null>(null), [curl, setCurl] = useState<string | null>(null), [editingEnvironments, setEditingEnvironments] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => writeApiTabs(tabs, activeId), [tabs, activeId]);
  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch { /* Session-only. */ } }, [collapsed]);
  useEffect(() => { try { localStorage.setItem(PANEL_KEY, panelOpen ? 'open' : 'closed'); } catch { /* Session-only. */ } }, [panelOpen]);
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    if (!panelOpen) return;
    let cancelled = false;
    store.historyList(historySearch).then(list => { if (!cancelled) setHistory(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, [panelOpen, historySearch, historyRevision]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2500); return () => clearTimeout(timer); }, [notice]);
  // Pasting a cURL command into a URL field opens the import dialog prefilled.
  useEffect(() => {
    const paste = (event: Event) => setCurl((event as CustomEvent<string>).detail);
    window.addEventListener('woojoo-api-curl', paste);
    return () => window.removeEventListener('woojoo-api-curl', paste);
  }, []);

  async function reload() {
    try { setWorkspace(await store.loadWorkspace()); setLoadError(''); }
    catch (reason) { setLoadError(String(reason)); }
  }
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0];
  const environment = workspace.environments.find(e => e.id === workspace.activeEnvironment);
  const variables = environment?.variables ?? [];
  const production = !!environment && matchesProduction(environment.name);
  const dirty = (tab: ApiTab) => !tab.saved || !sameSpec(tab.spec, tab.saved);
  const collectionName = (id: string | null) => workspace.collections.find(c => c.id === id)?.name;
  const tabName = (tab: ApiTab) => tab.name || requestTitle(tab.spec) || tr('새 요청', 'New request');

  // --- Tabs ---------------------------------------------------------------------
  function openTab(draft: Omit<ApiTab, 'id'>, result?: Result) {
    const tab = { ...draft, id: crypto.randomUUID() };
    setTabs(previous => { const index = previous.findIndex(item => item.id === activeId); const next = [...previous]; next.splice(index < 0 ? next.length : index + 1, 0, tab); return next; });
    if (result) setResults(previous => ({ ...previous, [tab.id]: result }));
    setActiveId(tab.id);
    return tab.id;
  }
  const newTab = (spec: RequestSpec = blankSpec(), collectionId: string | null = null) => openTab({ requestId: null, name: '', collectionId, spec, saved: null });
  function openSaved(request: SavedRequest) {
    const existing = tabs.find(tab => tab.requestId === request.id);
    if (existing) { setActiveId(existing.id); return; }
    const spec = normalizeSpec(request.spec);
    openTab({ requestId: request.id, name: request.name, collectionId: request.collectionId, spec, saved: structuredClone(spec) });
  }
  async function close(id: string) {
    const tab = tabs.find(item => item.id === id); if (!tab) return;
    const empty = !tab.requestId && sameSpec(tab.spec, blankSpec());
    if (dirty(tab) && !empty && !await requestConfirm(tr(`"${tabName(tab)}"의 저장하지 않은 변경 사항을 버릴까요?`, `Discard unsaved changes to "${tabName(tab)}"?`), { title: tr('탭 닫기', 'Close tab'), confirmLabel: tr('버리고 닫기', 'Discard and close'), destructive: true })) return;
    const ticket = results[id]?.ticket; if (ticket) store.cancelSend(ticket);
    setTabs(previous => {
      const index = previous.findIndex(item => item.id === id), rest = previous.filter(item => item.id !== id);
      if (id === active?.id) setActiveId(rest[Math.min(index, rest.length - 1)]?.id ?? '');
      return rest;
    });
    setResults(previous => { const next = { ...previous }; delete next[id]; return next; });
  }
  const updateTab = (id: string, patch: Partial<ApiTab>) => setTabs(previous => previous.map(tab => tab.id === id ? { ...tab, ...patch } : tab));

  // --- Sending ------------------------------------------------------------------
  async function send(tab = active) {
    if (!tab || results[tab.id]?.ticket || !tab.spec.url.trim()) return;
    const { outgoing } = buildOutgoing(tab.spec, variables, { requestId: tab.requestId, name: tab.name });
    const ticket = crypto.randomUUID();
    setResults(previous => ({ ...previous, [tab.id]: { ...previous[tab.id], ticket, error: undefined } }));
    try {
      const response = await store.send(outgoing, ticket);
      setResults(previous => ({ ...previous, [tab.id]: { response, sentAt: Date.now() } }));
    } catch (reason) {
      setResults(previous => ({ ...previous, [tab.id]: reason === 'HTTP_CANCELLED' ? { response: previous[tab.id]?.response } : { error: String(reason), sentAt: Date.now() } }));
    } finally { setHistoryRevision(value => value + 1); }
  }
  function cancel(tab = active) { const ticket = tab && results[tab.id]?.ticket; if (ticket) store.cancelSend(ticket); }

  // --- Saving -------------------------------------------------------------------
  async function persist(tab: ApiTab, name: string, collectionId: string | null, requestId = tab.requestId ?? crypto.randomUUID()) {
    const siblings = workspace.requests.filter(r => r.collectionId === collectionId && r.id !== requestId);
    const previous = workspace.requests.find(r => r.id === requestId);
    const request: SavedRequest = { id: requestId, collectionId, name, sort: previous && previous.collectionId === collectionId ? previous.sort : siblings.length, spec: tab.spec, updatedAt: 0 };
    try {
      await store.saveRequest(request);
      updateTab(tab.id, { requestId, name, collectionId, saved: structuredClone(tab.spec) });
      await reload(); setNotice(tr('저장했습니다', 'Saved'));
    } catch (reason) { setNotice(tr(`저장하지 못했습니다: ${reason}`, `Could not save: ${reason}`)); }
  }
  function save(tab = active) {
    if (!tab) return;
    if (tab.requestId && workspace.requests.some(r => r.id === tab.requestId)) { void persist(tab, tab.name, tab.collectionId); return; }
    saveAs(tab);
  }
  function saveAs(tab: ApiTab) {
    setNaming({ title: tr('요청 저장', 'Save request'), initial: tab.name || requestTitle(tab.spec) || tr('새 요청', 'New request'), withCollection: true, collectionId: tab.collectionId,
      submit: (name, collectionId) => void persist(tab, name, collectionId, crypto.randomUUID()) });
  }
  commandsRef.current = { send: () => void send(), save: () => save(), newTab: () => newTab(), closeTab: () => active && void close(active.id), togglePanel: () => setPanelOpen(open => !open) };

  // --- Collections and requests -------------------------------------------------
  function newCollection() {
    setNaming({ title: tr('새 컬렉션', 'New collection'), initial: '', submit: name => void (async () => {
      const collection = { id: crypto.randomUUID(), name, sort: workspace.collections.length };
      await store.saveCollection(collection); await reload();
      setCollapsed(previous => { const next = new Set(previous); next.delete(collection.id); return next; });
    })() });
  }
  function renameRequest(request: SavedRequest) {
    setNaming({ title: tr('요청 이름 바꾸기', 'Rename request'), initial: request.name, submit: name => void (async () => {
      await store.saveRequest({ ...request, name }); await reload();
      setTabs(previous => previous.map(tab => tab.requestId === request.id ? { ...tab, name } : tab));
    })() });
  }
  async function duplicateRequest(request: SavedRequest) {
    const copy = { ...request, id: crypto.randomUUID(), name: `${request.name} ${tr('복사본', 'copy')}`, sort: request.sort + 1 };
    await store.saveRequest(copy); await reload(); openSaved(copy);
  }
  async function deleteRequest(request: SavedRequest) {
    if (!await requestConfirm(tr(`"${request.name}" 요청을 삭제할까요?`, `Delete the request "${request.name}"?`), { title: tr('요청 삭제', 'Delete request'), confirmLabel: tr('삭제', 'Delete'), destructive: true })) return;
    await store.deleteItem('request', request.id); await reload();
    setTabs(previous => previous.map(tab => tab.requestId === request.id ? { ...tab, requestId: null, saved: null } : tab));
  }
  function renameCollection(id: string) {
    const collection = workspace.collections.find(c => c.id === id); if (!collection) return;
    setNaming({ title: tr('컬렉션 이름 바꾸기', 'Rename collection'), initial: collection.name, submit: name => void store.saveCollection({ ...collection, name }).then(reload) });
  }
  async function deleteCollection(id: string) {
    const collection = workspace.collections.find(c => c.id === id); if (!collection) return;
    const count = workspace.requests.filter(r => r.collectionId === id).length;
    if (!await requestConfirm(tr(`"${collection.name}" 컬렉션과 요청 ${count}개를 삭제할까요?`, `Delete the collection "${collection.name}" and its ${count} requests?`), { title: tr('컬렉션 삭제', 'Delete collection'), confirmLabel: tr('삭제', 'Delete'), destructive: true })) return;
    await store.deleteItem('collection', id); await reload();
    setTabs(previous => previous.map(tab => tab.collectionId === id ? { ...tab, requestId: null, collectionId: null, saved: null } : tab));
  }
  async function moveRequest(request: SavedRequest, collectionId: string | null) {
    await store.saveRequest({ ...request, collectionId, sort: workspace.requests.filter(r => r.collectionId === collectionId).length }); await reload();
    setTabs(previous => previous.map(tab => tab.requestId === request.id ? { ...tab, collectionId } : tab));
  }
  async function chooseEnvironment(id: string) {
    const value = id || null;
    setWorkspace(previous => ({ ...previous, activeEnvironment: value }));
    await store.setActiveEnvironment(value).catch(() => {});
  }
  async function saveEnvironments(next: Environment[], removed: string[]) {
    for (const id of removed) await store.deleteItem('environment', id);
    for (const environment of next) await store.saveEnvironment(environment);
    if (workspace.activeEnvironment && removed.includes(workspace.activeEnvironment)) await store.setActiveEnvironment(null);
    else if (!workspace.activeEnvironment && next.length === 1) await store.setActiveEnvironment(next[0].id);
    await reload();
  }
  async function openHistory(entry: HistoryEntry) {
    const detail = await store.historyDetail(entry.id).catch(() => null); if (!detail) return;
    const spec = specFromOutgoing(detail.request);
    openTab({ requestId: null, name: '', collectionId: null, spec, saved: null, historyId: entry.id }, detail.response ? { response: detail.response, sentAt: entry.sentAt } : { error: entry.error ?? '', sentAt: entry.sentAt });
  }
  async function clearHistory() {
    if (!await requestConfirm(tr('요청 기록을 모두 지울까요?', 'Clear all request history?'), { title: tr('기록 지우기', 'Clear history'), confirmLabel: tr('지우기', 'Clear'), destructive: true })) return;
    await store.clearHistory(); setHistoryRevision(value => value + 1);
  }

  function menuFor(items: () => MenuItem[]) {
    const open = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
      event.preventDefault(); event.stopPropagation();
      const trigger = event.currentTarget, rect = trigger.getBoundingClientRect();
      const pointer = 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0);
      setMenu({ x: pointer ? event.clientX : rect.left + 12, y: pointer ? event.clientY : rect.top + Math.min(rect.height, 32), items: items(), trigger });
    };
    return { onContextMenu: open, onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event); } };
  }
  const requestMenu = (request: SavedRequest) => menuFor(() => [
    { label: tr('열기', 'Open'), action: () => openSaved(request) },
    { label: tr('이름 바꾸기', 'Rename'), action: () => renameRequest(request) },
    { label: tr('복제', 'Duplicate'), action: () => void duplicateRequest(request) },
    ...[{ id: null, name: tr('컬렉션 없음', 'No collection') }, ...workspace.collections].filter(c => c.id !== request.collectionId)
      .map((c, index) => ({ label: `${tr('이동', 'Move to')} → ${c.name}`, action: () => void moveRequest(request, c.id), divider: index === 0 })),
    { label: tr('삭제', 'Delete'), action: () => void deleteRequest(request), divider: true },
  ]);
  const collectionMenu = (id: string) => menuFor(() => [
    { label: tr('새 요청', 'New request'), action: () => newTab(blankSpec(), id) },
    { label: tr('이름 바꾸기', 'Rename'), action: () => renameCollection(id) },
    { label: tr('삭제', 'Delete'), action: () => void deleteCollection(id), divider: true },
  ]);

  // --- Sidebar tree ----------------------------------------------------------------
  const term = search.trim().toLowerCase();
  const matches = (r: SavedRequest) => !term || r.name.toLowerCase().includes(term) || String(r.spec?.url ?? '').toLowerCase().includes(term) || String(r.spec?.method ?? '').toLowerCase() === term;
  const loose = workspace.requests.filter(r => !r.collectionId && matches(r));
  const grouped = useMemo(() => workspace.collections.map(c => ({ collection: c, requests: workspace.requests.filter(r => r.collectionId === c.id) })), [workspace]);
  const requestItem = (request: SavedRequest, nested: boolean) => {
    const method = String(request.spec?.method ?? 'GET');
    return <Button key={request.id} variant="ghost" size="bare" className={`tree-table api-tree-request ${nested ? 'nested' : ''} ${active?.requestId === request.id ? 'active' : ''}`} title={`${method} ${request.spec?.url ?? ''}`} onClick={() => openSaved(request)} {...requestMenu(request)}>
      <span className="api-method-tag" data-method={method}>{method.slice(0, 6)}</span><span>{request.name}</span>
    </Button>;
  };

  return <>
    {visible && sidebarOpen && <aside className="sidebar api-sidebar" id="api-sidebar" aria-label={tr('API 탐색기', 'API explorer')}>
      <div className="section-label"><span>{tr('환경', 'Environment')}</span><Button variant="ghost" size="bare" title={tr('환경 변수 관리', 'Manage environments')} aria-label={tr('환경 변수 관리', 'Manage environments')} onClick={() => setEditingEnvironments(true)}><Settings2 size={14}/></Button></div>
      <div className="api-env-picker">
        <NativeSelect size="sm" aria-label={tr('사용할 환경', 'Active environment')} value={workspace.activeEnvironment ?? ''} onChange={event => void chooseEnvironment(event.target.value)}>
          <NativeSelectOption value="">{tr('환경 없음', 'No environment')}</NativeSelectOption>
          {workspace.environments.map(e => <NativeSelectOption key={e.id} value={e.id}>{e.name}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="divider"/>
      <div className="section-label"><span>{tr('컬렉션', 'Collections')}</span><span className="api-section-actions">
        <Button variant="ghost" size="bare" title={tr('새 요청', 'New request') + ' · Ctrl/Cmd+N'} aria-label={tr('새 요청', 'New request')} onClick={() => newTab()}><Plus size={15}/></Button>
        <Button variant="ghost" size="bare" title={tr('새 컬렉션', 'New collection')} aria-label={tr('새 컬렉션', 'New collection')} onClick={newCollection}><FolderPlus size={14}/></Button>
        <Button variant="ghost" size="bare" title={tr('cURL 가져오기', 'Import cURL')} aria-label={tr('cURL 가져오기', 'Import cURL')} onClick={() => setCurl('')}><Import size={14}/></Button>
      </span></div>
      <label className="search-field"><Search size={13}/><input value={search} placeholder={tr('요청 검색', 'Search requests')} aria-label={tr('요청 검색', 'Search requests')} onChange={event => setSearch(event.target.value)}/>{search && <Button variant="ghost" size="bare" aria-label={tr('검색 지우기', 'Clear search')} onClick={() => setSearch('')}><X size={12}/></Button>}</label>
      <nav className="api-tree" aria-label={tr('저장한 요청', 'Saved requests')}>
        {loadError && <p className="api-hint api-warn" role="alert"><AlertTriangle size={12}/>{tr('저장소를 열지 못했습니다', 'Could not open the request store')}: {loadError}</p>}
        {loose.map(r => requestItem(r, false))}
        {grouped.map(({ collection, requests }) => {
          const shown = requests.filter(matches);
          if (term && !shown.length && !collection.name.toLowerCase().includes(term)) return null;
          const open = !collapsed.has(collection.id) || !!term;
          return <div key={collection.id} className="api-tree-group">
            <Button variant="ghost" size="bare" className="tree-table api-tree-collection" aria-expanded={open} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(collection.id)) next.delete(collection.id); else next.add(collection.id); return next; })} {...collectionMenu(collection.id)}>
              {open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}<Folder size={13}/><span>{collection.name}</span><small>{requests.length}</small>
            </Button>
            {open && (term ? shown : requests).map(r => requestItem(r, true))}
            {open && !requests.length && <p className="api-tree-empty">{tr('오른쪽 클릭 → 새 요청, 또는 요청을 저장할 때 이 컬렉션을 고르세요.', 'Right-click → New request, or pick this collection when saving.')}</p>}
          </div>;
        })}
        {!workspace.requests.length && !workspace.collections.length && !loadError && <p className="api-tree-empty">{tr('저장한 요청이 없습니다. 요청을 만든 뒤 Ctrl/Cmd+S로 저장하세요.', 'No saved requests yet. Build a request and save it with Ctrl/Cmd+S.')}</p>}
      </nav>
      <p className="aws-sidebar-foot">{tr('요청·환경·기록은 이 PC의 SQLite 파일에만 저장됩니다. 계정·동기화·AI 기능은 없습니다.', 'Requests, environments and history are stored only in a SQLite file on this PC. No accounts, sync or AI.')}</p>
    </aside>}
    {renderMain()}
    {visible && panelOpen && <aside className="history-sidebar api-history" id="api-history" aria-label={tr('요청 기록', 'Request history')}>
      <div className="history-heading"><span>{tr('요청 기록', 'HISTORY')}</span><span className="history-heading-actions">
        <Button variant="ghost" size="bare" className="history-icon" aria-label={tr('기록 지우기', 'Clear history')} title={tr('기록 지우기', 'Clear history')} onClick={() => void clearHistory()}><Trash2 size={14}/></Button>
        <Button variant="ghost" size="bare" className="history-icon" aria-label={tr('패널 닫기', 'Close panel')} title={tr('패널 닫기', 'Close panel')} onClick={() => setPanelOpen(false)}><X size={14}/></Button>
      </span></div>
      <label className="search-field"><Search size={13}/><input value={historySearch} placeholder={tr('URL 검색', 'Search URLs')} aria-label={tr('기록 검색', 'Search history')} onChange={event => setHistorySearch(event.target.value)}/></label>
      <div className="api-history-list">
        {history.map(entry => <Button key={entry.id} variant="ghost" size="bare" className="api-history-item" title={entry.url} onClick={() => void openHistory(entry)}>
          <span className="api-history-line"><span className="api-method-tag" data-method={entry.method}>{entry.method.slice(0, 6)}</span><span className="api-status" data-tone={statusTone(entry.status)}>{entry.status ?? tr('실패', 'Failed')}</span><time>{new Date(entry.sentAt).toLocaleTimeString(language === 'ko' ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><small>{formatDuration(entry.durationMs)}</small></span>
          <span className="api-history-url">{entry.url}</span>
        </Button>)}
        {!history.length && <p className="history-empty aws-panel-empty">{historySearch ? tr('검색 결과가 없습니다.', 'No matching requests.') : tr('보낸 요청이 여기에 쌓입니다. 최근 500개까지 보관합니다.', 'Requests you send appear here. The latest 500 are kept.')}</p>}
      </div>
    </aside>}
    {naming && <NameDialog title={naming.title} initial={naming.initial} collections={naming.withCollection ? workspace.collections : undefined} collectionId={naming.collectionId} onSubmit={naming.submit} onClose={() => setNaming(null)}/>}
    {curl !== null && <CurlDialog initial={curl} onImport={spec => newTab(spec)} onClose={() => setCurl(null)}/>}
    {editingEnvironments && <EnvironmentDialog environments={workspace.environments} initial={workspace.activeEnvironment} onSave={saveEnvironments} onClose={() => setEditingEnvironments(false)}/>}
    {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)}/>}
  </>;

  function renderMain() {
    return <main className="main api-main" hidden={!visible} data-environment={production ? 'production' : undefined}>
      <header className="topbar"><div className="breadcrumb">
        <Button variant="ghost" size="bare" className="icon-button sidebar-toggle" aria-label={t(sidebarOpen ? '사이드바 접기' : '사이드바 펼치기')} title={t(sidebarOpen ? '사이드바 접기' : '사이드바 펼치기') + ' · Ctrl/Cmd+B'} aria-expanded={sidebarOpen} aria-controls="api-sidebar" onClick={onToggleSidebar}>{sidebarOpen ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}</Button>
        {active && <nav className="breadcrumb-path" aria-label={tr('현재 위치', 'Location')}><Waypoints size={14}/><span>API</span><ChevronRight size={13}/>{collectionName(active.collectionId) && <><span>{collectionName(active.collectionId)}</span><ChevronRight size={13}/></>}<strong aria-current="page">{tabName(active)}</strong></nav>}
      </div><div className="topbar-right">
        {notice && <span className="api-notice" role="status">{notice}</span>}
        {environment ? <span className="connection-status" title={tr('{{변수}}에 이 환경의 값을 씁니다', 'Fills {{variables}} from this environment')}><span className="live-dot" aria-hidden="true"/><span>{environment.name}</span></span>
          : <span className="connection-status api-no-env">{tr('환경 없음', 'No environment')}</span>}
        {production && <span className="env-banner" data-environment="production" role="note"><AlertTriangle size={13}/>PRODUCTION</span>}
        <Button variant="ghost" size="bare" className="icon-button history-toggle-button" aria-label={tr('요청 기록 패널', 'Request history panel')} title={tr('요청 기록 패널', 'Request history panel') + ' · Ctrl/Cmd+Alt+B'} aria-pressed={panelOpen} aria-controls="api-history" onClick={() => setPanelOpen(open => !open)}>{panelOpen ? <PanelRight size={17}/> : <History size={17}/>}</Button>
      </div></header>
      {!tabs.length ? <div className="workspace-empty"><Waypoints size={28}/><h1>{tr('API 요청을 보내 보세요', 'Send an API request')}</h1>
        <p className="connection-availability">{tr('가볍고 빠른 로컬 API 클라이언트입니다. 요청·환경·기록은 이 PC의 SQLite에만 저장됩니다.', 'A light, fast local API client. Requests, environments and history stay in SQLite on this PC.')}</p>
        <div className="empty-connection-actions">
          <Button variant="outline" size="sm" onClick={() => newTab()}><Plus size={14}/>{tr('새 요청', 'New request')}</Button>
          <Button variant="outline" size="sm" onClick={() => setCurl('')}><Import size={14}/>{tr('cURL 가져오기', 'Import cURL')}</Button>
          <Button variant="outline" size="sm" onClick={() => setEditingEnvironments(true)}><Settings2 size={14}/>{tr('환경 변수', 'Environments')}</Button>
        </div>
      </div> : <>
        <div className="tabs"><div className="tab-list" role="tablist" aria-label={tr('API 탭', 'API tabs')} onWheel={event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY; }}>
          {tabs.map(tab => { const name = tabName(tab); const sending = !!results[tab.id]?.ticket; return <div key={tab.id} className={`tab-item ${active?.id === tab.id ? 'active' : ''}`}>
            <Button variant="ghost" size="bare" role="tab" className="tab" id={`api-tab-${tab.id}`} aria-selected={active?.id === tab.id} aria-controls={`api-panel-${tab.id}`} tabIndex={active?.id === tab.id ? 0 : -1} title={`${tab.spec.method} ${tab.spec.url}`} onClick={() => setActiveId(tab.id)} onAuxClick={event => { if (event.button === 1) void close(tab.id); }}
              onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { const index = tabs.findIndex(item => item.id === tab.id), next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; setActiveId(next.id); document.getElementById(`api-tab-${next.id}`)?.focus(); } }}>
              <span className="api-method-tag" data-method={tab.spec.method}>{tab.spec.method.slice(0, 6)}</span><span>{name}</span>{sending ? <span className="api-tab-busy" aria-label={tr('보내는 중', 'Sending')}/> : dirty(tab) && tab.requestId && <span className="api-dirty" aria-label={tr('저장 안 됨', 'Unsaved')}/>}</Button>
            <Button variant="ghost" size="bare" className="tab-close" aria-label={t('탭 닫기 이름', { name })} title={t('탭 닫기')} onClick={() => void close(tab.id)}><X size={13}/></Button>
          </div>; })}
          <Button variant="ghost" size="bare" className="api-new-tab" aria-label={tr('새 요청', 'New request')} title={tr('새 요청', 'New request') + ' · Ctrl/Cmd+N'} onClick={() => newTab()}><Plus size={14}/></Button>
        </div></div>
        {active && <div className="aws-tab-panel" id={`api-panel-${active.id}`} role="tabpanel" aria-labelledby={`api-tab-${active.id}`}>
          <RequestPanel key={active.id} tab={active} variables={variables} result={results[active.id]} theme={theme} dirty={dirty(active)}
            onChange={spec => updateTab(active.id, { spec })} onSend={() => void send(active)} onCancel={() => cancel(active)} onSave={() => save(active)}/>
        </div>}
      </>}
    </main>;
  }
}
