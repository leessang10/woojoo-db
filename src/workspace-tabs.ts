import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { collectEdits, type ColumnDetail, type Result, type Table } from './model';
import type { ErdDocument } from './erd-model';

export type WorkspaceTab = {
  id: string;
  session: string;
  number: number;
  customName?: string;
  kind: 'table' | 'query' | 'schema' | 'details' | 'erd';
  erd: ErdDocument | null;
  objectSchema: string;
  details: ColumnDetail[];
  selected: Table | null;
  editorSql: string;
  initialSql: string;
  result: Result;
  source: 'table' | 'query';
  draft: Record<string, string | null>;
  filter: string;
  sort: { name: string; desc: boolean } | null;
  scroll: number;
  error: string;
  lastQuery: string;
  busy: boolean;
  loaded: boolean;
  queryTable?: Table | null;
  file?: { path: string | null; name: string; savedSql: string };
};

export function createTab(session: string, number: number, table: Table | null = null, sql = ''): WorkspaceTab {
  return {
    id: crypto.randomUUID(), session, number, kind: table ? 'table' : 'query',
    objectSchema: table?.schema ?? '', details: [],
    erd: null,
    selected: table, editorSql: sql, initialSql: table ? sql : '',
    result: { columns: [], rows: [], elapsedMs: 0, affected: 0, truncated: false },
    source: table ? 'table' : 'query', draft: {}, filter: '', sort: null, scroll: 0,
    error: '', lastQuery: '', busy: false, loaded: false,
  };
}

export function isDirty(tab: WorkspaceTab) {
  return !!tab.erd?.pending?.length || tab.editorSql !== tab.initialSql || collectEdits(tab.result.rows, tab.draft).length > 0;
}

