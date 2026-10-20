import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import CodeMirror, { type EditorState } from '@uiw/react-codemirror';
import { sql as sqlLanguage, PostgreSQL, MySQL } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { GitBranch, Moon, Sun, PanelLeftClose, PanelLeftOpen, Play } from 'lucide-react';
import { readTheme, saveTheme } from './theme';
import { useLanguage } from './i18n';
import { SettingsDialog } from './SettingsDialog';
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu';
import type { StructurePlan } from './structure';
import { ObjectPage } from './ObjectPage';
import { createTab, isDirty, useWorkspaceTabs, type WorkspaceTab } from './workspace-tabs';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Database, FileCode2, Filter, KeyRound, Layers3, Loader2, LockKeyhole, Plus, RefreshCw, Search, Settings2, Table2, Terminal, Undo2, X } from 'lucide-react';
import * as api from './api';
import { collectEdits, csv, tableQuery, type Engine, type Profile, type Table } from './model';

const initialProfile: Profile = { id: 'demo', name: 'Woojoo playground', engine: 'postgres', host: 'demo.local', port: 5432, database: 'woojoo', username: 'postgres', password: '', tls: true };
type Connection = { profile: Profile; session: string };
const initialTab = createTab('demo', 0, { schema: 'public', name: 'users' }, tableQuery('postgres', 'public', 'users'));
const ErdPage = lazy(() => import('./ErdPage'));

