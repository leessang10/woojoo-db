import { ConnectionSwitcher } from './ConnectionSwitcher';
import { CommonSqlDialog } from './CommonSqlDialog';
import { useConfirm } from './components/ConfirmProvider';
import { HistoryPanel, type ExecutionEntry } from './HistoryPanel';
import { listen } from '@tauri-apps/api/event';
import { Cloud, ScrollText } from 'lucide-react';
import { AwsWorkspace, type AwsCommands } from './aws/AwsWorkspace';
import type { AwsPreset } from './AwsConnection';
import { invoke } from '@tauri-apps/api/core';
import DataWorkbench from './DataWorkbench';
import { MaintenanceDialog } from './MaintenanceDialog';
import type { DataFilter, CopyTarget } from './data-workbench';
import { QueryTools } from './QueryTools';
import { queryOrigin } from './query-origin';
import { appendQueryHistory, isReadOnlySql, sqlTokens, statementAt, type ScriptResult } from './sql-workbench';
import { readProfiles, writeProfiles } from './profile-storage';
import { persistTabs } from './workspace-tabs';
import { ConnectionDialog } from "./ConnectionDialog";
import { Separator } from "@/components/ui/separator";
import { ModalSurface } from "@/components/ModalSurface";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import CodeMirror, { type EditorState } from '@uiw/react-codemirror';
import { sql as sqlLanguage, PostgreSQL, MySQL, SQLite } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { GitBranch, Moon, Sun, PanelLeftClose, PanelLeftOpen, Play } from 'lucide-react';
import { readTheme, saveTheme } from './theme';
import { useLanguage } from './i18n';
import { SettingsDialog } from './SettingsDialog';
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu';
import type { StructurePlan } from './structure';
import { DdlView, ObjectPage } from './ObjectPage';
import { RelationsView } from './RelationsView';
import { createTab, isDirty, useWorkspaceTabs, type TabView, type WorkspaceTab } from './workspace-tabs';
import { AlertTriangle, ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronRight, CircleAlert, CircleHelp, Database, FileCode2, Filter, Info, KeyRound, Layers3, Loader2, Plus, RefreshCw, Search, Settings2, Square, Table2, Terminal, Undo2, X } from 'lucide-react';
import * as api from './api';
import { collectEdits, csv, tableQuery, type Profile, type Table, type Result } from './model';

// Development tests explicitly opt into in-memory fixtures.
const fixtureMode = import.meta.env.DEV && (() => {
  try { return localStorage.getItem('woojoo-test-fixtures') === 'enabled'; }
  catch { return false; }
})();
const initialProfile: Profile = { id: 'demo', name: 'Woojoo playground', engine: 'postgres', host: 'demo.local', port: 5432, database: 'woojoo', username: 'postgres', password: '', tls: true };
type Connection = { profile: Profile; session: string };
const initialTab = createTab('demo', 0, { schema: 'public', name: 'users' }, tableQuery('postgres', 'public', 'users'));
type Notice = { text: string; kind: 'success' | 'info' | 'error' };
// Each rail item is a work area with its own sidebar explorer, tabs and right panel.
type WorkArea = 'database' | 'aws';
const WORK_AREAS: { id: WorkArea; icon: typeof Database; label: [string, string]; title: [string, string] }[] = [
  { id: 'database', icon: Database, label: ['데이터베이스', 'Databases'], title: ['데이터베이스 · 연결과 스키마', 'Databases · connections and schemas'] },
  { id: 'aws', icon: Cloud, label: ['AWS', 'AWS'], title: ['AWS · 로컬 AWS CLI로 리소스 조회', 'AWS · resources through your local AWS CLI'] },
];
const AREA_KEY = 'woojoo-work-area';
const readArea = (): WorkArea => { try { return localStorage.getItem(AREA_KEY) === 'aws' ? 'aws' : 'database'; } catch { return 'database'; } };
const COLLAPSED_KEY = 'woojoo-collapsed-schemas-v1';
function readCollapsed(): Record<string, string[]> {
  try { const value = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}'); return value && typeof value === 'object' ? value : {}; }
  catch { return {}; }
}
const engineLabel = (engine: Profile['engine']) => engine === 'sqlite' ? 'SQLite' : engine === 'postgres' ? 'PostgreSQL' : engine === 'mariadb' ? 'MariaDB' : 'MySQL';
const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'query';
const timeoutHint = (message: string, language: string) => /statement timeout|canceling statement due to statement timeout/i.test(message)
  ? `${message}\n${language === 'ko' ? '쿼리 제한 시간을 넘었습니다. 연결 편집에서 "쿼리 제한 시간"을 늘리거나 0(제한 없음)으로 바꿀 수 있습니다.' : 'The query exceeded the time limit. Raise "Query timeout" in the connection settings, or set it to 0 for no limit.'}`
  : message;
const ErdPage = lazy(() => import('./ErdPage'));

