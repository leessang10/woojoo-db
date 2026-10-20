import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { collectEdits, type ColumnDetail, type Result, type Table } from './model';
import type { ErdDocument } from './erd-model';

export type WorkspaceTab = {
  id: string;
  session: string;
  number: number;
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
  return tab.editorSql !== tab.initialSql || collectEdits(tab.result.rows, tab.draft).length > 0;
}

export function useWorkspaceTabs(session: string, initial: WorkspaceTab) {
  const [tabs, setTabs] = useState([initial]);
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({ [initial.session]: initial.id });
  const placeholders = useRef(new Map<string, WorkspaceTab>());
  const counters = useRef(new Map<string, number>());
  const connectionTabs = tabs.filter(tab => tab.session === session);
  let current = connectionTabs.find(tab => tab.id === selectedIds[session]) ?? connectionTabs[0];
  if (!current) {
    if (!placeholders.current.has(session)) placeholders.current.set(session, createTab(session, 1));
    current = placeholders.current.get(session)!;
  }
  const tab = current;
  useEffect(() => {
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
  function add(table: Table | null = null, sql = '') {
    const number = table ? 0 : Math.max(counters.current.get(session) ?? 0, ...connectionTabs.map(item => item.number)) + 1;
    if (!table) counters.current.set(session, number);
    const next = createTab(session, number, table, sql);
    setTabs(previous => [...previous, next]);
    activate(next.id);
    return next;
  }
  function close(id: string) {
    const index = connectionTabs.findIndex(item => item.id === id);
    const remaining = connectionTabs.filter(item => item.id !== id);
    if (!remaining.length) {
      const next = createTab(session, (counters.current.get(session) ?? 0) + 1);
      counters.current.set(session, next.number);
      setTabs(previous => [...previous.filter(item => item.id !== id), next]);
      activate(next.id);
    } else {
      setTabs(previous => previous.filter(item => item.id !== id));
      if (tab.id === id) activate(remaining[Math.min(index, remaining.length - 1)].id);
    }
  }
  return { tabs, tab, connectionTabs, field, patch, add, activate, close, markQuery };
}