export default function App() {
  const { language, setLanguage, t } = useLanguage();
  const [theme, setTheme] = useState(readTheme);
  const themeLabel = theme === 'dark' ? t("라이트 모드로 전환") : t("다크 모드로 전환");
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    setTheme(next);
  }
  const [connections, setConnections] = useState<Connection[]>([{ profile: initialProfile, session: 'demo' }]);
  const [active, setActive] = useState('demo');
  const connection = connections.find(c => c.session === active)!;
  const workspace = useWorkspaceTabs(active, initialTab);
  const { tab } = workspace;
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [tableList, setTableList] = useState<Table[]>([]);
  const [selected, setSelected] = workspace.field('selected');
  const [editorSql, setEditorSql] = workspace.field('editorSql');
  const [result, setResult] = workspace.field('result');
  const [source, setSource] = workspace.field('source');
  const [draft, setDraft] = workspace.field('draft');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = workspace.field('filter');
  const [busy, setBusy] = workspace.field('busy');
  const [error, setError] = workspace.field('error');
  const [notice, setNotice] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState<MenuState | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<{ sql: string; time: string; session: string }[]>([]);
  const [scroll, setScroll] = workspace.field('scroll');
  const [sort, setSort] = workspace.field('sort');
  const [editing, setEditing] = useState<{ index: number; col: string; value: string; isNull: boolean } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => { try { return localStorage.getItem('woojoo-sidebar') !== 'closed'; } catch { return true; } });
  function toggleSidebar() { setSidebarOpen(open => !open); }
  useEffect(() => { try { localStorage.setItem('woojoo-sidebar', sidebarOpen ? 'open' : 'closed'); } catch { /* Session-only preference. */ } }, [sidebarOpen]);
  const [databaseOpen, setDatabaseOpen] = useState(true);
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(new Set());
  const hasDialog = showConnect || showReview || showHelp || showSettings || !!editing;
  useEffect(() => { setContextMenu(null); }, [tab.id, active, busy, result, language, hasDialog]);
  function menuFor(items: MenuItem[] | (() => MenuItem[])) {
    const open = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
      event.preventDefault(); event.stopPropagation();
      const trigger = event.currentTarget;
      const rect = trigger.getBoundingClientRect();
      const pointer = 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0);
      setContextMenu({ x: pointer ? event.clientX : rect.left + 12, y: pointer ? event.clientY : rect.top + Math.min(rect.height, 32), items: typeof items === 'function' ? items() : items, trigger });
    };
    return {
      onContextMenu: open,
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') open(event);
      },
    };
  }
  useEffect(() => {
    if (!hasDialog) return;
    const dialog = document.querySelector<HTMLElement>('.modal');
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')];
    if (!dialog.contains(document.activeElement)) controls()[0]?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, [hasDialog]);
  const [lastQuery, setLastQuery] = workspace.field('lastQuery');
  const pending = useRef(new Set<string>());
  const gridRef = useRef<HTMLDivElement>(null);
  const op = useRef(0);
  const activeSessionRef = useRef(active); activeSessionRef.current = active;
  const busyRef = useRef(false); busyRef.current = busy;
  const draftRef = useRef(draft); draftRef.current = draft;
  const editorSelection = useRef('');
  const editorStates = useRef(new Map<string, EditorState>());
  const edits = collectEdits(result.rows, draft);
  const canEdit = source === 'table' && result.columns.some(c => c.primary);
  const runRef = useRef<() => void>(() => {});
  const allTabsRef = useRef(workspace.tabs); allTabsRef.current = workspace.tabs;
  const askDiscard = () => !Object.keys(draftRef.current).length || confirm(t("저장하지 않은 변경 사항을 버릴까요?"));
  function announce(text: string) { setNotice(text); window.setTimeout(() => setNotice(''), 4500); }
  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); announce(t('복사됨')); }
    catch { announce(t('클립보드에 복사하지 못했습니다.')); }
  }
  async function performFor(id: string, action: () => Promise<void>) {
    if (pending.current.has(id)) return;
    pending.current.add(id); workspace.patch(id, { busy: true, error: '' });
    try { await action(); } catch (e) { workspace.patch(id, { error: String(e) }); }
    finally { pending.current.delete(id); workspace.patch(id, { busy: false }); }
  }
  const perform = (action: () => Promise<void>) => performFor(tab.id, action);
  function tabName(item: WorkspaceTab) {
    if (item.kind === 'erd') return `${item.objectSchema} · ERD`;
    if (item.kind === 'schema') return item.objectSchema;
    if (item.kind === 'details') return `${item.selected?.name} · ${t('구조')}`;
    return item.kind === 'table' ? item.selected?.name ?? t('탐색기') : t('쿼리 번호', {number:item.number});
  }
  function activateTab(id: string) { editorSelection.current = ''; setEditing(null); setShowReview(false); workspace.activate(id); }
  function navigateTabs(event: React.KeyboardEvent<HTMLButtonElement>, id: string) {
    const items = workspace.connectionTabs, index = items.findIndex(item => item.id === id);
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault(); activateTab(items[next].id); document.getElementById(`tab-${items[next].id}`)?.focus();
  }
  useEffect(() => { document.getElementById(`tab-${tab.id}`)?.scrollIntoView({block:'nearest', inline:'nearest'}); }, [tab.id]);
  function addQuery(sql = '') { editorSelection.current = ''; workspace.add(null, sql); }
  function closeTab(item: WorkspaceTab) {
    if (item.busy || pending.current.has(item.id)) return;
    if (isDirty(item) && !confirm(t('탭 닫기 확인'))) return;
    editorSelection.current = ''; editorStates.current.delete(item.id); workspace.close(item.id);
  }
  async function openTable(table: Table, refresh = false) {
    const existing = workspace.connectionTabs.find(item => item.kind === 'table' && item.selected?.name === table.name && item.selected.schema === table.schema);
    if (!refresh && existing) { activateTab(existing.id); return; }
    if (refresh && !askDiscard()) return;
    const target = refresh ? tab : workspace.add(table, tableQuery(connection.profile.engine, table.schema, table.name));
    await performFor(target.id, async () => {
      const data = await api.readTable(active, table);
      const sql = tableQuery(connection.profile.engine, table.schema, table.name);
      workspace.patch(target.id, { selected: table, source: 'table', result: data, draft: {}, filter: '', sort: null, scroll: 0, editorSql: sql, initialSql: sql, loaded: true, lastQuery: '' });
    });
  }
  function changeBlocked(table: Table) {
    return allTabsRef.current.some(item => item.session === active && (item.busy || (item.selected?.schema === table.schema && item.selected.name === table.name && Object.keys(item.draft).length > 0)));
  }
  async function structureChanged(plan: StructurePlan) {
    const {change} = plan, session = active;
    const renamed = change.kind === 'alterTable' ? {...change.table,name:change.name} : change.table;
    setCatalogVersion(value => value + 1);
    const list = await api.tables(session);
    if(activeSessionRef.current === session) setTableList(list);
    for(const item of allTabsRef.current.filter(item => item.session === session)) {
      if(item.kind === 'erd') workspace.patch(item.id,{erd:null});
      if(item.selected?.schema !== change.table.schema || item.selected.name !== change.table.name) continue;
      if(change.kind === 'dropTable') {
        workspace.patch(item.id,{kind:'schema',objectSchema:change.table.schema,selected:null,details:[],result:{columns:[],rows:[],elapsedMs:0,affected:0,truncated:false},draft:{},filter:'',error:''});
      } else if(item.kind === 'details') {
        workspace.patch(item.id,{selected:renamed,details:await api.describeTable(session,renamed),filter:'',error:''});
      } else if(item.kind === 'table') {
        const sql = tableQuery(connection.profile.engine,renamed.schema,renamed.name);
        workspace.patch(item.id,{selected:renamed,result:await api.readTable(session,renamed),draft:{},sort:null,filter:'',scroll:0,error:'',...(item.editorSql===item.initialSql?{editorSql:sql,initialSql:sql}:{})});
      }
    }
  }
  function openSchema(schema: string) {
    const existing = workspace.connectionTabs.find(item => item.kind === 'schema' && item.objectSchema === schema);
    if (existing) { activateTab(existing.id); return; }
    const next = workspace.add();
    workspace.patch(next.id, { kind: 'schema', objectSchema: schema, loaded: true });
  }
  function openErd(schema: string) {
    const existing = workspace.connectionTabs.find(item => item.kind === 'erd' && item.objectSchema === schema);
    if (existing) { activateTab(existing.id); return; }
    const next = workspace.add();
    workspace.patch(next.id, { kind: 'erd', objectSchema: schema, loaded: true });
  }
  async function openDetails(table: Table, refresh = false) {
    const existing = workspace.connectionTabs.find(item => item.kind === 'details' && item.selected?.schema === table.schema && item.selected.name === table.name);
    if (existing && !refresh) { activateTab(existing.id); return; }
    const next = existing ?? workspace.add(table);
    activateTab(next.id);
    workspace.patch(next.id, { kind: 'details', objectSchema: table.schema });
    await performFor(next.id, async () => {
      const details = await api.describeTable(active, table);
      workspace.patch(next.id, { details, loaded: true });
    });
  }
  function tableMenu(table: Table): MenuItem[] {
    return [
      { label: t('테이블 상세'), action: () => void openDetails(table) },
      { label: t('ERD 열기'), action: () => openErd(table.schema) },
      { label: t('데이터 보기'), action: () => void openTable(table) },
      { label: t('SELECT 쿼리 열기'), action: () => addQuery(tableQuery(connection.profile.engine, table.schema, table.name)) },
      { label: t('테이블 이름 복사'), action: () => void copyText(`${table.schema}.${table.name}`), divider: true },
    ];
  }
  useEffect(() => {
    const token = ++op.current;
    setDatabaseOpen(true); setCollapsedSchemas(new Set()); setSearch('');
    editorSelection.current = '';
    busyRef.current = true; setBusy(true);
    setTableList([]);
    api.tables(active).then(async list => {
      if (token !== op.current) return;
      setTableList(list);
      if (list.length && (!workspace.connectionTabs.length || tab.id === initialTab.id && !tab.loaded)) {
        const data = await api.readTable(active, list[0]);
        if (token !== op.current) return;
        setSelected(list[0]); setSource('table'); setResult(data);
        const sql = tableQuery(connection.profile.engine, list[0].schema, list[0].name);
        workspace.patch(tab.id, {kind:'table', selected:list[0], editorSql:sql, initialSql:sql, loaded:true});
      }
    }).catch(e => { if (token === op.current) setError(String(e)); })
      .finally(() => { if (!pending.current.has(tab.id)) setBusy(false); });
    return () => { op.current++; };
  }, [active]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (showSettings) {
        if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key === ',')) event.preventDefault();
        if (event.key === 'Escape') setShowSettings(false);
        return;
      }
      if (showConnect || showReview || showHelp || editing || showHistory) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.preventDefault();
        if (event.key === 'Escape' && !busyRef.current) {
          setEditing(null); setShowReview(false); setShowHelp(false); setShowHistory(false);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); setShowSettings(true); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleSidebar(); }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); runRef.current(); }
      if (event.key === 'Escape') { setEditing(null); setShowHelp(false); }
    };
    const leave = (event: BeforeUnloadEvent) => { if (allTabsRef.current.some(isDirty)) event.preventDefault(); };
    window.addEventListener('keydown', key); window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', leave); };
  }, [showConnect, showReview, showHelp, showSettings, editing, showHistory]);
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = scroll;
  }, [tab.id, scroll]);
  const executeQuery = (text: string) => {
    if (pending.current.has(tab.id) || !askDiscard() || !text) return;
    void perform(async () => {
      const data = await api.query(active, text);
      workspace.markQuery(tab.id);
      setLastQuery(text);
      setResult(data); setSource('query'); setDraft({}); setFilter(''); setSort(null); setScroll(0);
      setHistory(h => [{ sql: text, session: active, time: new Date().toLocaleTimeString(language === 'ko' ? 'ko-KR' : 'en-US') }, ...h].slice(0, 30));
    });
  };
  const run = () => { if (tab.kind === 'table' || tab.kind === 'query') executeQuery(editorSelection.current.trim() || editorSql.trim()); };
  runRef.current = run;
  async function applyChanges() {
    if (!selected) return;
    await perform(async () => {
      const count = await api.save(active, selected, edits);
      setDraft({}); setShowReview(false);
      announce(t('변경 적용됨', {count}) + (active === 'demo' ? ' · ' + t('데모 저장 안내') : ''));
      setResult(await api.readTable(active, selected));
    });
  }
  function exportCsv() {
    const content = csv(result.columns.map(c => c.name), result.rows);
    const url = URL.createObjectURL(new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${selected?.name ?? 'query'}-results.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function refreshResults() {
    if (busy) return;
    if (source === 'query') {
      if (lastQuery && (/^\s*select\b/i.test(lastQuery) || confirm(t('마지막 쿼리를 다시 실행할까요? 데이터를 변경하는 SQL은 다시 적용됩니다.')))) executeQuery(lastQuery);
    } else if (selected) void openTable(selected, true);
  }
  const refreshTables = () => void perform(async () => {
    const list = await api.tables(active);
    if (activeSessionRef.current === active) setTableList(list);
  });
  const resultMenu: MenuItem[] = [
    { label: t('결과 새로고침'), action: refreshResults, disabled: busy || (source === 'table' ? !selected : !lastQuery) },
    { label: t('CSV 내보내기'), action: exportCsv, disabled: !result.columns.length },
    { label: t('필터 지우기'), action: () => { setFilter(''); setScroll(0); }, disabled: !filter },
  ];
  const filtered = result.rows.map((original, index) => {
    const row = { ...original };
    for (const col of result.columns) {
      const key = `${index}:${col.name}`;
      if (key in draft) row[col.name] = draft[key];
    }
    return { row, index };
  }).filter(({ row }) => !filter || Object.values(row).some(v => v?.toLowerCase().includes(filter.toLowerCase())));
  if (sort) filtered.sort((a, b) => (a.row[sort.name] ?? '').localeCompare(b.row[sort.name] ?? '', undefined, { numeric: true }) * (sort.desc ? -1 : 1));
  const start = Math.max(0, Math.floor(scroll / 39) - 6);
  const visible = filtered.slice(start, start + 40);
  const visibleTables = tableList.filter(t => `${t.schema}.${t.name}`.toLowerCase().includes(search.toLowerCase()));
  const schemas = [...new Set(visibleTables.map(t => t.schema))];
  return <div className="app">
    <aside className="rail">
      <span className="brand-mark" aria-label="Woojoo">W</span>
      <button className={`rail-button ${sidebarOpen ? 'selected' : ''}`} aria-expanded={sidebarOpen} title={t("데이터베이스")} onClick={toggleSidebar}><Database size={21}/></button>
      <button className={`rail-button ${showHistory ? 'selected' : ''}`} title={t("쿼리 기록")} onClick={() => setShowHistory(v => !v)}><Clock3 size={21}/></button>
      <div className="rail-bottom"><button className="rail-button" title={themeLabel} aria-label={themeLabel} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={21}/> : <Moon size={21}/>}</button><button className="rail-button" title={t("설정") + " · Ctrl/Cmd+,"} aria-label={t("설정")} onClick={() => setShowSettings(true)}><Settings2 size={21}/></button><button className="rail-button" title={t("도움말")} onClick={() => setShowHelp(true)}><CircleHelp size={21}/></button></div>
    </aside>
    {sidebarOpen && <aside className="sidebar" id="database-sidebar" onContextMenu={event => { if (event.target instanceof HTMLInputElement) return; menuFor([{label:t("연결 추가"),action:()=>setShowConnect(true)},{label:t("목록 새로고침"),action:refreshTables,disabled:busy}]).onContextMenu(event); }}>
      <div className="workspace-brand"><span>Woojoo</span></div>
      <div className="section-label"> {t("연결")} <button title={t("연결 추가")} aria-label={t("새 연결")} onClick={() => setShowConnect(true)}><Plus size={16}/></button></div>
      <div className="connections">{connections.map(c => <button key={c.session} {...menuFor([
        {label:t('연결 선택'), action:()=>setActive(c.session)},
        {label:t('호스트 복사'), action:()=>void copyText(c.profile.host)},
        {label:t('연결 추가'), action:()=>setShowConnect(true), divider:true},
      ])} className={`connection ${active === c.session ? 'active' : ''}`} onClick={() => { editorSelection.current = ''; setActive(c.session); }}>
        <span className={`db-icon ${c.profile.engine !== 'postgres' ? 'mysql' : ''}`}><Database size={18}/></span>
        <span className="connection-name">{c.profile.name}<small>{c.profile.engine === 'postgres' ? 'PostgreSQL' : c.profile.engine === 'mariadb' ? 'MariaDB' : 'MySQL'} <span>· {c.session === 'demo' ? 'Demo' : c.profile.host}</span></small></span><span className="live-dot"/>
      </button>)}</div>
      <div className="divider"/>
      <div className="section-label"> {t("테이블")} <button title={t("목록 새로고침")} disabled={busy} onClick={() => void perform(async () => { const list = await api.tables(active); if (activeSessionRef.current === active) setTableList(list); })}><RefreshCw size={14}/></button></div>
      <label className="search-field"><Search size={14}/><input aria-label={t("테이블 검색")} placeholder={t("테이블 검색")} value={search} onChange={e => setSearch(e.target.value)}/></label>
      <div className="tree">
        <button className="tree-db" aria-expanded={databaseOpen || !!search} onClick={() => {setSearch('');setDatabaseOpen(v => !v);}}>{databaseOpen || search ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<Database size={15}/><span>{connection.profile.database}</span><span className="count">{tableList.length}</span></button>
        {(databaseOpen || !!search) && schemas.map(schema => <div key={schema}><div className="schema-tree-row"><button className="schema-expander icon-button" aria-label={t('스키마 펼치기/접기') + ': ' + schema} aria-expanded={!collapsedSchemas.has(schema) || !!search} onClick={() => {setSearch('');setCollapsedSchemas(previous => {const next=new Set(previous);if(next.has(schema))next.delete(schema);else next.add(schema);return next;});}}>{!collapsedSchemas.has(schema)||search?<ChevronDown size={13}/>:<ChevronRight size={13}/>}</button><button className="tree-schema" {...menuFor([{label:t("스키마 상세"),action:()=>openSchema(schema)},{label:t("ERD 열기"),action:()=>openErd(schema)},{label:t("이름 복사"),action:()=>void copyText(schema)},{label:t("목록 새로고침"),action:refreshTables,disabled:busy}])} onClick={() => openSchema(schema)}><Layers3 size={14}/>{schema}</button><button className="schema-open icon-button" aria-label={t("스키마 상세 이름", {name:schema})} title={t("스키마 상세")} onClick={() => openSchema(schema)}><ArrowRight size={13}/></button></div>
          {(!collapsedSchemas.has(schema) || !!search) && visibleTables.filter(t => t.schema === schema).map(t => <button key={`${t.schema}.${t.name}`} {...menuFor(tableMenu(t))} disabled={busy} className={`tree-table ${selected?.name === t.name && selected.schema === t.schema ? 'active' : ''}`} onClick={() => void openDetails(t)}><Table2 size={14}/><span>{t.name}</span>{selected?.name === t.name && <span className="table-dot"/>}</button>)}
        </div>)}
        {!visibleTables.length && <p className="empty-tree"> {t("표시할 테이블이 없습니다.")} </p>}
      </div>
    </aside>}
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button sidebar-toggle" aria-label={t(sidebarOpen ? '사이드바 접기' : '사이드바 펼치기')} title={t(sidebarOpen ? '사이드바 접기' : '사이드바 펼치기') + ' · Ctrl/Cmd+B'} aria-expanded={sidebarOpen} aria-controls="database-sidebar" onClick={toggleSidebar}>{sidebarOpen ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}</button><Database size={14}/><span>{connection.profile.database}</span><ChevronRight size={13}/><strong>{tab.kind === 'schema' || tab.kind === 'erd' ? tab.objectSchema : selected?.schema ?? 'SQL'}</strong></div><div className="topbar-right"><select className="language-select" aria-label="언어 / Language" value={language} onChange={event => setLanguage(event.target.value as 'ko' | 'en')}><option value="ko">한국어</option><option value="en">English</option></select><span className="mode-tag" title={active === 'demo' ? t("샘플 데이터 · 앱을 다시 열면 초기화됩니다") : connection.profile.tls ? t("TLS 인증서 검증 사용") : t("TLS 사용 안 함")}>{active === 'demo' ? t("데모") : t("연결됨")}</span><button className="subtle-button" onClick={() => setShowConnect(true)}><Plus size={14}/> {t("연결 추가")} </button></div></header>
      <div className="tabs" {...menuFor([{label:t("새 쿼리"),action:()=>addQuery()}])}><div className="tab-list" role="tablist" aria-label={t('쿼리 탭')}>
        {workspace.connectionTabs.map(item => <div key={item.id} className={`tab-item ${tab.id === item.id ? 'active' : ''}`}>
          <button role="tab" id={`tab-${item.id}`} aria-controls="query-panel" aria-selected={tab.id === item.id} tabIndex={tab.id === item.id ? 0 : -1} onContextMenu={menuFor([
            {label:t('새 쿼리'),action:()=>addQuery()},
            {label:t('SQL 복제'),action:()=>addQuery(item.editorSql),disabled:!item.editorSql},
            {label:t('탭 닫기'),action:()=>closeTab(item),disabled:item.busy,divider:true},
          ]).onContextMenu} onKeyDown={event => {
            if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') menuFor([{label:t('새 쿼리'),action:()=>addQuery()},{label:t('SQL 복제'),action:()=>addQuery(item.editorSql),disabled:!item.editorSql},{label:t('탭 닫기'),action:()=>closeTab(item),disabled:item.busy}]).onKeyDown(event);
            else navigateTabs(event,item.id);
          }} className="tab" onClick={() => activateTab(item.id)}>{item.busy ? <Loader2 size={14} className="spin"/> : item.kind === 'erd' ? <GitBranch size={14}/> : item.kind === 'schema' ? <Layers3 size={14}/> : item.kind === 'table' || item.kind === 'details' ? <Table2 size={14}/> : <FileCode2 size={14}/>}<span>{tabName(item)}</span>{isDirty(item) && <i className="tab-dirty" aria-hidden="true"/>}</button>
          <button className="tab-close" aria-label={t('탭 닫기 이름', {name:tabName(item)})} title={t('탭 닫기')} disabled={item.busy} onClick={() => closeTab(item)}><X size={13}/></button>
        </div>)}
      </div><button className="tab-add" title={t('새 쿼리')} onClick={() => addQuery()}><Plus size={17}/></button></div>
      {tab.kind === 'erd' ? <Suspense fallback={<div className="object-empty">{t('ERD 생성 중…')}</div>}><ErdPage key={tab.id+catalogVersion} session={active} schema={tab.objectSchema} theme={theme} initial={tab.erd}
        storageKey={'woojoo-erd-v1:' + JSON.stringify([connection.profile.engine,connection.profile.host,connection.profile.port,connection.profile.database,connection.profile.username,tab.objectSchema])}
        onChange={erd => workspace.patch(tab.id,{erd})}/></Suspense> : tab.kind === 'schema' || tab.kind === 'details' ? <ObjectPage key={tab.id} session={active} engine={connection.profile.engine} revision={catalogVersion} onChanged={structureChanged} changeBlocked={changeBlocked} tab={tab} database={connection.profile.database} tables={tableList} onFilter={setFilter}
        onRefresh={() => tab.kind === 'schema' ? refreshTables() : tab.selected && void openDetails(tab.selected,true)}
        onSchema={openSchema} onErd={openErd} onDetails={table => void openDetails(table)} onData={table => void openTable(table)}
        onQuery={table => addQuery(tableQuery(connection.profile.engine,table.schema,table.name))} tableMenu={tableMenu} menuFor={menuFor}/> : <>
      <section {...menuFor(() => [
        {label:t('실행'),action:run,disabled:busy||!editorSql.trim()},
        {label:t('선택한 SQL 복사'),action:()=>void copyText(editorSelection.current),disabled:!editorSelection.current},
        {label:t('전체 SQL 복사'),action:()=>void copyText(editorSql),disabled:!editorSql},
        {label:t('새 쿼리'),action:()=>addQuery(),divider:true},
      ])} className="editor-pane" id="query-panel" role="tabpanel" aria-labelledby={`tab-${tab.id}`}>
        <div className="editor-toolbar"><div><span className="language-badge">SQL</span></div><div><button className="run-button" title={t("선택한 SQL 또는 전체 구문 실행 · Ctrl/Cmd + Enter · 자동 커밋")} disabled={busy || !editorSql.trim()} onClick={run}>{busy ? <Loader2 size={14} className="spin"/> : <Play size={14}/>} {t("실행")} </button></div></div>
        <CodeMirror key={tab.id} value={editorSql} height="184px" theme={theme === 'dark' ? oneDark : 'light'} editable={!busy} extensions={[sqlLanguage({dialect: connection.profile.engine === 'postgres' ? PostgreSQL : MySQL, schema: Object.fromEntries(tableList.map(t => [t.name, t.name === selected?.name ? result.columns.map(c => c.name) : []]))})]} onChange={setEditorSql} onCreateEditor={view => { const saved = editorStates.current.get(tab.id); if (saved && saved.doc.toString() === editorSql) { view.setState(saved); editorSelection.current = saved.sliceDoc(saved.selection.main.from, saved.selection.main.to); } }} onUpdate={u => { editorStates.current.set(tab.id, u.state); editorSelection.current = u.state.sliceDoc(u.state.selection.main.from, u.state.selection.main.to); }} basicSetup={{lineNumbers: true, foldGutter:false, highlightActiveLine:true, autocompletion:true}}/>
      </section>
      <section className="results-pane" {...menuFor(resultMenu)}>
        <div className="result-tabs"><div className="result-tab"><Table2 size={15}/> {t("결과")} <span>{result.rows.length}</span></div>{selected && <button className="subtle-button" onClick={() => void openDetails(selected)}>{t("테이블 상세")}</button>}<div className="result-meta">{busy ? <Loader2 size={13} className="spin"/> : <Check size={13}/>}<span aria-live="polite">{busy ? t("처리 중…") : `${result.elapsedMs} ms`}</span><span className="sep">·</span><span>{source === 'table' ? t("테이블 보기") : t("쿼리 결과 · 읽기 전용")}</span></div><span className="tabs-spacer"/><button className="icon-button" title={t("CSV 내보내기")} aria-label={t("CSV 내보내기")} disabled={!result.columns.length} onClick={exportCsv}><ArrowDownToLine size={16}/></button><button className="icon-button" title={source === 'query' ? t("마지막 쿼리 다시 실행") : t("테이블 새로고침")} aria-label={t("테이블 새로고침")} disabled={busy || (source === 'table' ? !selected : !lastQuery)} onClick={() => source === 'query' ? (/^\s*select\b/i.test(lastQuery) || confirm(t("마지막 쿼리를 다시 실행할까요? 데이터를 변경하는 SQL은 다시 적용됩니다."))) && executeQuery(lastQuery) : selected && void openTable(selected, true)}><RefreshCw size={15}/></button></div>
        <div className="result-toolbar"><label className="result-filter"><Filter size={14}/><input aria-label={t("결과 필터")} placeholder={t("결과 검색")} value={filter} onChange={e => {setFilter(e.target.value);setScroll(0);}}/></label><span className="tabs-spacer"/>{edits.length > 0 && <><button className="subtle-button" disabled={busy} onClick={() => setDraft({})}><Undo2 size={14}/> {t("취소")} </button><button className="save-button" disabled={busy} onClick={() => setShowReview(true)}><Check size={14}/> {t("변경 검토")} <span>{edits.length}</span></button></>}</div>
        {error && <div role="alert" className="error-banner"><Terminal size={15}/><span>{error}</span><button title={t("오류 닫기")} onClick={() => setError('')}><X size={14}/></button></div>}
        <div className="grid-scroll" ref={gridRef} aria-busy={busy} onScroll={e => setScroll(e.currentTarget.scrollTop)} key={tab.id}>
          <table className="data-grid"><thead><tr><th className="row-number">#</th>{result.columns.map(c => <th key={c.name} tabIndex={0} {...menuFor([
              {label:t('열 이름 복사'),action:()=>void copyText(c.name)},
              {label:t('오름차순 정렬'),action:()=>{setSort({name:c.name,desc:false});setScroll(0);}},
              {label:t('내림차순 정렬'),action:()=>{setSort({name:c.name,desc:true});setScroll(0);}},
              {label:t('정렬 해제'),action:()=>{setSort(null);setScroll(0);},disabled:!sort},
            ])} onClick={() => {setSort({name:c.name, desc:sort?.name === c.name && !sort.desc});setScroll(0);}} ><div>{c.primary ? <KeyRound size={12} className="key-icon"/> : <span className="type-icon">{c.dataType.includes('int') ? '#' : 'T'}</span>}<strong>{c.name}</strong>{sort?.name === c.name && <span>{sort.desc ? '↓' : '↑'}</span>}<span className="col-type">{c.dataType}</span></div></th>)}</tr></thead><tbody>
            {start > 0 && <tr className="spacer-row" style={{height:start * 39}}><td colSpan={result.columns.length + 1}/></tr>}
            {visible.map(({row, index}) => <tr key={index} {...menuFor([{label:t("행 복사"),action:()=>void copyText(result.columns.map(c=>row[c.name] ?? "NULL").join("\t"))}])}><td className="row-number">{index + 1}</td>{result.columns.map(col => {
              const key = `${index}:${col.name}`, changed = key in draft && draft[key] !== result.rows[index][col.name], value = key in draft ? draft[key] : row[col.name];
              return <td key={col.name} tabIndex={0} {...menuFor([
                {label:t('셀 복사'),action:()=>void copyText(value ?? 'NULL')},
                {label:t('행 복사'),action:()=>void copyText(result.columns.map(c=>row[c.name] ?? 'NULL').join('\t'))},
                {label:t('셀 편집'),action:()=>setEditing({index,col:col.name,value:value ?? '',isNull:value===null}),disabled:busy||!canEdit||!col.editable,divider:true},
                {label:t('NULL로 설정'),action:()=>setEditing({index,col:col.name,value:value ?? '',isNull:true}),disabled:busy||!canEdit||!col.editable},
                {label:t('셀 변경 취소'),action:()=>setDraft(previous=>{const next={...previous};delete next[key];return next;}),disabled:busy||!changed},
              ])} className={`${changed ? 'changed' : ''} ${col.primary ? 'pk-cell' : ''}`} title={value ?? 'NULL'} onDoubleClick={() => { if (busy) return; if (canEdit && col.editable) setEditing({index,col:col.name,value:value ?? '',isNull:value === null}); else announce(!canEdit ? t("읽기 전용 결과입니다. 기본키가 있는 테이블을 열어 편집하세요.") : t("기본키·생성 열 또는 지원하지 않는 형식은 수정할 수 없습니다.")); }}>
                {value === null ? <span className="null-value">NULL</span> : value}
              </td>;
            })}</tr>)}
            {start + visible.length < filtered.length && <tr className="spacer-row" style={{height:(filtered.length - start - visible.length) * 39}}><td colSpan={result.columns.length + 1}/></tr>}
          </tbody></table>
          {!result.rows.length && <div className="empty-result"><Database size={32}/><h3>{busy ? t("데이터를 불러오는 중...") : t("결과 없음")}</h3><p>{result.affected ? t('영향받은 행', {count: result.affected}) : t("테이블을 선택하거나 SQL을 실행해 보세요.")}</p></div>}
          {result.rows.length > 0 && !filtered.length && <div className="empty-result"><Search size={26}/><p> {t("일치하는 결과가 없습니다.")} </p></div>}
        </div>
        <div className="result-footer"><span><span className="live-dot"/> {filtered.length} {t("행")} <span className="sep">·</span> {result.columns.length} {t("열")} {result.truncated && <strong className="limit-note"> {t("· 500행에서 제한됨")} </strong>}</span><span>{edits.length > 0 && t('변경 대기', {count: edits.length})}</span></div>
      </section>
      </>}
    </main>
    {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)}/> }
    {notice && <div role="status" className="toast"><Check size={16}/>{notice}</div>}
    {showConnect && <ConnectionDialog onClose={() => setShowConnect(false)} onConnected={(profile, session) => {setConnections(c => [...c, {profile:{...profile,password:''},session}]);setActive(session);setShowConnect(false);}}/>}
    {editing && <div className="modal-backdrop"><div className="modal cell-modal" role="dialog" aria-modal="true" aria-label={t("셀 편집")}><div className="modal-heading"><h2> {t("셀 편집")} </h2><button onClick={() => setEditing(null)} aria-label={t("닫기")}><X size={20}/></button></div><p className="modal-description">{selected?.name} / <strong>{editing.col}</strong> {t("· 행")} {editing.index + 1}</p><textarea aria-label={t("셀 값")} autoFocus value={editing.value} disabled={editing.isNull} onChange={e => setEditing({...editing,value:e.target.value})}/><label className="checkbox-label"><input type="checkbox" checked={editing.isNull} onChange={e => setEditing({...editing,isNull:e.target.checked})}/> {t("NULL로 설정")} </label><div className="modal-actions"><button className="secondary-button" onClick={() => setEditing(null)}> {t("취소")} </button><button className="primary-button" onClick={() => {setDraft(d => ({...d,[`${editing.index}:${editing.col}`]:editing.isNull ? null : editing.value}));setEditing(null);}}> {t("변경 대기열에 추가")} </button></div></div></div>}
    {showReview && <div className="modal-backdrop"><div className="modal review-modal" role="dialog" aria-modal="true" aria-label={t("변경 사항 검토")}><div className="modal-heading"><h2> {t("변경 사항 검토")} </h2><button disabled={busy} onClick={() => setShowReview(false)} aria-label={t("닫기")}><X size={20}/></button></div><p className="modal-description">{t('검토 설명', {table: `${selected?.schema}.${selected?.name}`, count: edits.length})} {active === 'demo' ? t("데모 데이터에만 반영됩니다.") : t("모든 변경을 하나의 트랜잭션으로 적용합니다.")}</p><div className="review-list">{edits.map((edit,i) => <div className="review-row" key={i}><small>{result.columns.filter(c => c.primary).map(c => `${c.name} = ${edit.original[c.name]}`).join(', ')}</small>{Object.entries(edit.changes).map(([col,val]) => <div key={col}><strong>{col}</strong><del>{edit.original[col] ?? 'NULL'}</del><ArrowRight size={14}/><ins>{val ?? 'NULL'}</ins></div>)}</div>)}</div>{error && <p className="dialog-error">{error}</p>}<div className="modal-actions"><button disabled={busy} className="secondary-button" onClick={() => setShowReview(false)}> {t("돌아가기")} </button><button disabled={busy} className="primary-button" onClick={() => void applyChanges()}>{busy ? t("적용 중...") : t('행 적용', {count: edits.length})}</button></div></div></div>}
    {showHistory && <aside className="history-panel"><div className="modal-heading"><h2> {t("쿼리 기록")} </h2><button onClick={() => setShowHistory(false)} aria-label={t("닫기")}><X size={18}/></button></div><p> {t("현재 앱 세션의 실행 기록")} </p>{!history.some(h => h.session === active) && <div className="history-empty"><Clock3 size={28}/><p> {t("실행한 쿼리가 여기에 표시됩니다.")} </p></div>}{history.filter(h => h.session === active).map((h,i) => <button key={i} {...menuFor([{label:t("새 쿼리"),action:()=>{addQuery(h.sql);setShowHistory(false);}},{label:t("전체 SQL 복사"),action:()=>void copyText(h.sql)}])} className="history-item" disabled={busy} onClick={() => {addQuery(h.sql);setShowHistory(false);}}><small>{h.time}</small><code>{h.sql}</code></button>)}</aside>}
    {showSettings && <SettingsDialog theme={theme} onThemeChange={next => { saveTheme(next); setTheme(next); }} sidebarOpen={sidebarOpen} onSidebarChange={setSidebarOpen} onClose={() => setShowSettings(false)}/> }
    {showHelp && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label={t("도움말")}><div className="modal-heading"><h2> {t("도움말")} </h2><button onClick={() => setShowHelp(false)} aria-label={t("닫기")}><X size={20}/></button></div><div className="help-content"><p><kbd>Ctrl + Enter</kbd> {t("선택한 구문 또는 편집기의 SQL 실행")} </p><p><strong> {t("결과 편집")} </strong> {t("테이블 보기에서 셀 더블클릭 → 변경 검토 → 적용. 기본키와 생성 열은 수정할 수 없습니다.")} </p><p><strong> {t("데모 모드")} </strong> {t("샘플 데이터는 메모리에만 존재하며 앱을 다시 열면 초기화됩니다.")} </p><p><strong> {t("실제 연결")} </strong> {t("데스크톱 앱에서 PostgreSQL·MySQL·MariaDB에 연결하세요. 연결 정보는 이번 세션에만 유지됩니다.")} </p><p><strong> {t("쿼리 실행")} </strong> {t("단일 SQL · 자동 커밋 · 최대 500행 표시")} </p></div><button className="primary-button full" onClick={() => setShowHelp(false)}> {t("확인")} </button></div></div>}
  </div>;
}

