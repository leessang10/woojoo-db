import { ConnectionSwitcher } from './ConnectionSwitcher';
import { CommonSqlDialog } from './CommonSqlDialog';
import { useConfirm } from './components/ConfirmProvider';
import { ExecutionsPage, type ExecutionEntry } from './ExecutionsPage';
import { listen } from '@tauri-apps/api/event';
import { ScrollText } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import DataWorkbench from './DataWorkbench';
import { MaintenanceDialog } from './MaintenanceDialog';
import type { DataFilter, CopyTarget } from './data-workbench';
import { QueryTools } from './QueryTools';
import { queryOrigin } from './query-origin';
import { appendQueryHistory, sqlTokens, type ScriptResult } from './sql-workbench';
import { readProfiles, writeProfiles } from './profile-storage';
import { persistTabs } from './workspace-tabs';
import { ConnectionDialog } from "./ConnectionDialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ModalSurface } from "@/components/ModalSurface";
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
import { ObjectPage } from './ObjectPage';
import { createTab, isDirty, useWorkspaceTabs, type WorkspaceTab } from './workspace-tabs';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp, Database, FileCode2, Filter, KeyRound, Layers3, Loader2, Plus, RefreshCw, Search, Settings2, Table2, Terminal, Undo2, X } from 'lucide-react';
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
const ErdPage = lazy(() => import('./ErdPage'));