const STORAGE_KEY = 'woojoo-workspace-v1';
export function restoreTabs(initial: WorkspaceTab): WorkspaceTab[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!Array.isArray(saved.tabs)) return [initial];
    const tabs = saved.tabs.slice(0,100).flatMap((item: Record<string, unknown>) => {
      if (typeof item.profileId !== 'string' || typeof item.editorSql !== 'string' || !['table','query','schema','details','erd'].includes(String(item.kind))) return [];
      const selected = item.selected as {schema?:unknown;name?:unknown}|null;
      const table = selected && typeof selected.schema === 'string' && typeof selected.name === 'string' ? {schema:selected.schema,name:selected.name}:null;
      const tab = createTab(item.profileId === 'demo' ? 'demo' : `saved:${item.profileId}`, Number(item.number)||0, table, item.editorSql);
      return [{...tab, id:typeof item.id==='string'?item.id:tab.id, kind:item.kind as WorkspaceTab['kind'], objectSchema:typeof item.objectSchema==='string'?item.objectSchema:table?.schema??'',
        customName:typeof item.customName==='string'?item.customName:undefined,
        initialSql:typeof item.initialSql==='string'?item.initialSql:'',
        ...(typeof item.filePath==='string'?{file:{path:item.filePath,name:typeof item.fileName==='string'?item.fileName:'query.sql',savedSql:typeof item.initialSql==='string'?item.initialSql:''}}:{})}];
    });
    return tabs;
  } catch { return [initial]; }
}
export function persistTabs(tabs: WorkspaceTab[], profiles: Record<string,string>, activeTab?:string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({activeTab,profileIds:Object.values(profiles),tabs:tabs.filter(tab=>profiles[tab.session]).map(tab=>({
    id:tab.id,profileId:profiles[tab.session],number:tab.number,kind:tab.kind,selected:tab.selected,objectSchema:tab.objectSchema,
    customName:tab.customName,editorSql:tab.editorSql,initialSql:tab.initialSql,filePath:tab.file?.path,fileName:tab.file?.name,
  }))}));
}
export function useWorkspaceTabs(session: string, initial: WorkspaceTab) {
  const [tabs, setTabs] = useState(() => restoreTabs(initial));
  const [selectedIds, setSelectedIds] = useState<Record<string,string>>(()=>{try{const id=JSON.parse(localStorage.getItem(STORAGE_KEY)??'{}').activeTab;const item=tabs.find(tab=>tab.id===id);return item?{[item.session]:item.id}:{};}catch{return {};}});
  const placeholders = useRef(new Map<string, WorkspaceTab>());
  const initialized = useRef(new Set<string>([
    ...tabs.map(item => item.session),
    ...(() => { try {
      const ids: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').profileIds;
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').map(id => id === 'demo' ? id : `saved:${id}`) : [];
    } catch { return []; } })(),
  ]));
  const counters = useRef(new Map<string, number>());
  const connectionTabs = tabs.filter(tab => tab.session === session);
  let current = connectionTabs.find(tab => tab.id === selectedIds[session]) ?? connectionTabs[0];
  if (!current) {
    if (!placeholders.current.has(session)) placeholders.current.set(session, createTab(session, 1));
    current = placeholders.current.get(session)!;
  }
  const tab = current;
  useEffect(() => {
    if (initialized.current.has(session)) return;
    initialized.current.add(session);
    setTabs(previous => previous.some(item => item.session === session) ? previous : [...previous, tab]);
  }, [session, tab.id]);
  function patch(id: string, changes: Partial<WorkspaceTab>) {
    setTabs(previous => previous.map(item => item.id === id ? { ...item, ...changes } : item));
  }
  function field<K extends keyof WorkspaceTab>(key: K): [WorkspaceTab[K], (value: SetStateAction<WorkspaceTab[K]>) => void] {
    const id = tab.id;
    return [tab[key], value => setTabs(previous => previous.map(item => item.id === id
      ? { ...item, [key]: typeof value === 'function' ? (value as (old: WorkspaceTab[K]) => WorkspaceTab[K])(item[key]) : value }
      : item))];
  }
  function activate(id: string) { setSelectedIds(previous => ({ ...previous, [session]: id })); }
  function markQuery(id: string) {
    const item = tabs.find(candidate => candidate.id === id);
    if (!item || item.kind === 'query') return;
    const number = Math.max(counters.current.get(item.session) ?? 0, ...tabs.filter(candidate => candidate.session === item.session).map(candidate => candidate.number)) + 1;
    counters.current.set(item.session, number);
    patch(id, { kind: 'query', number, initialSql: '' });
  }
  function add(table: Table | null = null, sql = '', targetSession = session) {
    const number = table ? 0 : Math.max(counters.current.get(targetSession) ?? 0, ...tabs.filter(item=>item.session===targetSession).map(item => item.number)) + 1;
    if (!table) counters.current.set(targetSession, number);
    const next = createTab(targetSession, number, table, sql);
    setTabs(previous => [...previous, next]);
    setSelectedIds(previous=>({...previous,[targetSession]:next.id}));
    return next;
  }
  function close(id: string) {
    const index = connectionTabs.findIndex(item => item.id === id);
    const remaining = connectionTabs.filter(item => item.id !== id);
    setTabs(previous => previous.filter(item => item.id !== id));
    if (tab.id === id) activate(remaining[Math.min(index, remaining.length - 1)]?.id ?? '');
  }
  function reorder(id: string, targetId: string, after = false) {
    setTabs(previous => {
      const item = previous.find(item => item.id === id);
      const target = previous.find(item => item.id === targetId);
      if (!item || !target || id === targetId || item.session !== target.session) return previous;
      const next = previous.filter(item => item.id !== id);
      next.splice(next.findIndex(item => item.id === targetId) + Number(after), 0, item);
      return next;
    });
  }
  function remapSession(from: string, to: string) {
    initialized.current.add(to);
    setTabs(previous=>previous.map(item=>item.session===from?{...item,session:to,loaded:false,result:createTab(to,0).result,details:[],draft:{},error:'',busy:false}:item));
    setSelectedIds(previous=>({...previous,[to]:previous[from]}));
  }
  function removeSession(id:string) { setTabs(previous=>previous.filter(item=>item.session!==id)); }
  return { tabs, tab, connectionTabs, field, patch, add, activate, close, reorder, markQuery, remapSession, removeSession };
}
