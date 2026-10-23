import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ChevronDown, ChevronRight, CircleCheck, CircleX, Copy, Loader2, RefreshCw, Search } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect, NativeSelectOption } from './components/ui/native-select';
import { useLanguage } from './i18n';
import { HISTORY_EVENT, readQueryHistory } from './sql-workbench';

export type ExecutionEntry = {
  id: string; sql: string; profileId: string; connectionName: string; engine: string; database: string;
  kind: string; status: string; startedAt: number; durationMs: number | null; error: string | null;
};
type Page = { entries: ExecutionEntry[]; total: number };
type Props = {
  profileId: string; connectionName: string; profileIds: string[];
  onOpen: (entry: Pick<ExecutionEntry, 'sql' | 'profileId'>) => void;
};
const PAGE = 50;

/** One history for the sidebar: the desktop execution journal, or this device's SQL history in the browser. */
export function HistoryPanel({ profileId, connectionName, profileIds, onOpen }: Props) {
  const { language } = useLanguage();
  const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const native = isTauri();
  const [scope, setScope] = useState<'connection' | 'all'>('connection');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [since, setSince] = useState(''), [until, setUntil] = useState('');
  const [page, setPage] = useState<Page>({ entries: [], total: 0 });
  const [limit, setLimit] = useState(PAGE);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const labels: Record<string, string> = { running: tr('실행 중', 'Running'), success: tr('성공', 'Success'), failed: tr('실패', 'Failed'), cancelled: tr('취소됨', 'Cancelled'), interrupted: tr('중단됨', 'Interrupted') };
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener(HISTORY_EVENT, refresh);
    if (!native) return () => window.removeEventListener(HISTORY_EVENT, refresh);
    const subscription = listen('executions-changed', refresh).catch(() => () => {});
    return () => { window.removeEventListener(HISTORY_EVENT, refresh); void subscription.then(unlisten => unlisten()).catch(() => {}); };
  }, [native]);
  useEffect(() => { setLimit(PAGE); setExpanded(null); }, [scope, status, search, since, until, profileId]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      const from = since ? new Date(`${since}T00:00:00`).getTime() : null;
      const end = until ? new Date(`${until}T00:00:00`) : null;
      if (end) end.setDate(end.getDate() + 1);
      if (from !== null && end && from >= end.getTime()) { setError(tr('날짜 범위를 확인하세요.', 'Check the date range.')); setPage({ entries: [], total: 0 }); return; }
      setError('');
      if (!native) {
        const entries = readQueryHistory(scope === 'connection' ? profileId : undefined)
          .filter(entry => (!search || entry.sql.toLowerCase().includes(search.toLowerCase())) && (!status || (status === 'success') === entry.success) && (from === null || Date.parse(entry.at) >= from) && (!end || Date.parse(entry.at) < end.getTime()))
          .map(entry => ({ id: entry.id, sql: entry.sql, profileId: entry.connection ?? '', connectionName: entry.connectionName ?? '', engine: entry.engine, database: '', kind: 'sql', status: entry.success ? 'success' : 'failed', startedAt: Date.parse(entry.at), durationMs: entry.duration === undefined ? null : Math.round(entry.duration), error: null }));
        setPage({ entries: entries.slice(0, limit), total: entries.length });
        return;
      }
      setBusy(true); setError('');
      // The journal pages by 50; load every page up to the requested limit.
      void Promise.all(Array.from({ length: limit / PAGE }, (_, index) => invoke<Page>('execution_list', { filter: { search, profileId: scope === 'connection' ? profileId : '', status, since: from, until: end?.getTime() ?? null, offset: index * PAGE } })))
        .then(pages => { if (live) setPage({ entries: pages.flatMap(item => item.entries), total: pages[0]?.total ?? 0 }); })
        .catch(e => { if (live) setError(String(e)); })
        .finally(() => { if (live) setBusy(false); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [native, scope, status, search, since, until, profileId, limit, revision]);
  async function open(entry: ExecutionEntry) {
    setError('');
    try {
      // List rows carry a preview; the detail holds the full statement.
      const full = native ? await invoke<ExecutionEntry>('execution_detail', { id: entry.id }) : entry;
      onOpen({ sql: full.sql, profileId: full.profileId });
    } catch (e) { setError(String(e)); }
  }
  async function copy(sql: string) {
    try { await navigator.clipboard.writeText(sql); } catch { setError(tr('복사하지 못했습니다.', 'Could not copy SQL.')); }
  }
  const time = (value: number) => {
    const date = new Date(value), today = new Date();
    return date.toDateString() === today.toDateString()
      ? date.toLocaleTimeString(language === 'ko' ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric' });
  };
  return <section className="history-panel" aria-label={tr('쿼리 기록', 'Query history')}>
    <div className="history-heading"><span>{tr('쿼리 기록', 'Query history')}</span><Button variant="ghost" size="bare" aria-label={tr('기록 새로고침', 'Refresh history')} title={tr('기록 새로고침', 'Refresh history')} disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? <Loader2 size={14} className="spin"/> : <RefreshCw size={14}/>}</Button></div>
    <div className="history-scope" role="group" aria-label={tr('기록 범위', 'History scope')}>
      <Button variant="ghost" size="bare" aria-pressed={scope === 'connection'} title={connectionName} onClick={() => setScope('connection')}>{tr('이 연결', 'This connection')}</Button>
      <Button variant="ghost" size="bare" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>{tr('전체', 'All')}</Button>
    </div>
    <label className="search-field history-search"><Search size={14}/><Input aria-label={tr('SQL·오류 검색', 'Search SQL or errors')} placeholder={tr('SQL·오류 검색', 'Search SQL or errors')} value={search} onChange={event => setSearch(event.target.value)}/></label>
    <NativeSelect size="sm" className="history-status" aria-label={tr('실행 상태', 'Execution status')} value={status} onChange={event => setStatus(event.target.value)}>
      <NativeSelectOption value="">{tr('모든 상태', 'All statuses')}</NativeSelectOption>
      {(native ? Object.keys(labels) : ['success', 'failed']).map(key => <NativeSelectOption key={key} value={key}>{labels[key]}</NativeSelectOption>)}
    </NativeSelect>
    <div className="history-dates"><Input type="date" aria-label={tr('시작일', 'Start date')} value={since} onChange={event => setSince(event.target.value)}/><Input type="date" aria-label={tr('종료일', 'End date')} value={until} onChange={event => setUntil(event.target.value)}/></div>
    {error && <p className="history-error" role="alert">{error}</p>}
    <ol className="history-list" aria-busy={busy}>
      {page.entries.map(entry => {
        const missing = !profileIds.includes(entry.profileId), open_ = expanded === entry.id;
        return <li key={entry.id} className="history-entry" data-status={entry.status}>
          <div className="history-row">
            <Button variant="ghost" size="bare" className="history-open" disabled={missing} title={missing ? tr('연결 프로필이 삭제되었습니다.', 'Connection profile no longer exists.') : tr('새 쿼리 탭에서 열기', 'Open in a new query tab')} onClick={() => void open(entry)}>
              {entry.status === 'success' ? <CircleCheck size={13} className="history-ok" aria-label={labels.success}/> : entry.status === 'running' ? <Loader2 size={13} className="spin" aria-label={labels.running}/> : <CircleX size={13} className="history-bad" aria-label={labels[entry.status] ?? entry.status}/>}
              <span className="history-sql">{entry.sql}</span>
            </Button>
            <Button variant="ghost" size="bare" className="history-toggle" aria-expanded={open_} aria-label={tr('상세 보기', 'Show details')} onClick={() => setExpanded(open_ ? null : entry.id)}>{open_ ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</Button>
          </div>
          <small className="history-meta">{time(entry.startedAt)} · {entry.durationMs === null ? '—' : `${entry.durationMs.toLocaleString()} ms`}{scope === 'all' && entry.connectionName ? ` · ${entry.connectionName}` : ''}</small>
          {open_ && <div className="history-detail">
            <span>{labels[entry.status] ?? entry.status}{entry.database ? ` · ${entry.database}` : ''}{entry.engine ? ` · ${entry.engine}` : ''}</span>
            {entry.error && <pre className="history-detail-error">{entry.error}</pre>}
            <Button variant="outline" size="xs" onClick={() => void copy(entry.sql)}><Copy size={12}/>{tr('SQL 복사', 'Copy SQL')}</Button>
          </div>}
        </li>;
      })}
    </ol>
    {!busy && !error && !page.entries.length && <p className="history-empty">{search || status || since || until ? tr('조건에 맞는 기록이 없습니다.', 'No matching history.') : tr('실행한 쿼리가 여기에 쌓입니다.', 'Queries you run appear here.')}</p>}
    {page.entries.length < page.total && <Button variant="outline" size="xs" className="history-more" disabled={busy} onClick={() => setLimit(value => value + PAGE)}>{tr(`더 보기 (${page.total - page.entries.length})`, `Show more (${page.total - page.entries.length})`)}</Button>}
  </section>;
}