function ConnectionDialog({onClose,onConnected}:{onClose:()=>void;onConnected:(p:Profile,id:string)=>void}) {
  const { t } = useLanguage();
  const [profile,setProfile] = useState<Profile>({id:crypto.randomUUID(),name:'Local PostgreSQL',engine:'postgres',host:'localhost',port:5432,database:'postgres',username:'postgres',password:'',tls:true});
  const [loading,setLoading] = useState(false);
  const [message,setMessage] = useState('');
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [loading, onClose]);
  const field = (key: keyof Profile, value: string | number | boolean) => setProfile(p => ({...p,[key]:value}));
  async function submit(test: boolean) {
    if (!profile.name.trim() || !profile.host.trim() || !profile.database.trim() || !profile.username.trim() || !Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {setMessage(t("연결 이름, 호스트, DB, 사용자와 유효한 포트를 입력하세요."));return;}
    setLoading(true);setMessage('');
    try { const id = await api.connect(profile);if(test){await api.disconnect(id);setMessage(t("연결에 성공했습니다."));}else onConnected(profile,id); } catch(e){setMessage(String(e));}finally{setLoading(false);}
  }
  return <div className="modal-backdrop"><form role="dialog" aria-modal="true" aria-label={t("새 연결")} className="modal connection-modal" onSubmit={e => {e.preventDefault();void submit(false);}}><div className="modal-heading"><div className="modal-symbol"><Database size={22}/></div><button type="button" disabled={loading} onClick={onClose} aria-label={t("닫기")}><X size={20}/></button></div><h2> {t("새 연결")} </h2>{!api.desktop && <p className="connection-availability"> {t("브라우저에서는 데모만 사용할 수 있습니다. 실제 데이터베이스 연결은 데스크톱 앱에서 지원합니다.")} </p>}<div className="engine-options">{(['postgres','mysql','mariadb'] as Engine[]).map(engine => <button key={engine} type="button" className={profile.engine === engine ? 'active' : ''} onClick={() => setProfile(p => ({...p,engine,port:engine === 'postgres'?5432:3306,username:engine === 'postgres'?'postgres':'root',database:engine==='postgres'?'postgres':'mysql',name:engine==='postgres'?'Local PostgreSQL':engine==='mysql'?'Local MySQL':'Local MariaDB'}))}><Database size={20}/>{engine === 'postgres' ? 'PostgreSQL' : engine === 'mysql' ? 'MySQL' : 'MariaDB'}</button>)}</div><label> {t("연결 이름")} <input aria-label={t("연결 이름")} value={profile.name} onChange={e=>field('name',e.target.value)}/></label><div className="form-row"><label> {t("호스트")} <input aria-label={t("호스트")} value={profile.host} onChange={e=>field('host',e.target.value)}/></label><label className="port"> {t("포트")} <input aria-label={t("포트")} type="number" value={profile.port} onChange={e=>field('port',Number(e.target.value))}/></label></div><label> {t("데이터베이스")} <input aria-label={t("데이터베이스")} value={profile.database} onChange={e=>field('database',e.target.value)}/></label><div className="form-row"><label> {t("사용자")} <input aria-label={t("사용자")} value={profile.username} onChange={e=>field('username',e.target.value)}/></label><label> {t("비밀번호")} <input aria-label={t("비밀번호")} type="password" autoComplete="off" value={profile.password} onChange={e=>field('password',e.target.value)}/></label></div><label className="checkbox-label"><input type="checkbox" checked={profile.tls} onChange={e=>field('tls',e.target.checked)}/> {t("TLS 사용 · 서버 인증서 검증")} </label><p className="credential-note"><LockKeyhole size={13}/> {t("비밀번호는 디스크에 저장하지 않습니다.")} </p>{message && <p role="status" className="dialog-message">{message}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={loading} onClick={()=>void submit(true)}> {t("연결 테스트")} </button><button type="submit" className="primary-button" disabled={loading}>{loading?<Loader2 size={15} className="spin"/>:<Play size={15}/>} {t("연결하기")} </button></div></form></div>;
}