export default function App() {
  const { language, t } = useLanguage();
  const { requestConfirm, confirming } = useConfirm();
  const tr=(ko:string,en:string)=>language==='ko'?ko:en;
  const [theme, setTheme] = useState(readTheme);
  const themeLabel = theme === 'dark' ? t("라이트 모드로 전환") : t("다크 모드로 전환");
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    setTheme(next);
  }
  const [connections, setConnections] = useState<Connection[]>(()=>[{ profile: initialProfile, session: 'demo' },...readProfiles().map(profile=>({profile,session:`saved:${profile.id}`}))]);
  const [active, setActive] = useState(()=>{try{const id=localStorage.getItem('woojoo-active-profile');return id&&readProfiles().some(p=>p.id===id)?`saved:${id}`:readProfiles()[0]?`saved:${readProfiles()[0].id}`:'demo';}catch{return 'demo';}});
  const connection = connections.find(c => c.session === active) ?? connections[0];
  const emptyWorkspace = active === 'demo' && !fixtureMode;
  const connected=!emptyWorkspace&&!active.startsWith('saved:');
  const workspace = useWorkspaceTabs(active, initialTab);
  const { tab } = workspace;
  const [advanced,setAdvanced]=useState<Record<string,boolean>>({});
  const [dataDirty,setDataDirty]=useState<Record<string,boolean>>({});
  const dataDirtyRef=useRef(dataDirty);dataDirtyRef.current=dataDirty;
  const [initialFilters,setInitialFilters]=useState<Record<string,DataFilter[]>>({});
  const [copyTargets,setCopyTargets]=useState<CopyTarget[]>([]);
  const [showMaintenance,setShowMaintenance]=useState(false);
  const [scriptResults,setScriptResults]=useState<Record<string,ScriptResult[]>>({});
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [completionSchema,setCompletionSchema]=useState<Record<string,string[]>>({});
  const [schemaCatalog,setSchemaCatalog]=useState<string[]>([]);
  const [schemaError,setSchemaError]=useState('');
  const [schemaLoading,setSchemaLoading]=useState(false);
  const [showSchemas,setShowSchemas]=useState(false);
  const [schemaFilters,setSchemaFilters]=useState<Record<string,string[]>>(()=>{try{const value=JSON.parse(localStorage.getItem('woojoo-schema-filters-v1')??'{}');return Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string[]]=>Array.isArray(entry[1])&&entry[1].every(x=>typeof x==='string')));}catch{return {};}});
  useEffect(()=>{try{localStorage.setItem('woojoo-schema-filters-v1',JSON.stringify(schemaFilters));}catch{/* Keep session preferences. */}},[schemaFilters]);
  useEffect(()=>{setShowSchemas(false);},[active]);
  useEffect(()=>{let cancelled=false;setSchemaCatalog([]);setSchemaError('');if(!connected){setSchemaLoading(false);return;}setSchemaLoading(true);api.schemas(active).then(value=>{if(!cancelled)setSchemaCatalog(value);}).catch(e=>{if(!cancelled)setSchemaError(String(e));}).finally(()=>{if(!cancelled)setSchemaLoading(false);});return()=>{cancelled=true;};},[active,connected,catalogVersion]);
  const [tableList, setTableList] = useState<Table[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState('');
  const [selected, setSelected] = workspace.field('selected');
  const [editorSql, setEditorSql] = workspace.field('editorSql');
  const [result] = workspace.field('result');
  const setResult = (value: Result) => workspace.patch(tab.id,{result:value,resultStale:false});
  const [source, setSource] = workspace.field('source');
  const editorCollapsed = tab.editorCollapsed ?? (!!advanced[tab.id] && source === 'table');
  const [draft, setDraft] = workspace.field('draft');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = workspace.field('filter');
  const [busy, setBusy] = workspace.field('busy');
  const [error, setError] = workspace.field('error');
  const [notice, setNoticeState] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  function announce(text: string, kind: Notice['kind'] = 'success') {
    window.clearTimeout(noticeTimer.current);
    setNoticeState({ text, kind });
    // Errors stay until dismissed so they cannot be missed.
    if (kind !== 'error') noticeTimer.current = window.setTimeout(() => setNoticeState(null), 4500);
  }
  const announceError = (text: string) => announce(text, 'error');
  const [showConnect, setShowConnect] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const connectDialogRef = useRef(showConnect); connectDialogRef.current = showConnect;
  const [creatingLocal,setCreatingLocal]=useState(false);
  const [localError,setLocalError]=useState('');
  const localCreation=useRef(false);
  const [editProfile,setEditProfile]=useState<Profile|undefined>();
  const [showReview, setShowReview] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommonSql, setShowCommonSql] = useState(false);
  const [contextMenu, setContextMenu] = useState<MenuState | null>(null);
  // The rail picks a work area and the sidebar shows that area's explorer.
  const [area, setArea] = useState<WorkArea>(readArea);
  const areaRef = useRef(area); areaRef.current = area;
  useEffect(() => { try { localStorage.setItem(AREA_KEY, area); } catch { /* Session-only preference. */ } }, [area]);
  // The AWS area mounts on its first visit and then stays mounted, hidden, to keep its tabs.
  const [awsVisited, setAwsVisited] = useState(area === 'aws');
  useEffect(() => { if (area === 'aws') setAwsVisited(true); }, [area]);
  const awsCommands = useRef<AwsCommands>({});
  const [awsPreset, setAwsPreset] = useState<AwsPreset>();
  // Query history sits in a right-hand panel beside the database workspace.
  const [historyOpen, setHistoryOpen] = useState(() => { try { return localStorage.getItem('woojoo-history-panel') === 'open'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('woojoo-history-panel', historyOpen ? 'open' : 'closed'); } catch { /* Session-only preference. */ } }, [historyOpen]);
  const [renaming, setRenaming] = useState<{id:string;name:string}|null>(null);
  const [tabDrop, setTabDrop] = useState<{id:string;after:boolean}|null>(null);
  const tabDrag = useRef<{id:string;x:number;y:number;moving:boolean;target?:{id:string;after:boolean}}|null>(null);
  const suppressTabClick = useRef(false);
  function dragTab(event: React.PointerEvent<HTMLElement>) {
    const drag = tabDrag.current;
    if (!drag) return;
    if (!drag.moving && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6) return;
    drag.moving=true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const list=event.currentTarget.closest('.tab-list');
    if (list) {const rect=list.getBoundingClientRect();if(event.clientX<rect.left+28)list.scrollLeft-=16;else if(event.clientX>rect.right-28)list.scrollLeft+=16;}
    const element=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-workspace-tab]');
    const id=element?.dataset.workspaceTab;
    const target=element&&id&&id!==drag.id?{id,after:event.clientX>element.getBoundingClientRect().left+element.getBoundingClientRect().width/2}:undefined;
    drag.target=target;setTabDrop(target??null);
  }
  function finishTabDrag(event: React.PointerEvent<HTMLElement>,cancel=false) {
    const drag=tabDrag.current;
    if (drag?.moving) {suppressTabClick.current=true;if(!cancel&&drag.target)workspace.reorder(drag.id,drag.target.id,drag.target.after);}
    tabDrag.current=null;setTabDrop(null);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  useEffect(()=>{if(!api.desktop)return;const subscription=listen<string>("execution-log-error",event=>announceError(event.payload)).catch(()=>()=>{});return()=>{void subscription.then(unlisten=>unlisten()).catch(()=>{});};},[]);
  const [scroll, setScroll] = workspace.field('scroll');
  const [sort, setSort] = workspace.field('sort');
  const [editing, setEditing] = useState<{ index: number; col: string; value: string; isNull: boolean } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => { try { return localStorage.getItem('woojoo-sidebar') !== 'closed'; } catch { return true; } });
  function toggleSidebar() { setSidebarOpen(open => !open); }
  // Clicking the active rail item collapses the sidebar, like an activity bar.
  function showArea(next: WorkArea) {
    if (sidebarOpen && area === next) { setSidebarOpen(false); return; }
    setArea(next); setSidebarOpen(true);
  }
  useEffect(() => { try { localStorage.setItem('woojoo-sidebar', sidebarOpen ? 'open' : 'closed'); } catch { /* Session-only preference. */ } }, [sidebarOpen]);

  const [collapsedByProfile, setCollapsedByProfile] = useState(readCollapsed);
  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsedByProfile)); } catch { /* Session-only preference. */ } }, [collapsedByProfile]);
  const collapsedSchemas = new Set(collapsedByProfile[connection.profile.id] ?? []);
  function toggleSchema(schema: string) {
    setCollapsedByProfile(previous => {
      const current = new Set(previous[connection.profile.id] ?? []);
      if (current.has(schema)) current.delete(schema); else current.add(schema);
      return { ...previous, [connection.profile.id]: [...current] };
    });
  }
  const hasDialog = showSchemas || !!renaming || confirming || showMaintenance || showConnect || showReview || showHelp || showSettings || showCommonSql || !!editing;
  useEffect(() => { setShowCommonSql(false); }, [active]);
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
  const canEdit = !tab.resultStale && !connection.profile.readOnly && (source === 'table'||!!tab.queryTable) && result.columns.some(c => c.primary);
  const runRef = useRef<() => void>(() => {});
  const queryCommands = useRef<{ save?: () => void; runScript?: () => void; cancel?: () => void }>({});
  const shortcutRef = useRef({ newTab: () => {}, closeTab: () => {}, refresh: () => {}, stop: () => {} });
  const production = connection.profile.environment === 'production';
  // Unqualified SQL in a table tab runs in that table's schema; query tabs use their chosen schema.
  function executionSchema() { return tab.querySchema ?? (tab.kind === 'table' ? tab.selected?.schema : undefined); }
  const lastSchema = useRef(new Map<string, string>());
  async function confirmSchemaSwitch(schema?: string) {
    const key = schema ?? '', previous = lastSchema.current.get(active);
    if (api.desktop && previous !== undefined && previous !== key) {
      try {
        const state = await invoke<{ inTransaction: boolean }>('execution_state', { id: active });
        if (state.inTransaction && !await requestConfirm(tr(`진행 중인 트랜잭션 안에서 스키마가 "${previous || '기본'}"에서 "${key || '기본'}"(으)로 바뀝니다. 같은 트랜잭션에서 계속 실행할까요?`, `The open transaction switches schema from "${previous || 'default'}" to "${key || 'default'}". Keep running in the same transaction?`), { title: tr('스키마 전환 확인', 'Switch schema') })) return false;
      } catch { /* A closed session has no transaction to protect. */ }
    }
    lastSchema.current.set(active, key);
    return true;
  }
  async function confirmProduction(sql: string, schema?: string) {
    if (!production || connection.profile.readOnly || isReadOnlySql(sql, connection.profile.engine)) return true;
    const target = schema ? ` · ${schema}` : '';
    return requestConfirm(tr(`운영(PRODUCTION) 연결 "${connection.profile.name}${target}"에서 데이터나 구조를 바꿀 수 있는 SQL을 실행합니다. 계속할까요?`, `This SQL may change data or structure on the PRODUCTION connection "${connection.profile.name}${target}". Continue?`), { title: tr('운영 DB 실행 확인','Run on production'), confirmLabel: tr('운영 DB에서 실행','Run on production'), destructive: true });
  }
  const allTabsRef = useRef(workspace.tabs); allTabsRef.current = workspace.tabs;
  const discardOptions = { title: tr('변경 사항 버리기','Discard changes'), confirmLabel: t('버리기'), destructive: true };
  const askDiscard = async () => !Object.keys(draftRef.current).length || await requestConfirm(t("저장하지 않은 변경 사항을 버릴까요?") + ' ' + t('변경 대기', {count: collectEdits(result.rows, draftRef.current).length}), discardOptions);
  useEffect(()=>{try{writeProfiles(connections.filter(c=>c.session!=='demo').map(c=>c.profile));localStorage.setItem('woojoo-active-profile',connection.profile.id);}catch{announceError(tr('저장 공간이 부족해 프로필을 저장하지 못했습니다.','Could not save profiles: storage unavailable.'));}},[connections,active]);
  useEffect(()=>{const timer=setTimeout(()=>{try{persistTabs(workspace.tabs,Object.fromEntries(connections.map(c=>[c.session,c.profile.id])),tab.id);}catch{announceError(tr('작업 공간을 저장하지 못했습니다.','Could not save workspace.'));}},250);return()=>clearTimeout(timer);},[workspace.tabs,connections,tab.id]);
  async function confirmDisconnect(session:string){if(session==='demo'||session.startsWith('saved:'))return true;try{const state=await invoke<{inTransaction:boolean;transactionStateKnown?:boolean}>('execution_state',{id:session});if(state.inTransaction||state.transactionStateKnown===false)return await requestConfirm(tr('진행 중이거나 상태를 확인할 수 없는 트랜잭션이 있습니다. 커밋하지 않은 변경을 롤백하고 연결을 끊을까요?','A transaction is active or its state is unknown. Disconnect and roll back uncommitted changes?'),{title:tr('트랜잭션 롤백','Roll back transaction'),confirmLabel:tr('롤백하고 끊기','Roll back and disconnect'),destructive:true});}catch{/* Disconnected sessions have no usable transaction. */}return true;}
  async function disconnectProfile(c:Connection){
    if(allTabsRef.current.some(tab=>tab.session===c.session&&tab.busy))return;
    if(allTabsRef.current.some(tab=>tab.session===c.session&&(Object.keys(tab.draft).length||dataDirtyRef.current[tab.id]))&&!await requestConfirm(tr('저장하지 않은 데이터 변경을 버리고 연결을 끊을까요?','Discard pending data edits and disconnect?'),discardOptions))return;
    if(!await confirmDisconnect(c.session))return;
    try{await api.disconnect(c.session);const session='saved:'+c.profile.id;workspace.remapSession(c.session,session);setConnections(list=>list.map(item=>item===c?{...c,session}:item));if(active===c.session)setActive(session);}catch(e){announceError(String(e));}
  }
  async function deleteProfile(c:Connection){
    if(allTabsRef.current.some(tab=>tab.session===c.session&&tab.busy))return;
    if(!await requestConfirm(tr('연결 프로필과 저장된 SQL 탭을 삭제할까요?','Delete this connection profile and its saved SQL tabs?'),{title:tr('프로필 삭제','Delete profile'),confirmLabel:t('삭제'),destructive:true}))return;
    if(!await confirmDisconnect(c.session))return;
    try{if(!c.session.startsWith('saved:'))await api.disconnect(c.session);await api.forgetPassword(c.profile.id);workspace.removeSession(c.session);setConnections(list=>list.filter(item=>item!==c));if(active===c.session)setActive('demo');}catch(e){announceError(String(e));}
  }
  async function leaveData(){if(advanced[tab.id]&&tab.busy)return false;if(!dataDirtyRef.current[tab.id])return true;if(!await requestConfirm(tr('저장하지 않은 데이터 변경을 버릴까요?','Discard pending data edits?'),discardOptions))return false;return true;}
  async function selectConnection(id:string){if(id!==active&&!await leaveData())return;setActive(id);}
  async function openExecution(entry:Pick<ExecutionEntry,'sql'|'profileId'>){const target=connections.find(c=>c.profile.id===entry.profileId);if(!target||!await leaveData())return;workspace.add(null,entry.sql,target.session);setActive(target.session);editorSelection.current="";}
  async function saveProfile(profile:Profile){
    if(!await leaveData())return;
    const old=connections.find(c=>c.profile.id===profile.id);
    if(old&&!old.session.startsWith('saved:')){announce(tr('연결 중인 프로필은 먼저 연결을 끊은 후 수정하세요.','Disconnect before editing an active profile.'),'info');return;}
    if(!profile.rememberPassword&&old?.profile.rememberPassword)await api.forgetPassword(profile.id);
    const entry={profile:{...profile,password:''},session:'saved:'+profile.id};
    setConnections(list=>old?list.map(c=>c===old?entry:c):[...list,entry]);setActive(entry.session);setShowConnect(false);setEditProfile(undefined);
  }
  async function createLocalDatabase(){
    if(!api.desktop||localCreation.current)return;
    localCreation.current=true;setCreatingLocal(true);setLocalError('');
    try {
      const path=await invoke<string>('create_local_database');
      const profile:Profile={id:'local-sqlite',name:'Local SQLite',engine:'sqlite',host:'',port:0,database:path,username:'',password:'',tls:false,environment:'development',readOnly:false};
      const session=await api.connect(profile);
      await acceptConnection(profile,session);
    }catch(error){setLocalError(String(error));}
    finally{localCreation.current=false;setCreatingLocal(false);}
  }
  async function acceptConnection(profile:Profile,session:string){
    const old=connections.find(c=>c.profile.id===profile.id);
    try{
      if(!await leaveData())throw new Error(tr('다시 연결이 취소되었습니다.','Reconnection cancelled.'));
      if(old){
        const tabs=allTabsRef.current.filter(tab=>tab.session===old.session);
        if(tabs.some(tab=>tab.busy))throw new Error(tr('진행 중인 작업을 완료한 후 다시 연결하세요.','Wait for running operations before reconnecting.'));
        if(tabs.some(tab=>Object.keys(tab.draft).length||dataDirtyRef.current[tab.id])&&!await requestConfirm(tr('저장하지 않은 데이터 변경을 버리고 다시 연결할까요?','Discard pending data edits and reconnect?'),discardOptions))throw new Error(tr('다시 연결이 취소되었습니다.','Reconnection cancelled.'));
        if(!old.session.startsWith('saved:')){if(!await confirmDisconnect(old.session))throw new Error(tr('다시 연결이 취소되었습니다.','Reconnection cancelled.'));await api.disconnect(old.session);}workspace.remapSession(old.session,session);
      }
      setConnections(list=>[...list.filter(c=>c.profile.id!==profile.id),{profile:{...profile,password:''},session}]);setActive(session);setShowConnect(false);setEditProfile(undefined);
    }catch(e){await api.disconnect(session).catch(()=>{});throw e;}
  }
  function passwordForgotten(id:string){
    setConnections(list=>list.map(c=>c.profile.id===id?{...c,profile:{...c.profile,password:'',rememberPassword:false}}:c));
  }
  async function reconnectProfile(profile:Profile){
    if(reconnecting)return;
    setReconnecting(true);
    try{
      const status=await api.credentialStatus(profile);
      if(status?.available){const session=await api.connect({...profile,password:''});await acceptConnection(profile,session);}
      else{setEditProfile(profile);setShowConnect(true);}
    }catch(e){announceError(tr('다시 연결하지 못했습니다. 비밀번호를 확인하세요. ','Could not reconnect. Check your password. ')+String(e));setEditProfile(profile);setShowConnect(true);}
    finally{setReconnecting(false);}
  }
  useEffect(()=>{
    // Restore only the initially selected saved profile, once per mount. Cleanup
    // prevents StrictMode or navigation from accepting an obsolete connection.
    if(!api.desktop||!active.startsWith('saved:')||!connection.profile.rememberPassword||connection.profile.engine==='sqlite')return;
    let cancelled=false;
    const profile=connection.profile, savedSession=active;
    const current=()=>!cancelled&&activeSessionRef.current===savedSession&&!connectDialogRef.current;
    setReconnecting(true);
    void (async()=>{
      try{
        const status=await api.credentialStatus(profile);
        if(!current())return;
        if(!status?.saved)throw new Error(tr('저장된 비밀번호가 없습니다.','No saved password is available.'));
        const session=await api.connect({...profile,password:''});
        if(!current()){await api.disconnect(session);return;}
        await acceptConnection(profile,session);
      }catch(e){if(current()){announceError(tr('자동 연결하지 못했습니다. 비밀번호를 확인하고 다시 연결하세요. ','Automatic connection failed. Check your password and reconnect. ')+String(e));setEditProfile(profile);setShowConnect(true);}}
      finally{if(!cancelled)setReconnecting(false);}
    })();
    return()=>{cancelled=true;};
  },[]);
  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); announce(t('복사됨')); }
    catch { announceError(t('클립보드에 복사하지 못했습니다.')); }
  }
  async function performFor(id: string, action: () => Promise<void>) {
    if (pending.current.has(id)) return;
    pending.current.add(id); workspace.patch(id, { busy: true, error: '' });
    try { await action(); } catch (e) { workspace.patch(id, { error: String(e), resultStale: true }); }
    finally { pending.current.delete(id); workspace.patch(id, { busy: false }); }
  }
  const perform = (action: () => Promise<void>) => performFor(tab.id, action);
  function tabName(item: WorkspaceTab) {
    if(item.customName) return item.customName;
    if(item.kind==='query'&&item.file) return item.file.name;
    if (item.kind === 'schema') return item.objectSchema;
    if (item.kind === 'history') return tr('쿼리 기록', 'Query history');
    return item.kind === 'table' ? item.selected?.name ?? t('탐색기') : t('쿼리 번호', {number:item.number});
  }
  function tabMenu(item: WorkspaceTab): MenuItem[] {
    const tabs = workspace.connectionTabs;
    const index = tabs.findIndex(candidate => candidate.id === item.id);
    const group = (label: string, targets: WorkspaceTab[]): MenuItem => ({
      label, action: () => closeTabs(targets),
      disabled: !targets.length || targets.some(target => target.busy || pending.current.has(target.id)),
    });
    return [
      {label:t('새 쿼리'),action:()=>addQuery()},
      {label:t('SQL 복제'),action:()=>addQuery(item.editorSql),disabled:!item.editorSql},
      {label:tr('탭 이름 변경','Rename tab'),action:()=>setRenaming({id:item.id,name:tabName(item)})},
      {label:t('탭 닫기'),action:()=>closeTab(item),disabled:item.busy,divider:true},
      group(tr('모든 탭 닫기', 'Close all tabs'), tabs),
      group(tr('다른 탭 닫기', 'Close other tabs'), tabs.filter(candidate => candidate.id !== item.id)),
      group(tr('오른쪽 탭 닫기', 'Close tabs to the right'), tabs.slice(index + 1)),
      group(tr('왼쪽 탭 닫기', 'Close tabs to the left'), tabs.slice(0, index)),
    ];
  }
  async function activateTab(id: string) { if(id!==tab.id&&!await leaveData())return; editorSelection.current = ''; setEditing(null); setShowReview(false); workspace.activate(id);  return true; }
  async function navigateTabs(event: React.KeyboardEvent<HTMLButtonElement>, id: string) {
    const items = workspace.connectionTabs, index = items.findIndex(item => item.id === id);
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault(); if (!await activateTab(items[next].id)) return; document.getElementById(`tab-${items[next].id}`)?.focus();
  }
  useEffect(() => { document.getElementById(`tab-${tab.id}`)?.scrollIntoView({block:'nearest', inline:'nearest'}); }, [tab.id]);
  async function addQuery(sql = '', schema?: string) { if(emptyWorkspace)return;if(!await leaveData())return;editorSelection.current = ''; const next=workspace.add(null, sql); if(schema)workspace.patch(next.id,{querySchema:schema});  }
  async function closeTab(item: WorkspaceTab) {
    if (item.busy || pending.current.has(item.id)) return;
    if ((isDirty(item)||dataDirty[item.id])) {
      const edits = collectEdits(item.result.rows, item.draft).length;
      const erd = item.erd?.pending?.length ?? 0;
      const items = [item.editorSql !== item.initialSql ? tr('편집 중인 SQL','edited SQL') : '', edits ? t('변경 대기', {count: edits}) : '', erd ? tr(`ERD 변경 ${erd}개`,`${erd} ERD changes`) : '', dataDirty[item.id] ? tr('데이터 도구 변경','data tool edits') : ''].filter(Boolean);
      if (!await requestConfirm(items.length ? t('탭 닫기 상세', {items: items.join(', ')}) : t('탭 닫기 확인'), {title: t('탭 닫기'), confirmLabel: t('버리고 닫기'), destructive: true})) return;
    }
    editorSelection.current = ''; editorStates.current.delete(item.id); workspace.close(item.id);
  }
  async function closeTabs(items: WorkspaceTab[]) {
    if (!items.length || items.some(item => item.busy || pending.current.has(item.id))) return;
    if (items.some(item => isDirty(item) || dataDirty[item.id]) && !await requestConfirm(tr(
      `${items.length}개 탭을 닫을까요? 저장하지 않은 SQL과 변경 사항은 사라집니다.`,
      `Close ${items.length} tabs? Unsaved SQL and changes will be discarded.`,
    ), {title: tr('탭 닫기','Close tabs'), confirmLabel: t('버리고 닫기'), destructive: true})) return;
    if (items.some(item => pending.current.has(item.id))) return;
    editorSelection.current = '';
    items.forEach(item => editorStates.current.delete(item.id));
    workspace.closeMany(items.map(item => item.id));
  }
  const tableTab = (table: Table) => workspace.connectionTabs.find(item => item.kind === 'table' && item.selected?.name === table.name && item.selected.schema === table.schema);
  const schemaTab = (schema: string) => workspace.connectionTabs.find(item => item.kind === 'schema' && item.objectSchema === schema);
  function setView(id: string, view: TabView) { workspace.patch(id, { view }); }
  /** Sidebar and relation links: reuse the table's tab with its last view, otherwise open its data. */
  async function openObject(table: Table, view?: TabView) {
    const existing = tableTab(table);
    if (existing) { if (await activateTab(existing.id) && view) setView(existing.id, view); return; }
    if (view && view !== 'data') { if (!await leaveData()) return; const next = workspace.add(table, tableQuery(connection.profile.engine, table.schema, table.name)); workspace.patch(next.id, { view }); return; }
    await openTable(table);
  }
  async function openTable(table: Table, refresh = false) {
    const existing = tableTab(table);
    if (!refresh && existing) { if (await activateTab(existing.id)) setView(existing.id, 'data'); return; }
    if (refresh && !await askDiscard()) return;
    if(!refresh&&!await leaveData())return;

    const target = refresh ? tab : workspace.add(table, tableQuery(connection.profile.engine, table.schema, table.name));
    await performFor(target.id, async () => {
      const data = await api.readTable(active, table);
      const sql = tableQuery(connection.profile.engine, table.schema, table.name);
      workspace.patch(target.id, { selected: table, source: 'table', view: 'data', result: data, resultStale:false, draft: {}, filter: '', sort: null, scroll: 0, editorSql: sql, initialSql: sql, loaded: true, lastQuery: '' });
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
      if(item.kind === 'schema') workspace.patch(item.id,{erd:null});
      if(item.selected?.schema !== change.table.schema || item.selected.name !== change.table.name) continue;
      if(change.kind === 'dropTable') {
        workspace.patch(item.id,{kind:'schema',view:'objects',objectSchema:change.table.schema,selected:null,details:[],result:{columns:[],rows:[],elapsedMs:0,affected:0,truncated:false},draft:{},filter:'',error:''});
      } else if(item.kind === 'table') {
        const sql = tableQuery(connection.profile.engine,renamed.schema,renamed.name);
        workspace.patch(item.id,{selected:renamed,objectSchema:renamed.schema,details:item.details.length?await api.describeTable(session,renamed):[],resultStale:false,result:await api.readTable(session,renamed),draft:{},sort:null,filter:'',scroll:0,error:'',...(item.editorSql===item.initialSql?{editorSql:sql,initialSql:sql}:{})});
      }
    }
  }
  async function openSchema(schema: string, view?: TabView) {
    const existing = schemaTab(schema);
    if (existing) { if (await activateTab(existing.id) && view) setView(existing.id, view); return; }
    if(!await leaveData())return;
    const next = workspace.add();
    workspace.patch(next.id, { kind: 'schema', view: view ?? 'objects', objectSchema: schema, loaded: true });
  }
  const openErd = (schema: string) => openSchema(schema, 'erd');
  // Each connection keeps at most one full history tab.
  async function openHistory() {
    const existing = workspace.connectionTabs.find(item => item.kind === 'history');
    if (existing) { await activateTab(existing.id); return; }
    if(!await leaveData())return;
    const next = workspace.add();
    workspace.patch(next.id, { kind: 'history', loaded: true });
  }
  async function openDetails(table: Table, refresh = false) {
    const existing = tableTab(table);
    if (existing && !refresh && existing.details.length) { if (await activateTab(existing.id)) setView(existing.id, 'structure'); return; }
    if(!existing&&!await leaveData())return;
    const next = existing ?? workspace.add(table, tableQuery(connection.profile.engine, table.schema, table.name));
    if(existing && existing.id !== tab.id && !await activateTab(next.id))return;
    workspace.patch(next.id, { view: 'structure', objectSchema: table.schema });
    await performFor(next.id, async () => {
      const details = await api.describeTable(active, table);
      workspace.patch(next.id, { details });
    });
  }
  function tableMenu(table: Table): MenuItem[] {
    return [
      { label: t('데이터 보기'), action: () => void openTable(table) },
      { label: tr('구조 보기','View structure'), action: () => void openDetails(table) },
      { label: tr('관계 보기','View relations'), action: () => void openObject(table, 'relations') },
      { label: t('ERD 열기'), action: () => void openErd(table.schema) },
      { label: t('SELECT 쿼리 열기'), action: () => addQuery(tableQuery(connection.profile.engine, table.schema, table.name), table.schema) },
      { label: t('테이블 이름 복사'), action: () => void copyText(`${table.schema}.${table.name}`), divider: true },
    ];
  }
  useEffect(() => {
    const token = ++op.current;
    setSearch('');
    editorSelection.current = '';
    setTablesError('');
    if(!connected){setTableList([]);setTablesLoading(false);setBusy(false);return;}
    busyRef.current = true; setBusy(true); setTablesLoading(true);
    setTableList([]);
    api.tables(active).then(async list => {
      if (token !== op.current) return;
      setTableList(list);
      if(list.length&&!workspace.connectionTabs.length){const table=list[0],sql=tableQuery(connection.profile.engine,table.schema,table.name);workspace.patch(tab.id,{kind:'table',selected:table,source:'table',objectSchema:table.schema,editorSql:sql,initialSql:sql,loaded:false});}

    }).catch(e => { if (token === op.current) setTablesError(String(e)); })
      .finally(() => { if (token === op.current) setTablesLoading(false); if (!pending.current.has(tab.id)) setBusy(false); });
    return () => { op.current++; };
  }, [active]);
  useEffect(()=>{let cancelled=false;void Promise.all(connections.filter(c=>(fixtureMode||c.session!=='demo')&&!c.session.startsWith('saved:')&&!c.profile.readOnly).map(async c=>(await api.tables(c.session)).map(table=>({session:c.session,engine:c.profile.engine,label:c.profile.name+' / '+table.schema+'.'+table.name,table})))).then(lists=>{if(!cancelled)setCopyTargets(lists.flat());}).catch(()=>{if(!cancelled)setCopyTargets([]);});return()=>{cancelled=true;};},[connections,catalogVersion]);
  useEffect(()=>{if(connected&&tab.kind==='table'&&(tab.view??'data')==='data'&&tab.selected&&!tab.loaded&&!pending.current.has(tab.id)){void performFor(tab.id,async()=>{workspace.patch(tab.id,{resultStale:false,result:await api.readTable(active,tab.selected!),loaded:true});});}},[active,tab.id,tab.loaded,tab.kind,tab.view,tab.selected?.name,tab.selected?.schema]);
  useEffect(()=>{if(connected&&tab.kind==='table'&&tab.view==='structure'&&tab.selected&&!tab.details.length&&!pending.current.has(tab.id)){void performFor(tab.id,async()=>{workspace.patch(tab.id,{details:await api.describeTable(active,tab.selected!)});});}},[active,tab.id,tab.view,tab.details.length]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (confirming || renaming) return;
      if (showSettings) {
        if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key === ',')) event.preventDefault();
        if (event.key === 'Escape') setShowSettings(false);
        return;
      }
      if (showConnect || showReview || showHelp || editing) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.preventDefault();
        if (event.key === 'Escape' && !busyRef.current) {
          setEditing(null); setShowReview(false); setShowHelp(false);
        }
        return;
      }
      const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
      if (areaRef.current === 'aws') {
        // SQL shortcuts belong to the database area; AWS tabs only refresh, close and toggle panels.
        if (mod && event.key === ',') { event.preventDefault(); setShowSettings(true); }
        else if (mod && event.altKey && key === 'b') { event.preventDefault(); awsCommands.current.togglePanel?.(); }
        else if (mod && key === 'b') { event.preventDefault(); toggleSidebar(); }
        else if (mod && key === 'w') { event.preventDefault(); awsCommands.current.closeTab?.(); }
        else if (event.key === 'F5') { event.preventDefault(); awsCommands.current.refresh?.(); }
        else if (event.key === 'Escape') setShowHelp(false);
        return;
      }
      if (mod && event.key === ',') { event.preventDefault(); setShowSettings(true); }
      else if (mod && event.altKey && key === 'b') { event.preventDefault(); setHistoryOpen(open => !open); }
      else if (mod && key === 'b') { event.preventDefault(); toggleSidebar(); }
      else if (mod && event.shiftKey && event.key === 'Enter') { event.preventDefault(); queryCommands.current.runScript?.(); }
      else if (mod && event.key === 'Enter') { event.preventDefault(); runRef.current(); }
      else if (mod && key === 't') { event.preventDefault(); shortcutRef.current.newTab(); }
      else if (mod && key === 'w') { event.preventDefault(); shortcutRef.current.closeTab(); }
      else if (mod && key === 's') { event.preventDefault(); queryCommands.current.save?.(); }
      else if (event.key === 'F5') { event.preventDefault(); shortcutRef.current.refresh(); }
      else if (event.key === 'Escape') { if (busyRef.current) shortcutRef.current.stop(); setEditing(null); setShowHelp(false); }
    };
    const leave = (event: BeforeUnloadEvent) => { if (allTabsRef.current.some(isDirty)||Object.values(dataDirty).some(Boolean)) event.preventDefault(); };
    window.addEventListener('keydown', key); window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', leave); };
  }, [confirming, renaming, showConnect, showReview, showHelp, showSettings, editing,dataDirty]);
  // Unsaved SQL text is restored from the workspace on restart; pending row edits and open transactions are not.
  const liveSessions = connections.filter(c => c.session !== 'demo' && !c.session.startsWith('saved:'));
  const closeGuard = workspace.tabs.some(item => Object.keys(item.draft).length > 0) || Object.values(dataDirty).some(Boolean) || liveSessions.length > 0;
  // Guard closing only while the UI can actually receive the close request; otherwise the window must close normally.
  const [closeListener, setCloseListener] = useState(false);
  useEffect(() => { if (api.desktop) void invoke('set_close_guard', { enabled: closeGuard && closeListener }).catch(() => {}); }, [closeGuard, closeListener]);
  const appCloseRef = useRef(async () => {});
  appCloseRef.current = async () => {
    try { persistTabs(allTabsRef.current, Object.fromEntries(connections.map(c => [c.session, c.profile.id])), tab.id); } catch { /* Closing must not depend on storage. */ }
    const edits = allTabsRef.current.reduce((sum, item) => sum + collectEdits(item.result.rows, item.draft).length, 0);
    const dataTabs = allTabsRef.current.filter(item => dataDirtyRef.current[item.id]).length;
    let transactions = 0;
    for (const c of liveSessions) {
      try { const state = await invoke<{ inTransaction: boolean; transactionStateKnown?: boolean }>('execution_state', { id: c.session }); if (state.inTransaction || state.transactionStateKnown === false) transactions++; }
      catch { /* A closed session has nothing to roll back. */ }
    }
    const items = [edits ? t('변경 대기', { count: edits }) : '', dataTabs ? tr(`데이터 도구 변경 탭 ${dataTabs}개`, `${dataTabs} tabs with data tool edits`) : '', transactions ? tr(`커밋하지 않은 트랜잭션 ${transactions}개(롤백됨)`, `${transactions} uncommitted transactions (rolled back)`) : ''].filter(Boolean);
    if (items.length && !await requestConfirm(tr(`종료하면 다음 내용이 사라집니다: ${items.join(', ')}. 앱을 닫을까요?`, `Closing discards: ${items.join(', ')}. Close the app?`), { title: tr('앱 닫기', 'Close app'), confirmLabel: tr('버리고 닫기', 'Discard and close'), destructive: true })) return;
    await invoke('close_window').catch(e => { void invoke('set_close_guard', { enabled: false }).catch(() => {}); announceError(tr('창을 닫지 못했습니다. 다시 닫아 보세요. ','Could not close the window. Try again. ') + String(e)); });
  };
  useEffect(() => {
    if (!api.desktop) return;
    const subscription = listen('close-requested', () => void appCloseRef.current()).then(unlisten => { setCloseListener(true); return unlisten; }).catch(() => { setCloseListener(false); return () => {}; });
    return () => { setCloseListener(false); void invoke('set_close_guard', { enabled: false }).catch(() => {}); void subscription.then(unlisten => unlisten()).catch(() => {}); };
  }, []);
  const busyStarted = useRef(new Map<string, number>());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) { busyStarted.current.delete(tab.id); setElapsed(0); return; }
    if (!busyStarted.current.has(tab.id)) busyStarted.current.set(tab.id, Date.now());
    const tick = () => setElapsed(Date.now() - (busyStarted.current.get(tab.id) ?? Date.now()));
    tick(); const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [busy, tab.id]);
  const canStop = busy && api.desktop && connected && active !== 'demo';
  function stopQuery() { if (canStop) queryCommands.current.cancel?.(); }
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = scroll;
  }, [tab.id, scroll]);
  const executeQuery = async (text: string) => {
    if(!connected){setEditProfile(emptyWorkspace?undefined:connection.profile);setShowConnect(true);return;}
    const runSchema = executionSchema();
    if (pending.current.has(tab.id) || !await askDiscard() || !text || !await leaveData() || !await confirmProduction(text, runSchema) || !await confirmSchemaSwitch(runSchema)) return;
    let objectScript=false;
    if(api.desktop&&(connection.profile.engine==='mysql'||connection.profile.engine==='mariadb')){try{const code=sqlTokens(text,connection.profile.engine).filter(token=>token.kind==='code').map(token=>token.text).join(' ').trimStart().slice(0,400);objectScript=/^CREATE\b[\s\S]*\b(PROCEDURE|FUNCTION|TRIGGER|VIEW|EVENT)\b/i.test(code);}catch{/* The normal execution path reports syntax errors. */}}
    if(objectScript&&!await requestConfirm(tr('객체 정의를 서버 SQL 스크립트로 실행합니다. 편집기의 전체 SQL이 실행되며 MySQL DDL은 암묵적으로 커밋됩니다. 계속할까요?','Execute this object definition as a server SQL script? The entire editor input will run and MySQL DDL commits implicitly.')))return;
    if (pending.current.has(tab.id)) return;
    void perform(async () => {
      const start=performance.now();let data:Result;try{data=objectScript?await invoke<Result>('run_object_sql',{id:active,sql:text,schema:runSchema??null}):await api.query(active,text,runSchema);}catch(e){appendQueryHistory({id:crypto.randomUUID(),sql:text,engine:connection.profile.engine,at:new Date().toISOString(),success:false,count:1,connection:connection.profile.id,connectionName:connection.profile.name,duration:performance.now()-start,durationScope:'total'});throw new Error(timeoutHint(String(e),language));}
      appendQueryHistory({id:crypto.randomUUID(),sql:text,engine:connection.profile.engine,at:new Date().toISOString(),success:true,count:1,connection:connection.profile.id,connectionName:connection.profile.name,duration:data.elapsedMs,durationScope:'db'});
      const origin=queryOrigin(text,tableList);
      if(origin){try{const metadata=await api.describeTable(active,origin);if(metadata.filter(c=>c.primary).every(c=>data.columns.some(col=>col.name===c.name)))data={...data,columns:data.columns.map(col=>({...col,...metadata.find(c=>c.name===col.name)}))};else workspace.patch(tab.id,{queryTable:null});}catch{workspace.patch(tab.id,{queryTable:null});}}
      workspace.patch(tab.id,{queryTable:origin,querySchema:runSchema});
      workspace.markQuery(tab.id);
      setLastQuery(text);
      setResult(data); setSource('query'); setDraft({}); setFilter(''); setSort(null); setScroll(0);
    });
  };
  // Without a selection, run only the statement under the cursor so multi-statement editors stay usable.
  function cursorStatement() {
    const state = editorStates.current.get(tab.id);
    if (!state || state.doc.toString() !== editorSql) return editorSql.trim();
    // MySQL routine bodies contain unquoted semicolons and must run as one script.
    if ((connection.profile.engine === 'mysql' || connection.profile.engine === 'mariadb') && /\bCREATE\b[\s\S]*\b(PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i.test(editorSql)) return editorSql.trim();
    try { return statementAt(editorSql, connection.profile.engine, state.selection.main.head) || editorSql.trim(); }
    catch { return editorSql.trim(); }
  }
  const run = () => { if (workspace.connectionTabs.length && (tab.kind === 'table' || tab.kind === 'query')) executeQuery(editorSelection.current.trim() || cursorStatement()); };
  runRef.current = run;
  shortcutRef.current = {
    newTab: () => void addQuery(),
    closeTab: () => { if (workspace.connectionTabs.some(item => item.id === tab.id)) void closeTab(tab); },
    refresh: () => { if (tab.kind === 'table' && tab.view === 'structure' && tab.selected) void openDetails(tab.selected, true); else if (tab.kind === 'query' || tab.kind === 'table' && (tab.view ?? 'data') === 'data') void refreshResults(); else void refreshTables(); },
    stop: stopQuery,
  };
  async function applyChanges() {
    const target=source==='query'?tab.queryTable:selected;
    if (!target) return;
    await perform(async () => {
      const count = await api.save(active, target, edits);
      setDraft({}); setShowReview(false);
      announce(t('변경 적용됨', {count}) + (active === 'demo' ? ' · ' + t('데모 저장 안내') : ''));
      const refreshed=source==='query'?await api.query(active,lastQuery,executionSchema()):await api.readTable(active,target);setResult(source==='query'?{...refreshed,columns:result.columns}:refreshed);
    });
  }
  async function exportCsv() {
    if (result.truncated && !await requestConfirm(tr(
      `\uacb0\uacfc\uac00 ${result.rows.length}\ud589\uc5d0\uc11c \uc798\ub838\uc2b5\ub2c8\ub2e4. \ubd88\ub7ec\uc628 ${result.rows.length}\ud589\ub9cc \uc800\uc7a5\ud560\uae4c\uc694? \uc804\uccb4 \ud589\uc774 \ud544\uc694\ud558\uba74 ${source === 'table' ? '\ub370\uc774\ud130 \ub3c4\uad6c\uc758 "\uc804\uccb4 \ub0b4\ubcf4\ub0b4\uae30"' : 'LIMIT/OFFSET\uc73c\ub85c \ub098\ub220 \uc2e4\ud589\ud558\uac70\ub098 \ud14c\uc774\ube14\uc758 \ub370\uc774\ud130 \ub3c4\uad6c'}\ub97c \uc0ac\uc6a9\ud558\uc138\uc694.`,
      `The result was cut off at ${result.rows.length} rows. Save only the loaded rows? For every row, use ${source === 'table' ? 'Data tools \u2192 export all' : 'LIMIT/OFFSET batches or the table\u2019s Data tools'}.`,
    ), { title: t('CSV \ub0b4\ubcf4\ub0b4\uae30'), confirmLabel: tr(`${result.rows.length}\ud589 \uc800\uc7a5`, `Save ${result.rows.length} rows`) })) return;
    // Export what the grid shows (filter and sort) with committed values, never unsaved drafts.
    const content = csv(result.columns.map(c => c.name), filtered.map(({ index }) => result.rows[index]));
    const url = URL.createObjectURL(new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' }));
    const base = source === 'table' && selected ? selected.name : tabName(tab);
    const link = document.createElement('a'); link.href = url; link.download = `${safeFileName(base)}-results.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (filter || edits.length) announce(tr(`\ud654\uba74\uc5d0 \ubcf4\uc774\ub294 ${filtered.length}\ud589\uc744 \uc800\uc7a5\ud588\uc2b5\ub2c8\ub2e4${edits.length ? ' \u00b7 \uc801\uc6a9\ud558\uc9c0 \uc54a\uc740 \ubcc0\uacbd\uc740 \uc81c\uc678' : ''}.`, `Saved the ${filtered.length} visible rows${edits.length ? ' \u00b7 unapplied edits excluded' : ''}.`), 'info');
  }
  async function refreshResults() {
    if (busy) return;
    if (source === 'query') {
      if (lastQuery && (/^\s*select\b/i.test(lastQuery) || await requestConfirm(t('마지막 쿼리를 다시 실행할까요? 데이터를 변경하는 SQL은 다시 적용됩니다.')))) executeQuery(lastQuery);
    } else if (selected) void openTable(selected, true);
  }
  async function refreshTables() {
    if (!connected || tablesLoading) return;
    const session = active;
    setTablesLoading(true); setTablesError('');
    try { const list = await api.tables(session); if (activeSessionRef.current === session) setTableList(list); }
    catch (e) { if (activeSessionRef.current === session) setTablesError(String(e)); }
    finally { if (activeSessionRef.current === session) setTablesLoading(false); }
  }
  // Arrow keys move between cells; Enter/F2 edits a cell and Enter/Space sorts by a heading.
  function gridKey(event: React.KeyboardEvent<HTMLTableElement>) {
    const cell = event.target instanceof HTMLTableCellElement ? event.target : null;
    if (!cell || event.altKey || event.ctrlKey || event.metaKey) return;
    const row = cell.parentElement as HTMLTableRowElement;
    const focus = (target?: Element | null) => { if (target instanceof HTMLElement && target.tabIndex >= 0) { event.preventDefault(); target.focus(); target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } };
    const sibling = (step: 1 | -1) => {
      let next = (step > 0 ? row.nextElementSibling : row.previousElementSibling) as HTMLTableRowElement | null;
      while (next?.classList.contains('spacer-row')) next = (step > 0 ? next.nextElementSibling : next.previousElementSibling) as HTMLTableRowElement | null;
      if (!next && step < 0 && row.parentElement?.tagName === 'TBODY') next = row.closest('table')?.tHead?.rows[0] ?? null;
      if (!next && step > 0 && row.parentElement?.tagName === 'THEAD') next = row.closest('table')?.tBodies[0]?.querySelector<HTMLTableRowElement>('tr:not(.spacer-row)') ?? null;
      return next?.cells[cell.cellIndex];
    };
    if (event.key === 'ArrowRight') focus(cell.nextElementSibling);
    else if (event.key === 'ArrowLeft') focus(cell.previousElementSibling);
    else if (event.key === 'ArrowDown') focus(sibling(1));
    else if (event.key === 'ArrowUp') focus(sibling(-1));
    else if (cell.tagName === 'TH' && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); cell.click(); }
    else if (cell.tagName === 'TD' && (event.key === 'Enter' || event.key === 'F2')) { event.preventDefault(); cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }
  }
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
  useEffect(()=>{let cancelled=false;setCompletionSchema({});if(!connected)return;const chosen=schemaFilters[connection.profile.id];const tables=chosen?tableList.filter(table=>chosen.includes(table.schema)):tableList;let cursor=0;const fields:Record<string,string[]>={};const worker=async()=>{while(!cancelled&&cursor<tables.length){const table=tables[cursor++];try{const cols=await api.describeTable(active,table);if(cancelled)return;fields[table.schema+'.'+table.name]=cols.map(c=>c.name);if(tables.filter(t=>t.name===table.name).length===1)fields[table.name]=cols.map(c=>c.name);setCompletionSchema({...fields});}catch{/* A metadata failure must not prevent SQL editing. */}}};void Promise.all(Array.from({length:Math.min(3,tables.length)},worker));return()=>{cancelled=true;};},[active,tableList,catalogVersion,JSON.stringify(schemaFilters[connection.profile.id]??null)]);
  const allSchemas = [...new Set([...schemaCatalog,...tableList.map(t=>t.schema)])].sort();
  const chosenSchemas = schemaFilters[connection.profile.id];
  const shownTables = tableList.filter(t=>!chosenSchemas||chosenSchemas.includes(t.schema));
  const visibleTables = shownTables.filter(t => `${t.schema}.${t.name}`.toLowerCase().includes(search.toLowerCase()));
  const schemas = allSchemas.filter(schema=>(!chosenSchemas||chosenSchemas.includes(schema))&&(!search||schema.toLowerCase().includes(search.toLowerCase())||visibleTables.some(t=>t.schema===schema)));
  // The breadcrumb and sidebar both follow the active tab's object.
  const activeSchema = tab.kind === 'schema' ? tab.objectSchema : selected?.schema ?? (tab.kind === 'query' ? tab.querySchema : undefined);
  const crumbSchema = activeSchema || undefined;
  const crumbObject = tab.kind === 'schema' ? undefined : tab.kind === 'query' || tab.kind === 'history' ? tabName(tab) : selected?.name;
  function revealInExplorer() {
    setSidebarOpen(true); setArea('database');
    window.setTimeout(() => document.querySelector<HTMLElement>('.tree .active')?.scrollIntoView({ block: 'nearest' }), 0);
  }
  useEffect(() => {
    if (!activeSchema || !connected) return;
    if (collapsedSchemas.has(activeSchema)) setCollapsedByProfile(previous => ({ ...previous, [connection.profile.id]: (previous[connection.profile.id] ?? []).filter(name => name !== activeSchema) }));
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>('.tree .active')?.scrollIntoView({ block: 'nearest' }), 0);
    return () => window.clearTimeout(timer);
  }, [tab.id, activeSchema, selected?.name, connected]);
  // Table and schema tabs switch between views of the same object.
  const views: [TabView, string][] = tab.kind === 'schema'
    ? [['objects', tr('테이블 목록','Tables')], ['erd', 'ERD']]
    : [['data', tr('데이터','Data')], ['structure', tr('구조','Structure')], ['ddl', 'DDL'], ['relations', tr('관계','Relations')]];
  const currentView = tab.view ?? (tab.kind === 'schema' ? 'objects' : 'data');
  const viewBar = <div className="object-view-bar" role="group" aria-label={tr('보기','View')}>{views.map(([view, label]) => <Button key={view} variant="ghost" size="bare" className="view-option" aria-pressed={currentView === view} onClick={() => { if (view === 'structure' && tab.selected) void openDetails(tab.selected); else setView(tab.id, view); }}>{label}</Button>)}{tab.kind === 'table' && tab.selected && <><span className="tabs-spacer"/><Button variant="outline" size="sm" onClick={() => void addQuery(tableQuery(connection.profile.engine, tab.selected!.schema, tab.selected!.name), tab.selected!.schema)}><FileCode2 size={14}/>{tr('이 테이블로 새 쿼리','New query for this table')}</Button></>}</div>;
  // The schema picker offers what the sidebar filter shows, plus the tab's current choice.
  const pickerSchemas = [...new Set([...allSchemas.filter(name => !chosenSchemas || chosenSchemas.includes(name)), ...(executionSchema() ? [executionSchema()!] : [])])].sort();
  const selectableConnections = connections.filter(c=>fixtureMode||c.session!=='demo').sort((a,b)=>(a.profile.group??'').localeCompare(b.profile.group??'')||a.profile.name.localeCompare(b.profile.name));
  const currentConnection = selectableConnections.find(c=>c.session===active);
  return <div className="app">
    <aside className="rail">
      {WORK_AREAS.map(({ id, icon: Icon, label, title }) => <Button key={id} variant="ghost" size="bare" className={`rail-button ${sidebarOpen && area === id ? 'selected' : ''}`} aria-pressed={sidebarOpen && area === id} aria-label={tr(...label)} title={tr(...title)} onClick={() => showArea(id)}><Icon size={21}/></Button>)}
      <div className="rail-bottom"><Button variant="ghost" size="bare" className="rail-button" title={themeLabel} aria-label={themeLabel} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={21}/> : <Moon size={21}/>}</Button><Button variant="ghost" size="bare" className="rail-button" title={t("설정") + " · Ctrl/Cmd+,"} aria-label={t("설정")} onClick={() => setShowSettings(true)}><Settings2 size={21}/></Button><Button variant="ghost" size="bare" className="rail-button" title={t("도움말")} aria-label={t("도움말")} onClick={() => setShowHelp(true)}><CircleHelp size={21}/></Button></div>
    </aside>
    {sidebarOpen && area === 'database' && <aside className="sidebar" id="database-sidebar" onContextMenu={event => { if (event.target instanceof HTMLInputElement) return; menuFor([{label:t("연결 추가"),action:()=>setShowConnect(true)},{label:t("목록 새로고침"),action:refreshTables,disabled:tablesLoading}]).onContextMenu(event); }}>
      {area === 'database' && <>
      <div className="section-label"> {t("연결")} <Button variant="ghost" size="bare" title={t("연결 추가")} aria-label={t("새 연결")} onClick={() => setShowConnect(true)}><Plus size={16}/></Button></div>
      <div className="connections">{selectableConnections.length>0&&<ConnectionSwitcher connections={selectableConnections} active={active} onSelect={id=>{editorSelection.current='';void selectConnection(id);}} onAdd={()=>setShowConnect(true)}>{currentConnection ? (()=>{const c=currentConnection;return <Button variant="ghost" size="bare" key={c.session} {...menuFor([
        {label:t('연결 선택'), action:()=>selectConnection(c.session)},
        {label:t('호스트 복사'), action:()=>void copyText(c.profile.host)},
        {label:tr('프로필 수정 / 다시 연결','Edit profile / reconnect'),action:()=>{setEditProfile(c.profile);setShowConnect(true);},disabled:c.session==='demo'},
        {label:tr('백업 / 복원','Backup / restore'),action:()=>{setActive(c.session);setShowMaintenance(true);},disabled:c.session==='demo'||c.session.startsWith('saved:')},
        {label:tr('연결 끊기','Disconnect'),action:()=>void disconnectProfile(c),disabled:c.session==='demo'||c.session.startsWith('saved:')},
        {label:tr('프로필 삭제','Delete profile'),action:()=>void deleteProfile(c),disabled:c.session==='demo'},
        {label:t('연결 추가'), action:()=>setShowConnect(true), divider:true},
      ])} className={`connection ${active === c.session ? 'active' : ''}`} aria-label={tr('연결 전환','Switch connection')}>
        <span className={`db-icon ${c.profile.engine !== 'postgres' ? 'mysql' : ''}`}><Database size={18}/></span>
        <span className="connection-name"><span className="connection-title" title={c.profile.name}>{c.profile.name}</span>{(c.profile.group||c.profile.environment||c.profile.readOnly)&&<small>{[c.profile.group,c.profile.environment,c.profile.readOnly?'RO':null].filter(Boolean).join(' · ')}</small>}<small>{c.profile.engine === 'sqlite' ? 'SQLite' : c.profile.engine === 'postgres' ? 'PostgreSQL' : c.profile.engine === 'mariadb' ? 'MariaDB' : 'MySQL'} {c.profile.engine!=='sqlite'&&<span>· {c.session === 'demo' ? 'Demo' : c.profile.host}</span>}</small></span>{c.profile.environment==='production'||c.profile.environment==='staging'?<span className="env-tag" data-environment={c.profile.environment}>{c.profile.environment==='production'?'PROD':'STG'}</span>:null}<span className={`live-dot ${c.session.startsWith('saved:')?'offline':''}`} title={c.session.startsWith('saved:')?tr('연결 안 됨','Not connected'):tr('연결됨','Connected')}/>
      <ChevronDown size={14}/></Button>;})() : <Button variant="ghost" size="bare" className="connection connection-placeholder" aria-label={tr('연결 전환','Switch connection')}><Database size={18}/><span>{t('연결 선택')}</span><ChevronDown size={14}/></Button>}</ConnectionSwitcher>}</div>
      {!emptyWorkspace&&<><Separator className="divider"/>
      <div className="section-label"><span>{tr("스키마 · 테이블","Schemas · tables")}</span><div className="sidebar-section-actions"><Button variant="ghost" size="bare" className="schema-filter-button" data-active={!!chosenSchemas} title={chosenSchemas?tr(`스키마 필터 사용 중 · ${chosenSchemas.filter(s=>allSchemas.includes(s)).length}/${allSchemas.length}`,`Schema filter on · ${chosenSchemas.filter(s=>allSchemas.includes(s)).length}/${allSchemas.length}`):tr("스키마 선택","Select schemas")} aria-label={tr("스키마 선택","Select schemas")} aria-describedby={chosenSchemas?"schema-filter-count":undefined} onClick={()=>setShowSchemas(true)}><Filter size={14}/>{chosenSchemas&&<span className="filter-count" id="schema-filter-count">{chosenSchemas.filter(s=>allSchemas.includes(s)).length}/{allSchemas.length}</span>}</Button><Button variant="ghost" size="bare" title={t("목록 새로고침")} aria-label={t("목록 새로고침")} disabled={tablesLoading} onClick={() => void refreshTables()}><RefreshCw size={14} className={tablesLoading?'spin':''}/></Button></div></div>
      <label className="search-field"><Search size={14}/><Input aria-label={t("테이블 검색")} placeholder={t("테이블 검색")} value={search} onChange={e => setSearch(e.target.value)}/></label>
      <div className="tree">
        {schemas.map(schema => <div key={schema}><div className="schema-tree-row"><Button variant="ghost" size="bare" className="schema-expander icon-button" aria-label={t('스키마 펼치기/접기') + ': ' + schema} aria-expanded={!collapsedSchemas.has(schema) || !!search} disabled={!!search} title={search?tr('검색 중에는 일치하는 스키마를 모두 펼칩니다','Matching schemas stay expanded while searching'):undefined} onClick={() => toggleSchema(schema)}>{!collapsedSchemas.has(schema)||search?<ChevronDown size={13}/>:<ChevronRight size={13}/>}</Button><Button variant="ghost" size="bare" className={`tree-schema ${tab.kind==='schema'&&tab.objectSchema===schema?'active':''}`} aria-current={tab.kind==='schema'&&tab.objectSchema===schema?'page':undefined} {...menuFor([{label:t("스키마 상세"),action:()=>openSchema(schema)},{label:t("ERD 열기"),action:()=>openErd(schema)},{label:t("이름 복사"),action:()=>void copyText(schema)},{label:t("목록 새로고침"),action:refreshTables,disabled:tablesLoading}])} onClick={() => openSchema(schema)}><Layers3 size={14}/>{schema}</Button><Button variant="ghost" size="bare" className="schema-open icon-button" aria-label={t("스키마 상세 이름", {name:schema})} title={t("스키마 상세")} onClick={() => openSchema(schema)}><ArrowRight size={13}/></Button></div>
          {(!collapsedSchemas.has(schema) || !!search) && visibleTables.filter(t => t.schema === schema).map(t => <Button variant="ghost" size="bare" key={`${t.schema}.${t.name}`} {...menuFor(tableMenu(t))} className={`tree-table ${selected?.name === t.name && selected.schema === t.schema ? 'active' : ''}`} onClick={() => void openObject(t)}><Table2 size={14}/><span>{t.name}</span>{selected?.name === t.name && selected.schema === t.schema && <span className="table-dot"/>}</Button>)}
        </div>)}
        {tablesLoading && !tableList.length ? <p className="empty-tree" role="status"><Loader2 size={13} className="spin"/> {tr('테이블 목록을 불러오는 중…','Loading tables…')}</p>
          : tablesError ? <div className="empty-tree tree-error" role="alert"><p>{tr('테이블 목록을 불러오지 못했습니다.','Could not load tables.')}</p><small title={tablesError}>{tablesError}</small><Button variant="outline" size="xs" onClick={() => void refreshTables()}>{tr('다시 시도','Retry')}</Button></div>
          : !visibleTables.length && (search && shownTables.length ? <p className="empty-tree">{tr(`"${search}"와 일치하는 테이블이 없습니다.`,`No tables match "${search}".`)}</p>
          : chosenSchemas && tableList.length ? <div className="empty-tree"><p>{tr('스키마 필터 때문에 모든 테이블이 숨겨져 있습니다.','The schema filter hides every table.')}</p><Button variant="outline" size="xs" onClick={()=>setSchemaFilters(prev=>{const next={...prev};delete next[connection.profile.id];return next;})}>{tr('필터 해제','Clear filter')}</Button></div>
          : <p className="empty-tree"> {t("표시할 테이블이 없습니다.")} </p>)}
      </div></>}</>}
    </aside>}
    <main className="main" hidden={area !== 'database'} data-environment={!emptyWorkspace&&connected?connection.profile.environment:undefined}>
      <header className="topbar"><div className="breadcrumb"><Button variant="ghost" size="bare" className="icon-button sidebar-toggle" aria-label={t(sidebarOpen ? '사이드바 접기' : '사이드바 펼치기')} title={t(sidebarOpen ? '사이드바 접기' : '사이드바 펼치기') + ' · Ctrl/Cmd+B'} aria-expanded={sidebarOpen} aria-controls="database-sidebar" onClick={toggleSidebar}>{sidebarOpen ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}</Button>{!emptyWorkspace&&<nav className="breadcrumb-path" aria-label={tr('현재 위치','Location')}><Database size={14}/><Button variant="ghost" size="bare" className="crumb-link" title={tr('탐색기에서 보기','Show in explorer')} onClick={revealInExplorer}>{connection.profile.name}</Button><ChevronRight size={13}/>{tab.kind === 'history' ? <strong aria-current="page">{crumbObject}</strong> : crumbSchema ?<Button variant="ghost" size="bare" className="crumb-link" aria-current={!crumbObject?'page':undefined} title={tr('스키마 열기','Open schema')} onClick={()=>void openSchema(crumbSchema)}>{crumbSchema}</Button> : <span className="crumb-muted" title={connection.profile.engine === 'postgres' ? tr('스키마를 생략한 이름은 연결의 search_path(보통 public)에서 찾습니다.','Unqualified names resolve through the connection search_path (usually public).') : tr('스키마를 생략한 이름은 연결의 기본 데이터베이스에서 찾습니다.','Unqualified names resolve in the connection default database.')}>{tr('기본 스키마','Default schema')}</span>}{crumbObject&&tab.kind!=='history'&&<><ChevronRight size={13}/><strong aria-current="page">{crumbObject}</strong></>}</nav>}</div><div className="topbar-right">{!emptyWorkspace&&<span className="connection-status" data-connected={connected} title={connected?(connection.profile.engine==='sqlite'?connection.profile.database:`${connection.profile.username}@${connection.profile.host}:${connection.profile.port}/${connection.profile.database}`):undefined}><span className={`live-dot ${connected?'':'offline'}`} aria-hidden="true"/>{!connected&&<strong>{tr('연결 끊김','Disconnected')}</strong>}<span>{[engineLabel(connection.profile.engine),connection.profile.engine==='sqlite'?connection.profile.database.split(/[\\/]/).pop():connection.profile.host,connection.profile.engine==='sqlite'?null:connection.profile.tls?'TLS':tr('TLS 없음','No TLS')].filter(Boolean).join(' · ')}</span></span>}{!emptyWorkspace&&production&&<span className="env-banner" data-environment="production" role="note"><AlertTriangle size={13}/>PRODUCTION</span>}{!emptyWorkspace&&connection.profile.environment==='staging'&&<span className="env-banner" data-environment="staging">STAGING</span>}{!emptyWorkspace&&connection.profile.readOnly&&<span className="env-banner" data-environment="readonly">{tr('읽기 전용','Read-only')}</span>}<Button variant="ghost" size="bare" className="subtle-button" onClick={() => setShowConnect(true)}><Plus size={14}/> {t("연결 추가")} </Button><Button variant="ghost" size="bare" className="icon-button history-toggle-button" aria-label={tr('쿼리 기록','Query history')} title={tr('쿼리 기록 패널','Query history panel') + ' · Ctrl/Cmd+Alt+B'} aria-pressed={historyOpen} aria-controls="history-sidebar" onClick={() => setHistoryOpen(open => !open)}><ScrollText size={17}/></Button></div></header>
      <>
      {emptyWorkspace?<div className="workspace-empty"><Database size={28}/><h1>{tr("첫 데이터베이스를 연결하세요","Connect your first database")}</h1>{!api.desktop&&<p className="connection-availability">{tr("실제 DB 연결은 데스크톱 앱에서 사용할 수 있습니다.","Use the desktop app to connect to a database.")}</p>}<div className="empty-connection-actions">{!connections.some(c=>c.session!=='demo')&&<Button size="sm" disabled={creatingLocal||!api.desktop} title={!api.desktop?tr('데스크톱 앱에서 사용할 수 있습니다.','Available in the desktop app.'):undefined} onClick={()=>void createLocalDatabase()}>{creatingLocal?<Loader2 size={14} className="spin"/>:<Database size={14}/>} {tr('로컬 SQLite 만들기','Create local SQLite')}</Button>}<Button variant="outline" size="sm" disabled={creatingLocal} onClick={()=>{setEditProfile(undefined);setShowConnect(true);}}><Plus size={14}/>{t("새 연결")}</Button></div>{localError&&<p className="local-connection-error" role="alert">{localError}</p>}</div>:<>
      <div className="tabs" {...menuFor([{label:t("새 쿼리"),action:()=>addQuery()}])}><div className="tab-list" onWheel={event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY; }} role="tablist" aria-label={t('쿼리 탭')}>
        {workspace.connectionTabs.map(item => <div key={item.id} className={`tab-item ${tab.id === item.id ? 'active' : ''} ${tabDrop?.id===item.id?(tabDrop.after?'drop-after':'drop-before'):''}`} data-workspace-tab={item.id}>
          <Button variant="ghost" size="bare" role="tab" id={`tab-${item.id}`} onPointerDown={event=>{if(event.button===0){suppressTabClick.current=false;tabDrag.current={id:item.id,x:event.clientX,y:event.clientY,moving:false};}}}
          onPointerMove={dragTab} onPointerUp={event=>finishTabDrag(event)} onPointerCancel={event=>finishTabDrag(event,true)}
          onDoubleClick={()=>setRenaming({id:item.id,name:tabName(item)})}
          aria-controls="query-panel" aria-selected={tab.id === item.id} tabIndex={tab.id === item.id ? 0 : -1} onContextMenu={menuFor(tabMenu(item)).onContextMenu} onKeyDown={event => {
            if(event.key==='F2'){event.preventDefault();setRenaming({id:item.id,name:tabName(item)});}
            else if(event.altKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();const index=workspace.connectionTabs.findIndex(tab=>tab.id===item.id);const next=workspace.connectionTabs[index+(event.key==='ArrowRight'?1:-1)];if(next)workspace.reorder(item.id,next.id,event.key==='ArrowRight');}
            else if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') menuFor(tabMenu(item)).onKeyDown(event);
            else navigateTabs(event,item.id);
          }} className="tab" title={tabName(item)} onClick={() => {if(suppressTabClick.current){suppressTabClick.current=false;return;}void activateTab(item.id);}}>{item.busy ? <Loader2 size={14} className="spin"/> : item.kind === 'schema' && item.view === 'erd' ? <GitBranch size={14}/> : item.kind === 'schema' ? <Layers3 size={14}/> : item.kind === 'history' ? <ScrollText size={14}/> : item.kind === 'table' || item.kind === 'details' ? <Table2 size={14}/> : <FileCode2 size={14}/>}<span>{tabName(item)}</span>{isDirty(item) && <i className="tab-dirty" aria-hidden="true"/>}</Button>
          <Button variant="ghost" size="bare" className="tab-close" aria-label={t('탭 닫기 이름', {name:tabName(item)})} title={t('탭 닫기')} disabled={item.busy} onClick={() => closeTab(item)}><X size={13}/></Button>
        </div>)}
      </div><Button variant="ghost" size="bare" className="tab-add" title={t('새 쿼리') + ' · Ctrl/Cmd+T'} aria-label={t('새 쿼리')} onClick={() => addQuery()}><Plus size={17}/></Button></div>
      {showCommonSql && <CommonSqlDialog key={active} engine={connection.profile.engine} onClose={() => setShowCommonSql(false)} onSelect={sql => { setShowCommonSql(false); void addQuery(sql); }}/>}
      {tab.kind === 'history' && workspace.connectionTabs.some(item => item.id === tab.id) ? <HistoryPanel variant="page" key={tab.id} profileId={connection.profile.id} connectionName={connection.profile.name} profileIds={connections.map(c => c.profile.id)} onOpen={entry => void openExecution(entry)}/> : !connected?<div className="workspace-empty"><Database size={28}/><h2>{connection.profile.name}</h2><Button disabled={reconnecting} onClick={()=>void reconnectProfile(connection.profile)}>{reconnecting?tr('연결 중…','Connecting…'):tr('다시 연결','Reconnect')}</Button></div>:!workspace.connectionTabs.length?<div className="workspace-empty"><FileCode2 size={28}/><h2>{tr('열린 탭이 없습니다','No open tabs')}</h2><Button size="sm" onClick={()=>void addQuery()}><Plus size={14}/>{t('새 쿼리')}</Button></div>:tab.kind === 'schema' && tab.view === 'erd' ?<>{viewBar}<Suspense fallback={<div className="object-empty">{t('ERD 생성 중…')}</div>}><ErdPage key={tab.id+catalogVersion} session={active} schema={tab.objectSchema} theme={theme} initial={tab.erd} readOnly={connection.profile.readOnly}
        onBusyChange={value=>workspace.patch(tab.id,{busy:value})}
        canApply={()=>!allTabsRef.current.some(item=>item.session===active&&item.id!==tab.id&&(item.busy||Object.keys(item.draft).length||dataDirtyRef.current[item.id]))}
        onApplied={()=>{for(const item of allTabsRef.current.filter(item=>item.session===active&&item.id!==tab.id)){if(item.kind==='table')workspace.patch(item.id,{loaded:false,details:[]});if(item.kind==='schema')workspace.patch(item.id,{erd:null});}setCatalogVersion(v=>v+1);refreshTables();}}
        storageKey={'woojoo-erd-v1:' + JSON.stringify([connection.profile.engine,connection.profile.host,connection.profile.port,connection.profile.database,connection.profile.username,tab.objectSchema])}
        onChange={erd => workspace.patch(tab.id,{erd})}/></Suspense></> : tab.kind === 'table' && tab.view === 'ddl' && tab.selected ? <>{viewBar}<DdlView session={active} engine={connection.profile.engine} table={tab.selected} revision={catalogVersion} onSql={sql=>void addQuery(sql,tab.selected?.schema)}/></> : tab.kind === 'table' && tab.view === 'relations' && tab.selected ? <>{viewBar}<RelationsView session={active} table={tab.selected} revision={catalogVersion} onOpen={table=>void openObject(table,'relations')} onSchemaErd={schema=>void openErd(schema)}/></> : tab.kind === 'schema' || tab.kind === 'table' && tab.view === 'structure' ? <>{viewBar}<ObjectPage key={tab.id} session={active} engine={connection.profile.engine} revision={catalogVersion} onSql={addQuery} readOnly={connection.profile.readOnly} onChanged={structureChanged} changeBlocked={changeBlocked} tab={tab.kind === 'table' ? {...tab, filter: tab.objectFilter ?? ''} : tab} database={connection.profile.database} tables={tableList} onFilter={value => tab.kind === 'table' ? workspace.patch(tab.id, {objectFilter: value}) : setFilter(value)}
        onRefresh={() => tab.kind === 'schema' ? refreshTables() : tab.selected && void openDetails(tab.selected,true)}
        onSchema={openSchema} onErd={openErd} onDetails={table => void openDetails(table)} onData={table => void openTable(table)}
        onQuery={table => addQuery(tableQuery(connection.profile.engine,table.schema,table.name),table.schema)} tableMenu={tableMenu} menuFor={menuFor}/></> : <>{tab.kind === 'table' && viewBar}
      <section {...menuFor(() => [
        {label:t('실행'),action:run,disabled:busy||!editorSql.trim()},
        {label:t('선택한 SQL 복사'),action:()=>void copyText(editorSelection.current),disabled:!editorSelection.current},
        {label:t('전체 SQL 복사'),action:()=>void copyText(editorSql),disabled:!editorSql},
        {label:t('새 쿼리'),action:()=>addQuery(),divider:true},
      ])} className="editor-pane" id="query-panel" role="tabpanel" aria-labelledby={`tab-${tab.id}`}>
        <QueryTools leadingAction={connection.profile.engine !== 'sqlite' && <label className="schema-select" title={tr('스키마를 생략한 SQL이 실행될 스키마','Schema for unqualified names')}><Layers3 size={13} aria-hidden="true"/><NativeSelect size="sm" aria-label={tr('실행 스키마','Execution schema')} value={executionSchema() ?? ''} disabled={busy} onChange={event=>workspace.patch(tab.id,{querySchema:event.target.value||undefined})}><NativeSelectOption value="">{tr('기본 스키마','Default schema')}</NativeSelectOption>{pickerSchemas.map(name=><NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}</NativeSelect></label>} onOpenCommonSql={() => setShowCommonSql(true)} commonSqlDisabled={!connected || busy} primaryAction={<><Button variant="ghost" size="sm" aria-expanded={!editorCollapsed} aria-controls="sql-editor" onClick={()=>workspace.patch(tab.id,{editorCollapsed:!editorCollapsed})}>{editorCollapsed?tr("SQL 펼치기","Show SQL"):tr("SQL 접기","Hide SQL")}</Button>{busy ? <Button variant="outline" size="sm" className="run-button stop-button" title={canStop ? tr("실행 중인 쿼리 중지 · Esc","Stop the running query · Esc") : tr("이 연결에서는 중지할 수 없습니다","This connection cannot stop queries")} disabled={!canStop} onClick={stopQuery}><Square size={12}/> {tr("중지","Stop")} <span className="run-elapsed">{(elapsed/1000).toFixed(1)}s</span></Button> : <Button variant="default" size="sm" className="run-button" title={tr("선택한 SQL 또는 커서가 있는 구문 실행 · Ctrl/Cmd + Enter","Run the selection or the statement at the cursor · Ctrl/Cmd + Enter")} disabled={!connected || !editorSql.trim()} onClick={run}><Play size={14}/> {t("실행")} </Button>}</>} commandsRef={queryCommands} key={`tools-${tab.id}`} engine={connection.profile.engine} session={active} beforeExecute={async(sql)=>await askDiscard()&&await leaveData()&&await confirmProduction(sql,executionSchema())&&await confirmSchemaSwitch(executionSchema())} connectionName={connection.profile.name} historyKey={connection.profile.id} initialFile={tab.file} sql={editorSql} disabled={busy} onSqlChange={setEditorSql} onFileChange={file=>{workspace.markQuery(tab.id);workspace.patch(tab.id,{file,initialSql:file.savedSql});}} onBusyChange={value=>{if(value)pending.current.add(tab.id);else pending.current.delete(tab.id);workspace.patch(tab.id,{busy:value});}} onExecute={text=>api.query(active,text,executionSchema()).catch(e=>{throw new Error(timeoutHint(String(e),language));})} onResults={results=>{setScriptResults(previous=>({...previous,[tab.id]:results}));const last=results.at(-1);workspace.markQuery(tab.id);if(last?.result)workspace.patch(tab.id,{result:last.result,resultStale:false,source:'query',draft:{},queryTable:null,lastQuery:last.sql,error:''});if(last?.error)workspace.patch(tab.id,{error:last.error,resultStale:true});}}/>
        <div id="sql-editor" className="sql-editor" hidden={editorCollapsed}><CodeMirror key={tab.id} value={editorSql} height="100%" theme={theme === 'dark' ? oneDark : 'light'} extensions={[sqlLanguage({dialect: connection.profile.engine === 'sqlite'?SQLite:connection.profile.engine === 'postgres' ? PostgreSQL : MySQL, schema: completionSchema, defaultSchema: executionSchema()})]} onChange={setEditorSql} onCreateEditor={view => { const saved = editorStates.current.get(tab.id); if (saved && saved.doc.toString() === editorSql) { view.setState(saved); editorSelection.current = saved.sliceDoc(saved.selection.main.from, saved.selection.main.to); } }} onUpdate={u => { editorStates.current.set(tab.id, u.state); editorSelection.current = u.state.sliceDoc(u.state.selection.main.from, u.state.selection.main.to); }} basicSetup={{lineNumbers: true, foldGutter:false, highlightActiveLine:true, autocompletion:true}}/></div>
      </section>
      {selected&&source==='table'&&<div className="data-tool-switch"><Button variant="outline" size="sm" onClick={async()=>{if((dataDirty[tab.id]||edits.length)&&!await requestConfirm(tr('저장하지 않은 데이터 변경을 버릴까요?','Discard pending data edits?'),discardOptions))return;setDraft({});setAdvanced(previous=>({...previous,[tab.id]:!previous[tab.id]}));}}>{advanced[tab.id]?tr('간단한 보기','Simple view'):tr('데이터 도구','Data tools')}</Button><span>{advanced[tab.id]?tr('필터 · 페이징 · 행 편집 · 가져오기 · 내보내기','Filter · paging · row editing · import · export'):''}</span></div>}
      {!!scriptResults[tab.id]?.length&&<div className="script-result-tabs">{scriptResults[tab.id].map(item=><Button key={item.index} variant="outline" size="sm" onClick={()=>{if(item.result)workspace.patch(tab.id,{result:item.result,resultStale:false,lastQuery:item.sql,source:'query',queryTable:null,error:''});else workspace.patch(tab.id,{error:item.error??'',resultStale:true});}}>{tr('결과','Result')} {item.index} · {item.error?tr('오류','Error'):tr(`${item.result?.rows.length}행`,`${item.result?.rows.length} rows`)}</Button>)}</div>}
      {advanced[tab.id]&&selected&&source==='table'?<DataWorkbench key={tab.id} session={active} engine={connection.profile.engine} table={selected} readOnly={connection.profile.readOnly} initialResult={result} initialFilters={initialFilters[tab.id]} targets={copyTargets} onBusyChange={value=>workspace.patch(tab.id,{busy:value})} onDirtyChange={dirty=>setDataDirty(previous=>previous[tab.id]===dirty?previous:{...previous,[tab.id]:dirty})} onNavigate={async(table,filter)=>{if(!await leaveData())return;const next=workspace.add(table,tableQuery(connection.profile.engine,table.schema,table.name));setAdvanced(previous=>({...previous,[next.id]:true}));setInitialFilters(previous=>({...previous,[next.id]:filter?[filter]:[]}));}} onChanged={()=>{setCatalogVersion(v=>v+1);}}/>:<section className="results-pane" {...menuFor(resultMenu)}>
        <div className="result-tabs"><div className="result-tab"><Table2 size={15}/> {t("결과")} <span title={result.truncated?tr(`처음 ${result.rows.length}행만 불러왔습니다`,`Only the first ${result.rows.length} rows were loaded`):undefined}>{result.rows.length}{result.truncated?'+':''}</span></div>{selected && tab.kind !== 'table' && <Button variant="ghost" size="bare" className="subtle-button" onClick={() => void openDetails(selected)}>{t("테이블 상세")}</Button>}<div className="result-meta" data-stale={!!tab.resultStale}>{busy ? <Loader2 size={13} className="spin"/> : tab.resultStale || error ? <X size={13}/> : result.columns.length || lastQuery ? <Check size={13}/> : null}<span aria-live="polite">{busy ? t("처리 중…") + (elapsed >= 1000 ? ` ${(elapsed/1000).toFixed(0)}s` : '') : tab.resultStale || error ? tr("작업 실패","Operation failed") : tr("DB 처리","DB time")+" "+result.elapsedMs+" ms"}</span>{tab.resultStale&&result.columns.length>0&&<span className="stale-result-label" title={lastQuery}>{tr("이전 성공 결과","Previous successful result")} · {result.elapsedMs} ms</span>}<span className="sep">·</span><span>{source === 'table' ? t("테이블 보기") : canEdit?tr("쿼리 결과 · 편집 가능","Query result · editable"):t("쿼리 결과 · 읽기 전용")}</span></div><span className="tabs-spacer"/><Button variant="ghost" size="bare" className="icon-button" title={t("CSV 내보내기")} aria-label={t("CSV 내보내기")} disabled={!result.columns.length} onClick={exportCsv}><ArrowDownToLine size={16}/></Button><Button variant="ghost" size="bare" className="icon-button" title={source === 'query' ? t("마지막 쿼리 다시 실행") : t("테이블 새로고침")} aria-label={source === "query" ? t("마지막 쿼리 다시 실행") : t("테이블 새로고침")} disabled={busy || (source === 'table' ? !selected : !lastQuery)} onClick={refreshResults}><RefreshCw size={15}/></Button></div>
        <div className="result-toolbar"><label className="result-filter"><Filter size={14}/><Input aria-label={t("결과 필터")} placeholder={result.truncated ? tr(`결과 검색 (불러온 ${result.rows.length}행)`,`Search loaded ${result.rows.length} rows`) : t("결과 검색")} value={filter} onChange={e => {setFilter(e.target.value);setScroll(0);}}/></label>{result.truncated && (filter || sort) && <span className="truncation-note" role="note"><AlertTriangle size={13}/>{tr(`불러온 ${result.rows.length}행 안에서만 ${filter && sort ? '검색·정렬' : filter ? '검색' : '정렬'}했습니다`,`${filter && sort ? 'Search and sort cover' : filter ? 'Search covers' : 'Sort covers'} only the ${result.rows.length} loaded rows`)}{source === 'table' && selected && <Button variant="link" size="bare" onClick={async()=>{if(edits.length&&!await requestConfirm(tr('저장하지 않은 데이터 변경을 버릴까요?','Discard pending data edits?'),discardOptions))return;setDraft({});setAdvanced(previous=>({...previous,[tab.id]:true}));}}>{tr('데이터 도구에서 서버 정렬·필터','Server-side sort and filter in Data tools')}</Button>}</span>}<span className="tabs-spacer"/>{edits.length > 0 && <><Button variant="ghost" size="bare" className="subtle-button" disabled={busy} onClick={() => setDraft({})}><Undo2 size={14}/> {t("취소")} </Button><Button variant="default" size="sm" className="save-button" disabled={busy} onClick={() => setShowReview(true)}><Check size={14}/> {t("변경 검토")} <span>{edits.length}</span></Button></>}</div>
        {error && <div role="alert" className="error-banner"><Terminal size={15}/><span>{error}</span><Button variant="ghost" size="bare" title={t("오류 닫기")} aria-label={t("오류 닫기")} onClick={() => setError('')}><X size={14}/></Button></div>}
        <div className="grid-scroll" ref={gridRef} aria-busy={busy} onScroll={e => setScroll(e.currentTarget.scrollTop)} key={tab.id}>
          <table className="data-grid" onKeyDown={gridKey} aria-describedby="grid-keys"><thead><tr><th className="row-number">#</th>{result.columns.map(c => <th key={c.name} tabIndex={0} {...menuFor([
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
              ])} className={`${changed ? 'changed' : ''} ${col.primary ? 'pk-cell' : ''}`} title={value ?? 'NULL'} onDoubleClick={() => { if (busy) return; if (canEdit && col.editable) setEditing({index,col:col.name,value:value ?? '',isNull:value === null}); else announce(!canEdit ? t("읽기 전용 결과입니다. 기본키가 있는 테이블을 열어 편집하세요.") : t("기본키·생성 열 또는 지원하지 않는 형식은 수정할 수 없습니다."),'info'); }}>
                {value === null ? <span className="null-value">NULL</span> : value}
              </td>;
            })}</tr>)}
            {start + visible.length < filtered.length && <tr className="spacer-row" style={{height:(filtered.length - start - visible.length) * 39}}><td colSpan={result.columns.length + 1}/></tr>}
          </tbody></table>
          <p id="grid-keys" className="sr-only">{tr('화살표로 셀 이동, Enter 또는 F2로 편집, 열 제목에서 Enter로 정렬','Arrow keys move between cells, Enter or F2 edits, Enter on a heading sorts')}</p>
          {!result.rows.length && <div className="empty-result"><Database size={32}/><h3>{busy ? t("데이터를 불러오는 중...") : t("결과 없음")}</h3><p>{result.affected ? t('영향받은 행', {count: result.affected}) : t("테이블을 선택하거나 SQL을 실행해 보세요.")}</p></div>}
          {result.rows.length > 0 && !filtered.length && <div className="empty-result"><Search size={26}/><p> {t("일치하는 결과가 없습니다.")} </p></div>}
        </div>
        <div className="result-footer"><span><span className="live-dot"/> {filtered.length} {t("행")} <span className="sep">·</span> {result.columns.length} {t("열")} {result.truncated && <strong className="limit-note"><AlertTriangle size={12}/> {tr(`처음 ${result.rows.length}행만 표시 · 정렬·검색·CSV는 이 범위만 대상`,`First ${result.rows.length} rows only · sort, search and CSV cover these rows`)} </strong>}</span><span>{edits.length > 0 && t('변경 대기', {count: edits.length})}</span></div>
      </section>}
      </>}
      </>}
      </>
    </main>
    {historyOpen && area === 'database' && <aside className="history-sidebar" id="history-sidebar"><HistoryPanel profileId={connection.profile.id} connectionName={connection.profile.name} profileIds={connections.map(c => c.profile.id)} panelScope={emptyWorkspace ? 'all' : 'connection'} onOpen={entry => void openExecution(entry)} onShowAll={emptyWorkspace ? undefined : () => void openHistory()} onClose={() => setHistoryOpen(false)}/></aside>}
    {awsVisited && <AwsWorkspace visible={area === 'aws'} sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} commandsRef={awsCommands} theme={theme} onConnectRds={preset => { setEditProfile(undefined); setAwsPreset(preset); setShowConnect(true); }}/>}
    {showSchemas&&<ModalSurface title={tr('스키마 선택','Select schemas')} onClose={()=>setShowSchemas(false)}><section className="modal schema-picker">
      <div className="modal-heading"><h2>{tr('스키마 선택','Select schemas')}</h2><Button variant="ghost" size="icon-sm" aria-label={t('닫기')} onClick={()=>setShowSchemas(false)}><X size={16}/></Button></div>
      <p className="modal-description">{tr('체크한 스키마만 사이드바에 표시합니다. 열린 탭에는 영향을 주지 않습니다.','Only checked schemas appear in the sidebar. Open tabs are preserved.')}</p>
      <div className="schema-picker-actions"><Button variant="outline" size="sm" onClick={()=>setSchemaFilters(prev=>{const next={...prev};delete next[connection.profile.id];return next;})}>{tr('전체 선택','Select all')}</Button><Button variant="outline" size="sm" onClick={()=>setSchemaFilters(prev=>({...prev,[connection.profile.id]:[]}))}>{tr('전체 해제','Clear all')}</Button><Button variant="outline" size="sm" onClick={()=>setCatalogVersion(v=>v+1)}>{t('새로고침')}</Button></div>
      {schemaLoading&&<p role="status">{tr('스키마 조회 중…','Loading schemas…')}</p>}{schemaError&&<p role="alert" className="dialog-error">{schemaError}</p>}
      <div className="schema-picker-list">{allSchemas.map(schema=><label className="checkbox-label" key={schema}><input type="checkbox" checked={!chosenSchemas||chosenSchemas.includes(schema)} onChange={event=>{const checked=event.target.checked;setSchemaFilters(prev=>{const current=prev[connection.profile.id]??allSchemas;return {...prev,[connection.profile.id]:checked?[...new Set([...current,schema])]:current.filter(value=>value!==schema)};});}}/><span>{schema}</span><small>{tableList.filter(t=>t.schema===schema).length}</small></label>)}</div>
      <div className="modal-actions"><Button size="sm" onClick={()=>setShowSchemas(false)}>{t('확인')}</Button></div>
    </section></ModalSurface>}
    {renaming&&<ModalSurface title={tr('탭 이름 변경','Rename tab')} onClose={()=>setRenaming(null)}><form className="modal tab-rename-modal" role="dialog" aria-label={tr('탭 이름 변경','Rename tab')} onSubmit={event=>{event.preventDefault();if(!renaming.name.trim())return;workspace.patch(renaming.id,{customName:renaming.name.trim()});setRenaming(null);}}>
      <div className="modal-heading"><h2>{tr('탭 이름 변경','Rename tab')}</h2></div>
      <label htmlFor="tab-name">{tr('탭 이름','Tab name')}</label><Input id="tab-name" autoFocus maxLength={100} value={renaming.name} onFocus={event=>event.target.select()} onChange={event=>setRenaming({...renaming,name:event.target.value})}/>
      <div className="modal-actions"><Button type="button" variant="outline" size="sm" onClick={()=>setRenaming(null)}>{t('취소')}</Button><Button type="submit" size="sm" disabled={!renaming.name.trim()}>{tr('저장','Save')}</Button></div>
    </form></ModalSurface>}
    {showMaintenance&&<MaintenanceDialog session={active} engine={connection.profile.engine} profile={connection.profile} onClose={()=>setShowMaintenance(false)} onRestored={()=>{setCatalogVersion(v=>v+1);refreshTables();}}/>}
    {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)}/> }
    {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className="toast" data-kind={notice.kind}>{notice.kind === 'error' ? <CircleAlert size={16}/> : notice.kind === 'info' ? <Info size={16}/> : <Check size={16}/>}<span>{notice.text}</span>{notice.kind === 'error' && <Button variant="ghost" size="bare" className="toast-close" aria-label={t('닫기')} title={t('닫기')} onClick={() => setNoticeState(null)}><X size={14}/></Button>}</div>}
    {showConnect && <ConnectionDialog initialProfile={editProfile} initialAws={awsPreset} onClose={() => {setShowConnect(false);setEditProfile(undefined);setAwsPreset(undefined);}} onSave={saveProfile} saveDisabled={!!editProfile&&connections.some(c=>c.profile.id===editProfile.id&&!c.session.startsWith('saved:'))} onPasswordForgotten={passwordForgotten} onConnected={async(profile,session)=>{await acceptConnection(profile,session);setAwsPreset(undefined);setArea('database');}}/>}
    {editing && <ModalSurface title={t("셀 편집")} onClose={() => setEditing(null)} locked={false}><div className="modal cell-modal" role="dialog" aria-modal="true" aria-label={t("셀 편집")}><div className="modal-heading"><h2> {t("셀 편집")} </h2><Button variant="ghost" size="bare" onClick={() => setEditing(null)} aria-label={t("닫기")}><X size={20}/></Button></div><p className="modal-description">{selected?.name} / <strong>{editing.col}</strong> {t("· 행")} {editing.index + 1}</p><Textarea aria-label={t("셀 값")} autoFocus value={editing.value} disabled={editing.isNull} onChange={e => setEditing({...editing,value:e.target.value})} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setDraft(d => ({...d,[`${editing.index}:${editing.col}`]:editing.isNull ? null : editing.value})); setEditing(null); } }}/><p className="field-hint">{tr('Ctrl/Cmd+Enter: 대기열에 추가 · Esc: 취소','Ctrl/Cmd+Enter: stage · Esc: cancel')}</p><label className="checkbox-label"><Input type="checkbox" checked={editing.isNull} onChange={e => setEditing({...editing,isNull:e.target.checked})}/> {t("NULL로 설정")} </label><div className="modal-actions"><Button variant="outline" size="sm" className="secondary-button" onClick={() => setEditing(null)}> {t("취소")} </Button><Button variant="default" size="sm" className="primary-button" onClick={() => {setDraft(d => ({...d,[`${editing.index}:${editing.col}`]:editing.isNull ? null : editing.value}));setEditing(null);}}> {t("변경 대기열에 추가")} </Button></div></div></ModalSurface>}
    {showReview && <ModalSurface title={t("변경 사항 검토")} onClose={() => setShowReview(false)} locked={busy}><div className="modal review-modal" role="dialog" aria-modal="true" aria-label={t("변경 사항 검토")}><div className="modal-heading"><h2> {t("변경 사항 검토")} </h2><Button variant="ghost" size="bare" disabled={busy} onClick={() => setShowReview(false)} aria-label={t("닫기")}><X size={20}/></Button></div><p className="modal-description">{t('검토 설명', {table: `${selected?.schema}.${selected?.name}`, count: edits.length})} {active === 'demo' ? t("데모 데이터에만 반영됩니다.") : t("모든 변경을 하나의 트랜잭션으로 적용합니다.")}</p>{production&&<p className="production-warning" role="note"><AlertTriangle size={14}/>{tr(`운영(PRODUCTION) 연결 "${connection.profile.name}"에 적용합니다.`,`These changes go to the PRODUCTION connection "${connection.profile.name}".`)}</p>}<div className="review-list">{edits.map((edit,i) => <div className="review-row" key={i}><small>{result.columns.filter(c => c.primary).map(c => `${c.name} = ${edit.original[c.name]}`).join(', ')}</small>{Object.entries(edit.changes).map(([col,val]) => <div key={col}><strong>{col}</strong><del>{edit.original[col] ?? 'NULL'}</del><ArrowRight size={14}/><ins>{val ?? 'NULL'}</ins></div>)}</div>)}</div>{error && <p className="dialog-error">{error}</p>}<div className="modal-actions"><Button variant="outline" size="sm" disabled={busy} className="secondary-button" onClick={() => setShowReview(false)}> {t("돌아가기")} </Button><Button variant="default" size="sm" disabled={busy} className="primary-button" onClick={() => void applyChanges()}>{busy ? t("적용 중...") : t('행 적용', {count: edits.length})}</Button></div></div></ModalSurface>}
    {showSettings && <SettingsDialog theme={theme} onThemeChange={next => { saveTheme(next); setTheme(next); }} sidebarOpen={sidebarOpen} onSidebarChange={setSidebarOpen} onClose={() => setShowSettings(false)}/> }
    {showHelp && <ModalSurface title={t("도움말")} onClose={() => setShowHelp(false)} locked={false}><div className="modal help-modal" role="dialog" aria-modal="true" aria-label={t("도움말")}><div className="modal-heading"><h2> {t("도움말")} </h2><Button variant="ghost" size="bare" onClick={() => setShowHelp(false)} aria-label={t("닫기")}><X size={20}/></Button></div><div className="help-content"><table className="shortcut-table"><caption>{tr('단축키','Keyboard shortcuts')} · {tr('Mac에서는 Ctrl 대신 Cmd','Use Cmd instead of Ctrl on macOS')}</caption><tbody>{([
        ['Ctrl + Enter', tr('선택한 SQL 또는 커서가 있는 구문 실행','Run the selection or the statement at the cursor')],
        ['Ctrl + Shift + Enter', tr('편집기 전체를 스크립트로 실행','Run the whole editor as a script')],
        ['Esc', tr('실행 중인 쿼리 중지 · 대화상자 닫기','Stop the running query · close dialogs')],
        ['F5', tr('결과 또는 목록 새로고침','Refresh results or lists')],
        ['Ctrl + S', tr('SQL 파일 저장','Save SQL file')],
        ['Ctrl + T / Ctrl + W', tr('새 쿼리 탭 / 현재 탭 닫기','New query tab / close tab')],
        ['Ctrl + B', tr('사이드바 접기/펼치기','Toggle sidebar')],
        ['Ctrl + Alt + B', tr('쿼리 기록 패널 열기/닫기','Toggle the query history panel')],
        ['Ctrl + ,', tr('설정','Settings')],
        ['F2', tr('탭 이름 변경 (탭에 포커스)','Rename the focused tab')],
        ['Alt + ← / →', tr('탭 순서 이동','Move the focused tab')],
        ['Shift + F10', tr('컨텍스트 메뉴','Context menu')],
      ] as const).map(([keys,label])=><tr key={keys}><td><kbd>{keys}</kbd></td><td>{label}</td></tr>)}</tbody></table><p><strong> {t("결과 편집")} </strong> {t("테이블 보기에서 셀 더블클릭 → 변경 검토 → 적용. 기본키와 생성 열은 수정할 수 없습니다.")} </p><p><strong> {t("연결")} </strong> {tr("PostgreSQL·MySQL·MariaDB·SQLite에 연결합니다. 프로필과 SQL 탭을 저장합니다. 비밀번호는 선택 시 Windows 자격 증명 관리자에 암호화하여 저장하며, 다음 실행 시 마지막 연결에 자동 접속합니다.","Connect to PostgreSQL, MySQL, MariaDB or SQLite. Profiles and SQL tabs are saved. Passwords can be encrypted in Windows Credential Manager to reconnect to the last connection on startup.")} </p><p><strong> {t("쿼리 실행")} </strong> {tr("스크립트 실행·매개변수·수동 커밋을 지원합니다. 테이블의 데이터 도구에서 페이징과 가져오기·내보내기를 사용할 수 있습니다.","Scripts, parameters and manual commit are available. Open Data tools for paging, import and export.")} </p></div><Button variant="default" size="sm" className="primary-button full" onClick={() => setShowHelp(false)}> {t("확인")} </Button></div></ModalSurface>}
  </div>;
}