export default function App() {
  const { language, setLanguage, t } = useLanguage();
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
  const [tableList, setTableList] = useState<Table[]>([]);
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
  const [notice, setNotice] = useState('');
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
  const [showExecutions,setShowExecutions]=useState(false);
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
  useEffect(()=>{if(!api.desktop)return;const subscription=listen<string>("execution-log-error",event=>setNotice(event.payload)).catch(()=>()=>{});return()=>{void subscription.then(unlisten=>unlisten()).catch(()=>{});};},[]);
  const [scroll, setScroll] = workspace.field('scroll');
  const [sort, setSort] = workspace.field('sort');
  const [editing, setEditing] = useState<{ index: number; col: string; value: string; isNull: boolean } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => { try { return localStorage.getItem('woojoo-sidebar') !== 'closed'; } catch { return true; } });
  function toggleSidebar() { setSidebarOpen(open => !open); }
  useEffect(() => { try { localStorage.setItem('woojoo-sidebar', sidebarOpen ? 'open' : 'closed'); } catch { /* Session-only preference. */ } }, [sidebarOpen]);
  const [databaseOpen, setDatabaseOpen] = useState(true);
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(new Set());
  const hasDialog = !!renaming || confirming || showMaintenance || showConnect || showReview || showHelp || showSettings || showCommonSql || !!editing;
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
  const allTabsRef = useRef(workspace.tabs); allTabsRef.current = workspace.tabs;
  const askDiscard = async () => !Object.keys(draftRef.current).length || await requestConfirm(t("저장하지 않은 변경 사항을 버릴까요?"));
  useEffect(()=>{try{writeProfiles(connections.filter(c=>c.session!=='demo').map(c=>c.profile));localStorage.setItem('woojoo-active-profile',connection.profile.id);}catch{setNotice(tr('저장 공간이 부족해 프로필을 저장하지 못했습니다.','Could not save profiles: storage unavailable.'));}},[connections,active]);
  useEffect(()=>{const timer=setTimeout(()=>{try{persistTabs(workspace.tabs,Object.fromEntries(connections.map(c=>[c.session,c.profile.id])),tab.id);}catch{setNotice(tr('작업 공간을 저장하지 못했습니다.','Could not save workspace.'));}},250);return()=>clearTimeout(timer);},[workspace.tabs,connections,tab.id]);
  async function confirmDisconnect(session:string){if(session==='demo'||session.startsWith('saved:'))return true;try{const state=await invoke<{inTransaction:boolean;transactionStateKnown?:boolean}>('execution_state',{id:session});if(state.inTransaction||state.transactionStateKnown===false)return await requestConfirm(tr('진행 중이거나 상태를 확인할 수 없는 트랜잭션이 있습니다. 커밋하지 않은 변경을 롤백하고 연결을 끊을까요?','A transaction is active or its state is unknown. Disconnect and roll back uncommitted changes?'));}catch{/* Disconnected sessions have no usable transaction. */}return true;}
  async function disconnectProfile(c:Connection){
    if(allTabsRef.current.some(tab=>tab.session===c.session&&tab.busy))return;
    if(allTabsRef.current.some(tab=>tab.session===c.session&&(Object.keys(tab.draft).length||dataDirtyRef.current[tab.id]))&&!await requestConfirm(tr('저장하지 않은 데이터 변경을 버리고 연결을 끊을까요?','Discard pending data edits and disconnect?')))return;
    if(!await confirmDisconnect(c.session))return;
    try{await api.disconnect(c.session);const session='saved:'+c.profile.id;workspace.remapSession(c.session,session);setConnections(list=>list.map(item=>item===c?{...c,session}:item));if(active===c.session)setActive(session);}catch(e){announce(String(e));}
  }
  async function deleteProfile(c:Connection){
    if(allTabsRef.current.some(tab=>tab.session===c.session&&tab.busy))return;
    if(!await requestConfirm(tr('연결 프로필과 저장된 SQL 탭을 삭제할까요?','Delete this connection profile and its saved SQL tabs?')))return;
    if(!await confirmDisconnect(c.session))return;
    try{if(!c.session.startsWith('saved:'))await api.disconnect(c.session);await api.forgetPassword(c.profile.id);workspace.removeSession(c.session);setConnections(list=>list.filter(item=>item!==c));if(active===c.session)setActive('demo');}catch(e){announce(String(e));}
  }
  async function leaveData(){if(advanced[tab.id]&&tab.busy)return false;if(!dataDirtyRef.current[tab.id])return true;if(!await requestConfirm(tr('저장하지 않은 데이터 변경을 버릴까요?','Discard pending data edits?')))return false;return true;}
  async function selectConnection(id:string){if(id!==active&&!await leaveData())return;setActive(id);setShowExecutions(false);}
  async function openExecution(entry:ExecutionEntry){const target=connections.find(c=>c.profile.id===entry.profileId);if(!target||!await leaveData())return;workspace.add(null,entry.sql,target.session);setActive(target.session);setShowExecutions(false);editorSelection.current="";}
  async function saveProfile(profile:Profile){
    if(!await leaveData())return;
    const old=connections.find(c=>c.profile.id===profile.id);
    if(old&&!old.session.startsWith('saved:')){announce(tr('연결 중인 프로필은 먼저 연결을 끊은 후 수정하세요.','Disconnect before editing an active profile.'));return;}
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
        if(tabs.some(tab=>Object.keys(tab.draft).length||dataDirtyRef.current[tab.id])&&!await requestConfirm(tr('저장하지 않은 데이터 변경을 버리고 다시 연결할까요?','Discard pending data edits and reconnect?')))throw new Error(tr('다시 연결이 취소되었습니다.','Reconnection cancelled.'));
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
    }catch(e){announce(tr('다시 연결하지 못했습니다. 비밀번호를 확인하세요. ','Could not reconnect. Check your password. ')+String(e));setEditProfile(profile);setShowConnect(true);}
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
      }catch(e){if(current()){announce(tr('자동 연결하지 못했습니다. 비밀번호를 확인하고 다시 연결하세요. ','Automatic connection failed. Check your password and reconnect. ')+String(e));setEditProfile(profile);setShowConnect(true);}}
      finally{if(!cancelled)setReconnecting(false);}
    })();
    return()=>{cancelled=true;};
  },[]);
  function announce(text: string) { setNotice(text); window.setTimeout(() => setNotice(''), 4500); }
  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); announce(t('복사됨')); }
    catch { announce(t('클립보드에 복사하지 못했습니다.')); }
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
    if (item.kind === 'erd') return `${item.objectSchema} · ERD`;
    if (item.kind === 'schema') return item.objectSchema;
    if (item.kind === 'details') return `${item.selected?.name} · ${t('구조')}`;
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
  async function activateTab(id: string) { if(id!==tab.id&&!await leaveData())return; editorSelection.current = ''; setEditing(null); setShowReview(false); workspace.activate(id); setShowExecutions(false); return true; }
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
  async function addQuery(sql = '') { if(emptyWorkspace)return;if(!await leaveData())return;editorSelection.current = ''; workspace.add(null, sql); setShowExecutions(false); }
  async function closeTab(item: WorkspaceTab) {
    if (item.busy || pending.current.has(item.id)) return;
    if ((isDirty(item)||dataDirty[item.id]) && !await requestConfirm(t('탭 닫기 확인'))) return;
    editorSelection.current = ''; editorStates.current.delete(item.id); workspace.close(item.id);
  }
  async function closeTabs(items: WorkspaceTab[]) {
    if (!items.length || items.some(item => item.busy || pending.current.has(item.id))) return;
    if (items.some(item => isDirty(item) || dataDirty[item.id]) && !await requestConfirm(tr(
      `${items.length}개 탭을 닫을까요? 저장하지 않은 SQL과 변경 사항은 사라집니다.`,
      `Close ${items.length} tabs? Unsaved SQL and changes will be discarded.`,
    ))) return;
    if (items.some(item => pending.current.has(item.id))) return;
    editorSelection.current = '';
    items.forEach(item => editorStates.current.delete(item.id));
    workspace.closeMany(items.map(item => item.id));
  }
  async function openTable(table: Table, refresh = false) {
    const existing = workspace.connectionTabs.find(item => item.kind === 'table' && item.selected?.name === table.name && item.selected.schema === table.schema);
    if (!refresh && existing) { activateTab(existing.id); return; }
    if (refresh && !await askDiscard()) return;
    if(!refresh&&!await leaveData())return;
    setShowExecutions(false);
    const target = refresh ? tab : workspace.add(table, tableQuery(connection.profile.engine, table.schema, table.name));
    await performFor(target.id, async () => {
      const data = await api.readTable(active, table);
      const sql = tableQuery(connection.profile.engine, table.schema, table.name);
      workspace.patch(target.id, { selected: table, source: 'table', result: data, resultStale:false, draft: {}, filter: '', sort: null, scroll: 0, editorSql: sql, initialSql: sql, loaded: true, lastQuery: '' });
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
        workspace.patch(item.id,{selected:renamed,resultStale:false,result:await api.readTable(session,renamed),draft:{},sort:null,filter:'',scroll:0,error:'',...(item.editorSql===item.initialSql?{editorSql:sql,initialSql:sql}:{})});
      }
    }
  }
  async function openSchema(schema: string) {
    const existing = workspace.connectionTabs.find(item => item.kind === 'schema' && item.objectSchema === schema);
    if (existing) { activateTab(existing.id); return; }
    if(!await leaveData())return;
    setShowExecutions(false);
    const next = workspace.add();
    workspace.patch(next.id, { kind: 'schema', objectSchema: schema, loaded: true });
  }
  async function openErd(schema: string) {
    const existing = workspace.connectionTabs.find(item => item.kind === 'erd' && item.objectSchema === schema);
    if (existing) { activateTab(existing.id); return; }
    if (!await leaveData()) return;
    setShowExecutions(false);
    const next = workspace.add();
    workspace.patch(next.id, { kind: 'erd', objectSchema: schema, loaded: true });
  }
  async function openDetails(table: Table, refresh = false) {
    const existing = workspace.connectionTabs.find(item => item.kind === 'details' && item.selected?.schema === table.schema && item.selected.name === table.name);
    if (existing && !refresh) { activateTab(existing.id); return; }
    if(!existing&&!await leaveData())return;
    setShowExecutions(false);
    const next = existing ?? workspace.add(table);
    if(existing && !await activateTab(next.id))return;
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
    if(!connected){setTableList([]);setBusy(false);return;}
    busyRef.current = true; setBusy(true);
    setTableList([]);
    api.tables(active).then(async list => {
      if (token !== op.current) return;
      setTableList(list);
      if(list.length&&!workspace.connectionTabs.length){const table=list[0],sql=tableQuery(connection.profile.engine,table.schema,table.name);workspace.patch(tab.id,{kind:'table',selected:table,source:'table',objectSchema:table.schema,editorSql:sql,initialSql:sql,loaded:false});}

    }).catch(e => { if (token === op.current) setError(String(e)); })
      .finally(() => { if (!pending.current.has(tab.id)) setBusy(false); });
    return () => { op.current++; };
  }, [active]);
  useEffect(()=>{let cancelled=false;void Promise.all(connections.filter(c=>(fixtureMode||c.session!=='demo')&&!c.session.startsWith('saved:')&&!c.profile.readOnly).map(async c=>(await api.tables(c.session)).map(table=>({session:c.session,engine:c.profile.engine,label:c.profile.name+' / '+table.schema+'.'+table.name,table})))).then(lists=>{if(!cancelled)setCopyTargets(lists.flat());}).catch(()=>{if(!cancelled)setCopyTargets([]);});return()=>{cancelled=true;};},[connections,catalogVersion]);
  useEffect(()=>{if(connected&&tab.kind==='table'&&tab.selected&&!tab.loaded&&!pending.current.has(tab.id)){void performFor(tab.id,async()=>{workspace.patch(tab.id,{resultStale:false,result:await api.readTable(active,tab.selected!),loaded:true});});}},[active,tab.id,tab.loaded,tab.kind,tab.selected?.name,tab.selected?.schema]);
  useEffect(()=>{if(connected&&tab.kind==='details'&&tab.selected&&!tab.loaded&&!pending.current.has(tab.id)){void performFor(tab.id,async()=>{workspace.patch(tab.id,{details:await api.describeTable(active,tab.selected!),loaded:true});});}},[active,tab.id,tab.loaded]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (confirming || renaming) return;
      if (showSettings) {
        if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key === ',')) event.preventDefault();
        if (event.key === 'Escape') setShowSettings(false);
        return;
      }
      if (showConnect || showReview || showHelp || editing || showExecutions) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.preventDefault();
        if (event.key === 'Escape' && !busyRef.current) {
          setEditing(null); setShowReview(false); setShowHelp(false);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); setShowSettings(true); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleSidebar(); }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); runRef.current(); }
      if (event.key === 'Escape') { setEditing(null); setShowHelp(false); }
    };
    const leave = (event: BeforeUnloadEvent) => { if (allTabsRef.current.some(isDirty)||Object.values(dataDirty).some(Boolean)) event.preventDefault(); };
    window.addEventListener('keydown', key); window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', leave); };
  }, [confirming, renaming, showConnect, showReview, showHelp, showSettings, editing,showExecutions,dataDirty]);
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = scroll;
  }, [tab.id, scroll]);
  const executeQuery = async (text: string) => {
    if(!connected){setEditProfile(emptyWorkspace?undefined:connection.profile);setShowConnect(true);return;}
    if (pending.current.has(tab.id) || !await askDiscard() || !text || !await leaveData()) return;
    let objectScript=false;
    if(api.desktop&&(connection.profile.engine==='mysql'||connection.profile.engine==='mariadb')){try{const code=sqlTokens(text,connection.profile.engine).filter(token=>token.kind==='code').map(token=>token.text).join(' ').trimStart().slice(0,400);objectScript=/^CREATE\b[\s\S]*\b(PROCEDURE|FUNCTION|TRIGGER|VIEW|EVENT)\b/i.test(code);}catch{/* The normal execution path reports syntax errors. */}}
    if(objectScript&&!await requestConfirm(tr('객체 정의를 서버 SQL 스크립트로 실행합니다. 편집기의 전체 SQL이 실행되며 MySQL DDL은 암묵적으로 커밋됩니다. 계속할까요?','Execute this object definition as a server SQL script? The entire editor input will run and MySQL DDL commits implicitly.')))return;
    if (pending.current.has(tab.id)) return;
    void perform(async () => {
      const start=performance.now();let data:Result;try{data=objectScript?await invoke<Result>('run_object_sql',{id:active,sql:text}):await api.query(active,text);}catch(e){appendQueryHistory({id:crypto.randomUUID(),sql:text,engine:connection.profile.engine,at:new Date().toISOString(),success:false,count:1,connection:connection.profile.id,connectionName:connection.profile.name,duration:performance.now()-start,durationScope:'total'});throw e;}
      appendQueryHistory({id:crypto.randomUUID(),sql:text,engine:connection.profile.engine,at:new Date().toISOString(),success:true,count:1,connection:connection.profile.id,connectionName:connection.profile.name,duration:data.elapsedMs,durationScope:'db'});
      const origin=queryOrigin(text,tableList);
      if(origin){try{const metadata=await api.describeTable(active,origin);if(metadata.filter(c=>c.primary).every(c=>data.columns.some(col=>col.name===c.name)))data={...data,columns:data.columns.map(col=>({...col,...metadata.find(c=>c.name===col.name)}))};else workspace.patch(tab.id,{queryTable:null});}catch{workspace.patch(tab.id,{queryTable:null});}}
      workspace.patch(tab.id,{queryTable:origin});
      workspace.markQuery(tab.id);
      setLastQuery(text);
      setResult(data); setSource('query'); setDraft({}); setFilter(''); setSort(null); setScroll(0);
    });
  };
  const run = () => { if (workspace.connectionTabs.length && (tab.kind === 'table' || tab.kind === 'query')) executeQuery(editorSelection.current.trim() || editorSql.trim()); };
  runRef.current = run;
  async function applyChanges() {
    const target=source==='query'?tab.queryTable:selected;
    if (!target) return;
    await perform(async () => {
      const count = await api.save(active, target, edits);
      setDraft({}); setShowReview(false);
      announce(t('변경 적용됨', {count}) + (active === 'demo' ? ' · ' + t('데모 저장 안내') : ''));
      const refreshed=source==='query'?await api.query(active,lastQuery):await api.readTable(active,target);setResult(source==='query'?{...refreshed,columns:result.columns}:refreshed);
    });
  }
  function exportCsv() {
    const content = csv(result.columns.map(c => c.name), result.rows);
    const url = URL.createObjectURL(new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${selected?.name ?? 'query'}-results.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function refreshResults() {
    if (busy) return;
    if (source === 'query') {
      if (lastQuery && (/^\s*select\b/i.test(lastQuery) || await requestConfirm(t('마지막 쿼리를 다시 실행할까요? 데이터를 변경하는 SQL은 다시 적용됩니다.')))) executeQuery(lastQuery);
    } else if (selected) void openTable(selected, true);
  }
  const refreshTables = () => connected && void perform(async () => {
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
  useEffect(()=>{let cancelled=false;setCompletionSchema({});if(!connected)return;let cursor=0;const fields:Record<string,string[]>={};const worker=async()=>{while(!cancelled&&cursor<tableList.length){const table=tableList[cursor++];try{const cols=await api.describeTable(active,table);if(cancelled)return;fields[table.schema+'.'+table.name]=cols.map(c=>c.name);if(tableList.filter(t=>t.name===table.name).length===1)fields[table.name]=cols.map(c=>c.name);setCompletionSchema({...fields});}catch{/* A metadata failure must not prevent SQL editing. */}}};void Promise.all(Array.from({length:Math.min(3,tableList.length)},worker));return()=>{cancelled=true;};},[active,tableList,catalogVersion]);
  const visibleTables = tableList.filter(t => `${t.schema}.${t.name}`.toLowerCase().includes(search.toLowerCase()));
  const schemas = [...new Set(visibleTables.map(t => t.schema))];
  const selectableConnections = connections.filter(c=>fixtureMode||c.session!=='demo').sort((a,b)=>(a.profile.group??'').localeCompare(b.profile.group??'')||a.profile.name.localeCompare(b.profile.name));
  const currentConnection = selectableConnections.find(c=>c.session===active);
  return <div className="app">
    <aside className="rail">
      <span className="brand-mark" aria-label="Woojoo">W</span>
      <Button variant="ghost" size="bare" className={`rail-button ${!showExecutions ? 'selected' : ''}`} aria-current={!showExecutions ? 'page' : undefined} aria-label={t("데이터베이스")} title={t("데이터베이스")} onClick={() => setShowExecutions(false)}><Database size={21}/></Button>
      <Button variant="ghost" size="bare" className={`rail-button ${showExecutions?'selected':''}`} title={tr("실행한 쿼리","Executed queries")} aria-label={tr("실행한 쿼리","Executed queries")} aria-current={showExecutions ? 'page' : undefined} onClick={()=>setShowExecutions(true)}><ScrollText size={21}/></Button>
      <div className="rail-bottom"><Button variant="ghost" size="bare" className="rail-button" title={themeLabel} aria-label={themeLabel} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={21}/> : <Moon size={21}/>}</Button><Button variant="ghost" size="bare" className="rail-button" title={t("설정") + " · Ctrl/Cmd+,"} aria-label={t("설정")} onClick={() => setShowSettings(true)}><Settings2 size={21}/></Button><Button variant="ghost" size="bare" className="rail-button" title={t("도움말")} onClick={() => setShowHelp(true)}><CircleHelp size={21}/></Button></div>
    </aside>
    {sidebarOpen && <aside className="sidebar" id="database-sidebar" onContextMenu={event => { if (event.target instanceof HTMLInputElement) return; menuFor([{label:t("연결 추가"),action:()=>setShowConnect(true)},{label:t("목록 새로고침"),action:refreshTables,disabled:busy}]).onContextMenu(event); }}>
      <div className="workspace-brand"><span>Woojoo</span></div>
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
        <span className="connection-name"><span className="connection-title" title={c.profile.name}>{c.profile.name}</span>{(c.profile.group||c.profile.environment||c.profile.readOnly)&&<small>{[c.profile.group,c.profile.environment,c.profile.readOnly?'RO':null].filter(Boolean).join(' · ')}</small>}<small>{c.profile.engine === 'sqlite' ? 'SQLite' : c.profile.engine === 'postgres' ? 'PostgreSQL' : c.profile.engine === 'mariadb' ? 'MariaDB' : 'MySQL'} {c.profile.engine!=='sqlite'&&<span>· {c.session === 'demo' ? 'Demo' : c.profile.host}</span>}</small></span><span className={`live-dot ${c.session.startsWith('saved:')?'offline':''}`} data-environment={c.session.startsWith('saved:')?undefined:c.profile.environment}/>
      <ChevronDown size={14}/></Button>;})() : <Button variant="ghost" size="bare" className="connection connection-placeholder" aria-label={tr('연결 전환','Switch connection')}><Database size={18}/><span>{t('연결 선택')}</span><ChevronDown size={14}/></Button>}</ConnectionSwitcher>}</div>
      {!emptyWorkspace&&<><Separator className="divider"/>
      <div className="section-label"> {t("테이블")} <Button variant="ghost" size="bare" title={t("목록 새로고침")} disabled={busy} onClick={() => void perform(async () => { const list = await api.tables(active); if (activeSessionRef.current === active) setTableList(list); })}><RefreshCw size={14}/></Button></div>
      <label className="search-field"><Search size={14}/><Input aria-label={t("테이블 검색")} placeholder={t("테이블 검색")} value={search} onChange={e => setSearch(e.target.value)}/></label>
      <div className="tree">
        <Button variant="ghost" size="bare" className="tree-db" aria-expanded={databaseOpen || !!search} onClick={() => {setSearch('');setDatabaseOpen(v => !v);}}>{databaseOpen || search ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<Database size={15}/><span>{connection.profile.database}</span><span className="count">{tableList.length}</span></Button>
        {(databaseOpen || !!search) && schemas.map(schema => <div key={schema}><div className="schema-tree-row"><Button variant="ghost" size="bare" className="schema-expander icon-button" aria-label={t('스키마 펼치기/접기') + ': ' + schema} aria-expanded={!collapsedSchemas.has(schema) || !!search} onClick={() => {setSearch('');setCollapsedSchemas(previous => {const next=new Set(previous);if(next.has(schema))next.delete(schema);else next.add(schema);return next;});}}>{!collapsedSchemas.has(schema)||search?<ChevronDown size={13}/>:<ChevronRight size={13}/>}</Button><Button variant="ghost" size="bare" className="tree-schema" {...menuFor([{label:t("스키마 상세"),action:()=>openSchema(schema)},{label:t("ERD 열기"),action:()=>openErd(schema)},{label:t("이름 복사"),action:()=>void copyText(schema)},{label:t("목록 새로고침"),action:refreshTables,disabled:busy}])} onClick={() => openSchema(schema)}><Layers3 size={14}/>{schema}</Button><Button variant="ghost" size="bare" className="schema-open icon-button" aria-label={t("스키마 상세 이름", {name:schema})} title={t("스키마 상세")} onClick={() => openSchema(schema)}><ArrowRight size={13}/></Button></div>
          {(!collapsedSchemas.has(schema) || !!search) && visibleTables.filter(t => t.schema === schema).map(t => <Button variant="ghost" size="bare" key={`${t.schema}.${t.name}`} {...menuFor(tableMenu(t))} disabled={busy} className={`tree-table ${selected?.name === t.name && selected.schema === t.schema ? 'active' : ''}`} onClick={() => void openDetails(t)}><Table2 size={14}/><span>{t.name}</span>{selected?.name === t.name && <span className="table-dot"/>}</Button>)}
        </div>)}
        {!visibleTables.length && <p className="empty-tree"> {t("표시할 테이블이 없습니다.")} </p>}
      </div></>}
    </aside>}
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><Button variant="ghost" size="bare" className="icon-button sidebar-toggle" aria-label={t(sidebarOpen ? '사이드바 접기' : '사이드바 펼치기')} title={t(sidebarOpen ? '사이드바 접기' : '사이드바 펼치기') + ' · Ctrl/Cmd+B'} aria-expanded={sidebarOpen} aria-controls="database-sidebar" onClick={toggleSidebar}>{sidebarOpen ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}</Button>{!emptyWorkspace&&<><Database size={14}/><span>{connection.profile.database}</span><ChevronRight size={13}/><strong>{tab.kind === 'schema' || tab.kind === 'erd' ? tab.objectSchema : selected?.schema ?? 'SQL'}</strong></>}</div><div className="topbar-right"><NativeSelect size="sm" className="language-select" aria-label="언어 / Language" value={language} onChange={event => setLanguage(event.target.value as 'ko' | 'en')}><NativeSelectOption value="ko">한국어</NativeSelectOption><NativeSelectOption value="en">English</NativeSelectOption></NativeSelect>{!emptyWorkspace&&<Badge variant="secondary" className="mode-tag" title={active === 'demo' ? t("샘플 데이터 · 앱을 다시 열면 초기화됩니다") : connection.profile.tls ? t("TLS 인증서 검증 사용") : t("TLS 사용 안 함")}>{active === 'demo' ? t("데모") : !connected?tr('연결 끊김','Disconnected'):t("연결됨")}</Badge>}<Button variant="ghost" size="bare" className="subtle-button" onClick={() => setShowConnect(true)}><Plus size={14}/> {t("연결 추가")} </Button></div></header>
      {showExecutions&&<ExecutionsPage onClose={()=>setShowExecutions(false)} onOpen={openExecution} profileIds={connections.filter(c=>c.session!=="demo").map(c=>c.profile.id)}/>}
      <div style={{display:showExecutions?"none":"contents"}}>
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
          }} className="tab" title={tabName(item)} onClick={() => {if(suppressTabClick.current){suppressTabClick.current=false;return;}void activateTab(item.id);}}>{item.busy ? <Loader2 size={14} className="spin"/> : item.kind === 'erd' ? <GitBranch size={14}/> : item.kind === 'schema' ? <Layers3 size={14}/> : item.kind === 'table' || item.kind === 'details' ? <Table2 size={14}/> : <FileCode2 size={14}/>}<span>{tabName(item)}</span>{isDirty(item) && <i className="tab-dirty" aria-hidden="true"/>}</Button>
          <Button variant="ghost" size="bare" className="tab-close" aria-label={t('탭 닫기 이름', {name:tabName(item)})} title={t('탭 닫기')} disabled={item.busy} onClick={() => closeTab(item)}><X size={13}/></Button>
        </div>)}
      </div><Button variant="ghost" size="bare" className="tab-add" title={t('새 쿼리')} onClick={() => addQuery()}><Plus size={17}/></Button></div>
      {showCommonSql && <CommonSqlDialog key={active} engine={connection.profile.engine} onClose={() => setShowCommonSql(false)} onSelect={sql => { setShowCommonSql(false); void addQuery(sql); }}/>}
      {!connected?<div className="workspace-empty"><Database size={28}/><h2>{connection.profile.name}</h2><Button disabled={reconnecting} onClick={()=>void reconnectProfile(connection.profile)}>{reconnecting?tr('연결 중…','Connecting…'):tr('다시 연결','Reconnect')}</Button></div>:!workspace.connectionTabs.length?<div className="workspace-empty"><FileCode2 size={28}/><h2>{tr('열린 탭이 없습니다','No open tabs')}</h2><Button size="sm" onClick={()=>void addQuery()}><Plus size={14}/>{t('새 쿼리')}</Button></div>:tab.kind === 'erd' ? <Suspense fallback={<div className="object-empty">{t('ERD 생성 중…')}</div>}><ErdPage key={tab.id+catalogVersion} session={active} schema={tab.objectSchema} theme={theme} initial={tab.erd} readOnly={connection.profile.readOnly}
        onBusyChange={value=>workspace.patch(tab.id,{busy:value})}
        canApply={()=>!allTabsRef.current.some(item=>item.session===active&&item.id!==tab.id&&(item.busy||Object.keys(item.draft).length||dataDirtyRef.current[item.id]))}
        onApplied={()=>{for(const item of allTabsRef.current.filter(item=>item.session===active&&item.id!==tab.id)){if(item.kind==='details'||item.kind==='table')workspace.patch(item.id,{loaded:false});if(item.kind==='erd')workspace.patch(item.id,{erd:null});}setCatalogVersion(v=>v+1);refreshTables();}}
        storageKey={'woojoo-erd-v1:' + JSON.stringify([connection.profile.engine,connection.profile.host,connection.profile.port,connection.profile.database,connection.profile.username,tab.objectSchema])}
        onChange={erd => workspace.patch(tab.id,{erd})}/></Suspense> : tab.kind === 'schema' || tab.kind === 'details' ? <ObjectPage key={tab.id} session={active} engine={connection.profile.engine} revision={catalogVersion} onSql={addQuery} readOnly={connection.profile.readOnly} onChanged={structureChanged} changeBlocked={table=>!!connection.profile.readOnly||changeBlocked(table)} tab={tab} database={connection.profile.database} tables={tableList} onFilter={setFilter}
        onRefresh={() => tab.kind === 'schema' ? refreshTables() : tab.selected && void openDetails(tab.selected,true)}
        onSchema={openSchema} onErd={openErd} onDetails={table => void openDetails(table)} onData={table => void openTable(table)}
        onQuery={table => addQuery(tableQuery(connection.profile.engine,table.schema,table.name))} tableMenu={tableMenu} menuFor={menuFor}/> : <>
      <section {...menuFor(() => [
        {label:t('실행'),action:run,disabled:busy||!editorSql.trim()},
        {label:t('선택한 SQL 복사'),action:()=>void copyText(editorSelection.current),disabled:!editorSelection.current},
        {label:t('전체 SQL 복사'),action:()=>void copyText(editorSql),disabled:!editorSql},
        {label:t('새 쿼리'),action:()=>addQuery(),divider:true},
      ])} className="editor-pane" id="query-panel" role="tabpanel" aria-labelledby={`tab-${tab.id}`}>
        <QueryTools onOpenCommonSql={() => setShowCommonSql(true)} commonSqlDisabled={!connected || busy} primaryAction={<><Button variant="ghost" size="sm" aria-expanded={!editorCollapsed} aria-controls="sql-editor" onClick={()=>workspace.patch(tab.id,{editorCollapsed:!editorCollapsed})}>{editorCollapsed?tr("SQL 펼치기","Show SQL"):tr("SQL 접기","Hide SQL")}</Button><Button variant="default" size="sm" className="run-button" title={tr("선택한 SQL 또는 전체 구문 실행 · Ctrl/Cmd + Enter","Run selected SQL or the editor · Ctrl/Cmd + Enter")} disabled={!connected || busy || !editorSql.trim()} onClick={run}>{busy ? <Loader2 size={14} className="spin"/> : <Play size={14}/>} {t("실행")} </Button></>} key={`tools-${tab.id}`} engine={connection.profile.engine} session={active} beforeExecute={async()=>await askDiscard()&&await leaveData()} connectionName={connection.profile.name} historyKey={connection.profile.id} initialFile={tab.file} sql={editorSql} disabled={busy} onSqlChange={setEditorSql} onFileChange={file=>{workspace.markQuery(tab.id);workspace.patch(tab.id,{file,initialSql:file.savedSql});}} onBusyChange={value=>{if(value)pending.current.add(tab.id);else pending.current.delete(tab.id);workspace.patch(tab.id,{busy:value});}} onExecute={text=>api.query(active,text)} onResults={results=>{setScriptResults(previous=>({...previous,[tab.id]:results}));const last=results.at(-1);workspace.markQuery(tab.id);if(last?.result)workspace.patch(tab.id,{result:last.result,resultStale:false,source:'query',draft:{},queryTable:null,lastQuery:last.sql,error:''});if(last?.error)workspace.patch(tab.id,{error:last.error,resultStale:true});}}/>
        <div id="sql-editor" className="sql-editor" hidden={editorCollapsed}><CodeMirror key={tab.id} value={editorSql} height="100%" theme={theme === 'dark' ? oneDark : 'light'} editable={!busy} extensions={[sqlLanguage({dialect: connection.profile.engine === 'sqlite'?SQLite:connection.profile.engine === 'postgres' ? PostgreSQL : MySQL, schema: completionSchema})]} onChange={setEditorSql} onCreateEditor={view => { const saved = editorStates.current.get(tab.id); if (saved && saved.doc.toString() === editorSql) { view.setState(saved); editorSelection.current = saved.sliceDoc(saved.selection.main.from, saved.selection.main.to); } }} onUpdate={u => { editorStates.current.set(tab.id, u.state); editorSelection.current = u.state.sliceDoc(u.state.selection.main.from, u.state.selection.main.to); }} basicSetup={{lineNumbers: true, foldGutter:false, highlightActiveLine:true, autocompletion:true}}/></div>
      </section>
      {selected&&source==='table'&&<div className="data-tool-switch"><Button variant="outline" size="sm" onClick={async()=>{if((dataDirty[tab.id]||edits.length)&&!await requestConfirm(tr('저장하지 않은 데이터 변경을 버릴까요?','Discard pending data edits?')))return;setDraft({});setAdvanced(previous=>({...previous,[tab.id]:!previous[tab.id]}));}}>{advanced[tab.id]?tr('간단한 보기','Simple view'):tr('데이터 도구','Data tools')}</Button><span>{advanced[tab.id]?tr('필터 · 페이징 · 행 편집 · 가져오기 · 내보내기','Filter · paging · row editing · import · export'):''}</span></div>}
      {!!scriptResults[tab.id]?.length&&<div className="script-result-tabs">{scriptResults[tab.id].map(item=><Button key={item.index} variant="outline" size="sm" onClick={()=>{if(item.result)workspace.patch(tab.id,{result:item.result,resultStale:false,lastQuery:item.sql,source:'query',queryTable:null,error:''});else workspace.patch(tab.id,{error:item.error??'',resultStale:true});}}>{tr('결과','Result')} {item.index} · {item.error?'Error':item.result?.rows.length+' rows'}</Button>)}</div>}
      {advanced[tab.id]&&selected&&source==='table'?<DataWorkbench key={tab.id} session={active} engine={connection.profile.engine} table={selected} readOnly={connection.profile.readOnly} initialResult={result} initialFilters={initialFilters[tab.id]} targets={copyTargets} onBusyChange={value=>workspace.patch(tab.id,{busy:value})} onDirtyChange={dirty=>setDataDirty(previous=>previous[tab.id]===dirty?previous:{...previous,[tab.id]:dirty})} onNavigate={async(table,filter)=>{if(!await leaveData())return;const next=workspace.add(table,tableQuery(connection.profile.engine,table.schema,table.name));setAdvanced(previous=>({...previous,[next.id]:true}));setInitialFilters(previous=>({...previous,[next.id]:filter?[filter]:[]}));}} onChanged={()=>{setCatalogVersion(v=>v+1);}}/>:<section className="results-pane" {...menuFor(resultMenu)}>
        <div className="result-tabs"><div className="result-tab"><Table2 size={15}/> {t("결과")} <span>{result.rows.length}</span></div>{selected && <Button variant="ghost" size="bare" className="subtle-button" onClick={() => void openDetails(selected)}>{t("테이블 상세")}</Button>}<div className="result-meta" data-stale={!!tab.resultStale}>{busy ? <Loader2 size={13} className="spin"/> : tab.resultStale || error ? <X size={13}/> : result.columns.length || lastQuery ? <Check size={13}/> : null}<span aria-live="polite">{busy ? t("처리 중…") : tab.resultStale || error ? tr("작업 실패","Operation failed") : tr("DB 처리","DB time")+" "+result.elapsedMs+" ms"}</span>{tab.resultStale&&result.columns.length>0&&<span className="stale-result-label" title={lastQuery}>{tr("이전 성공 결과","Previous successful result")} · {result.elapsedMs} ms</span>}<span className="sep">·</span><span>{source === 'table' ? t("테이블 보기") : canEdit?tr("쿼리 결과 · 편집 가능","Query result · editable"):t("쿼리 결과 · 읽기 전용")}</span></div><span className="tabs-spacer"/><Button variant="ghost" size="bare" className="icon-button" title={t("CSV 내보내기")} aria-label={t("CSV 내보내기")} disabled={!result.columns.length} onClick={exportCsv}><ArrowDownToLine size={16}/></Button><Button variant="ghost" size="bare" className="icon-button" title={source === 'query' ? t("마지막 쿼리 다시 실행") : t("테이블 새로고침")} aria-label={source === "query" ? t("마지막 쿼리 다시 실행") : t("테이블 새로고침")} disabled={busy || (source === 'table' ? !selected : !lastQuery)} onClick={refreshResults}><RefreshCw size={15}/></Button></div>
        <div className="result-toolbar"><label className="result-filter"><Filter size={14}/><Input aria-label={t("결과 필터")} placeholder={t("결과 검색")} value={filter} onChange={e => {setFilter(e.target.value);setScroll(0);}}/></label><span className="tabs-spacer"/>{edits.length > 0 && <><Button variant="ghost" size="bare" className="subtle-button" disabled={busy} onClick={() => setDraft({})}><Undo2 size={14}/> {t("취소")} </Button><Button variant="default" size="sm" className="save-button" disabled={busy} onClick={() => setShowReview(true)}><Check size={14}/> {t("변경 검토")} <span>{edits.length}</span></Button></>}</div>
        {error && <div role="alert" className="error-banner"><Terminal size={15}/><span>{error}</span><Button variant="ghost" size="bare" title={t("오류 닫기")} onClick={() => setError('')}><X size={14}/></Button></div>}
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
      </section>}
      </>}
      </>}
      </div>
    </main>
    {renaming&&<ModalSurface title={tr('탭 이름 변경','Rename tab')} onClose={()=>setRenaming(null)}><form className="modal tab-rename-modal" role="dialog" aria-label={tr('탭 이름 변경','Rename tab')} onSubmit={event=>{event.preventDefault();if(!renaming.name.trim())return;workspace.patch(renaming.id,{customName:renaming.name.trim()});setRenaming(null);}}>
      <div className="modal-heading"><h2>{tr('탭 이름 변경','Rename tab')}</h2></div>
      <label htmlFor="tab-name">{tr('탭 이름','Tab name')}</label><Input id="tab-name" autoFocus maxLength={100} value={renaming.name} onFocus={event=>event.target.select()} onChange={event=>setRenaming({...renaming,name:event.target.value})}/>
      <div className="modal-actions"><Button type="button" variant="outline" size="sm" onClick={()=>setRenaming(null)}>{t('취소')}</Button><Button type="submit" size="sm" disabled={!renaming.name.trim()}>{tr('저장','Save')}</Button></div>
    </form></ModalSurface>}
    {showMaintenance&&<MaintenanceDialog session={active} engine={connection.profile.engine} profile={connection.profile} onClose={()=>setShowMaintenance(false)} onRestored={()=>{setCatalogVersion(v=>v+1);refreshTables();}}/>}
    {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)}/> }
    {notice && <div role="status" className="toast"><Check size={16}/>{notice}</div>}
    {showConnect && <ConnectionDialog initialProfile={editProfile} onClose={() => {setShowConnect(false);setEditProfile(undefined);}} onSave={saveProfile} saveDisabled={!!editProfile&&connections.some(c=>c.profile.id===editProfile.id&&!c.session.startsWith('saved:'))} onPasswordForgotten={passwordForgotten} onConnected={acceptConnection}/>}
    {editing && <ModalSurface title={t("셀 편집")} onClose={() => setEditing(null)} locked={false}><div className="modal cell-modal" role="dialog" aria-modal="true" aria-label={t("셀 편집")}><div className="modal-heading"><h2> {t("셀 편집")} </h2><Button variant="ghost" size="bare" onClick={() => setEditing(null)} aria-label={t("닫기")}><X size={20}/></Button></div><p className="modal-description">{selected?.name} / <strong>{editing.col}</strong> {t("· 행")} {editing.index + 1}</p><Textarea aria-label={t("셀 값")} autoFocus value={editing.value} disabled={editing.isNull} onChange={e => setEditing({...editing,value:e.target.value})}/><label className="checkbox-label"><Input type="checkbox" checked={editing.isNull} onChange={e => setEditing({...editing,isNull:e.target.checked})}/> {t("NULL로 설정")} </label><div className="modal-actions"><Button variant="outline" size="sm" className="secondary-button" onClick={() => setEditing(null)}> {t("취소")} </Button><Button variant="default" size="sm" className="primary-button" onClick={() => {setDraft(d => ({...d,[`${editing.index}:${editing.col}`]:editing.isNull ? null : editing.value}));setEditing(null);}}> {t("변경 대기열에 추가")} </Button></div></div></ModalSurface>}
    {showReview && <ModalSurface title={t("변경 사항 검토")} onClose={() => setShowReview(false)} locked={busy}><div className="modal review-modal" role="dialog" aria-modal="true" aria-label={t("변경 사항 검토")}><div className="modal-heading"><h2> {t("변경 사항 검토")} </h2><Button variant="ghost" size="bare" disabled={busy} onClick={() => setShowReview(false)} aria-label={t("닫기")}><X size={20}/></Button></div><p className="modal-description">{t('검토 설명', {table: `${selected?.schema}.${selected?.name}`, count: edits.length})} {active === 'demo' ? t("데모 데이터에만 반영됩니다.") : t("모든 변경을 하나의 트랜잭션으로 적용합니다.")}</p><div className="review-list">{edits.map((edit,i) => <div className="review-row" key={i}><small>{result.columns.filter(c => c.primary).map(c => `${c.name} = ${edit.original[c.name]}`).join(', ')}</small>{Object.entries(edit.changes).map(([col,val]) => <div key={col}><strong>{col}</strong><del>{edit.original[col] ?? 'NULL'}</del><ArrowRight size={14}/><ins>{val ?? 'NULL'}</ins></div>)}</div>)}</div>{error && <p className="dialog-error">{error}</p>}<div className="modal-actions"><Button variant="outline" size="sm" disabled={busy} className="secondary-button" onClick={() => setShowReview(false)}> {t("돌아가기")} </Button><Button variant="default" size="sm" disabled={busy} className="primary-button" onClick={() => void applyChanges()}>{busy ? t("적용 중...") : t('행 적용', {count: edits.length})}</Button></div></div></ModalSurface>}
    {showSettings && <SettingsDialog theme={theme} onThemeChange={next => { saveTheme(next); setTheme(next); }} sidebarOpen={sidebarOpen} onSidebarChange={setSidebarOpen} onClose={() => setShowSettings(false)}/> }
    {showHelp && <ModalSurface title={t("도움말")} onClose={() => setShowHelp(false)} locked={false}><div className="modal help-modal" role="dialog" aria-modal="true" aria-label={t("도움말")}><div className="modal-heading"><h2> {t("도움말")} </h2><Button variant="ghost" size="bare" onClick={() => setShowHelp(false)} aria-label={t("닫기")}><X size={20}/></Button></div><div className="help-content"><p><kbd>Ctrl + Enter</kbd> {t("선택한 구문 또는 편집기의 SQL 실행")} </p><p><strong> {t("결과 편집")} </strong> {t("테이블 보기에서 셀 더블클릭 → 변경 검토 → 적용. 기본키와 생성 열은 수정할 수 없습니다.")} </p><p><strong> {t("연결")} </strong> {tr("PostgreSQL·MySQL·MariaDB·SQLite에 연결합니다. 프로필과 SQL 탭을 저장합니다. 비밀번호는 선택 시 Windows 자격 증명 관리자에 암호화하여 저장하며, 다음 실행 시 마지막 연결에 자동 접속합니다.","Connect to PostgreSQL, MySQL, MariaDB or SQLite. Profiles and SQL tabs are saved. Passwords can be encrypted in Windows Credential Manager to reconnect to the last connection on startup.")} </p><p><strong> {t("쿼리 실행")} </strong> {tr("스크립트 실행·매개변수·수동 커밋을 지원합니다. 테이블의 데이터 도구에서 페이징과 가져오기·내보내기를 사용할 수 있습니다.","Scripts, parameters and manual commit are available. Open Data tools for paging, import and export.")} </p></div><Button variant="default" size="sm" className="primary-button full" onClick={() => setShowHelp(false)}> {t("확인")} </Button></div></ModalSurface>}
  </div>;
}
