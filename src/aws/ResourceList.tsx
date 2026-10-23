import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Search, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useLanguage } from '../i18n';
import { awsCancel, awsListResources, type AwsRow } from '../aws';
import { AwsError } from './AwsError';
import { cells, columnLabels, hasState, mergeRows, requestId, resourceId, serviceLabel, type AwsTab } from './model';

type Cached = { rows: AwsRow[]; nextToken: string | null; updated: number };
// Lists survive tab switches and closes for a short while, like the CLI cache in Orbit.
const cache = new Map<string, Cached>();
const FRESH_MS = 30_000;
export const clearListCache = () => cache.clear();

export function ResourceList({ tab, revision, selected, onSelect, onOpen }: { tab: AwsTab; revision: number; selected?: string; onSelect: (row: AwsRow) => void; onOpen: (row: AwsRow) => void }) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const service = tab.service!;
  const key = JSON.stringify([tab.profile, tab.region, service]);
  const [page, setPage] = useState<Cached>(() => cache.get(key) ?? { rows: [], nextToken: null, updated: 0 });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [search, setSearch] = useState(''), [state, setState] = useState('');
  const running = useRef<string | null>(null), pageRef = useRef(page); pageRef.current = page;
  async function load(more = false) {
    if (running.current) { if (!more) void awsCancel(running.current); else return; }
    const request = requestId(); running.current = request;
    setBusy(true); setError('');
    const token = more ? pageRef.current.nextToken : null;
    try {
      const data = await awsListResources({ service, profile: tab.profile, region: tab.region, nextToken: token, request });
      if (running.current !== request) return;
      const value = { rows: mergeRows(more ? pageRef.current.rows : [], data.rows, row => resourceId(service, row)), nextToken: data.nextToken && data.nextToken !== token ? data.nextToken : null, updated: Date.now() };
      cache.delete(key); cache.set(key, value);
      if (cache.size > 24) cache.delete(cache.keys().next().value!);
      setPage(value);
    } catch (reason) {
      if (running.current === request && String(reason) !== 'AWS_CANCELLED') setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      if (running.current === request) { running.current = null; setBusy(false); }
    }
  }
  const first = useRef(true);
  useEffect(() => {
    const cached = cache.get(key);
    // The first mount reuses a fresh cached page; an explicit refresh always reloads.
    if (first.current && cached && Date.now() - cached.updated < FRESH_MS) { first.current = false; return; }
    first.current = false;
    void load();
  }, [revision]);
  useEffect(() => () => { if (running.current) void awsCancel(running.current); running.current = null; }, []);

  const labels = columnLabels[service];
  const rows = page.rows.map(row => ({ row, cells: cells(service, row, language), id: resourceId(service, row) }));
  const states = hasState(service) ? [...new Set(rows.map(item => item.cells[1]))].sort() : [];
  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(item => (!needle || item.cells.join(' ').toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle)) && (!state || item.cells[1] === state));
  return <section className="aws-list" aria-label={tr(...serviceLabel[service])} aria-busy={busy}>
    <div className="result-toolbar aws-toolbar">
      <label className="result-filter"><Search size={14}/><Input aria-label={tr('리소스 검색', 'Search resources')} placeholder={tr('이름·ID 검색', 'Search name or ID')} value={search} onChange={event => setSearch(event.target.value)}/></label>
      {hasState(service) && <NativeSelect size="sm" aria-label={tr('상태 필터', 'State filter')} value={state} onChange={event => setState(event.target.value)}><NativeSelectOption value="">{tr('모든 상태', 'All states')}</NativeSelectOption>{states.map(value => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect>}
      <span className="tabs-spacer"/>
      <span className="aws-count">{needle || state ? `${filtered.length} / ` : ''}{page.rows.length}{page.nextToken ? '+' : ''} {tr('개', page.rows.length === 1 ? 'resource' : 'resources')}</span>
      {page.updated > 0 && <span className="aws-updated" title={new Date(page.updated).toLocaleString()}>{tr('조회', 'Loaded')} {new Date(page.updated).toLocaleTimeString(language === 'ko' ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>}
      <Button variant="ghost" size="bare" className="icon-button" aria-label={tr('목록 새로고침', 'Refresh list')} title={tr('목록 새로고침', 'Refresh list') + ' · F5'} disabled={busy} onClick={() => void load()}><RefreshCw size={15} className={busy ? 'spin' : ''}/></Button>
    </div>
    <AwsError error={error} profile={tab.profile} onRetry={() => void load()}/>
    <div className="grid-scroll" aria-busy={busy}>
      <table className="data-grid aws-grid">
        <thead><tr>{labels.map(([ko, en]) => <th key={en}><div><strong>{tr(ko, en)}</strong></div></th>)}</tr></thead>
        <tbody>{filtered.map(item => <tr key={item.id} tabIndex={0} aria-selected={selected === item.id} data-selected={selected === item.id} onClick={() => onSelect(item.row)} onDoubleClick={() => onOpen(item.row)} onKeyDown={event => { if (event.key === 'Enter') onOpen(item.row); else if (event.key === ' ') { event.preventDefault(); onSelect(item.row); } }}>
          {item.cells.map((value, index) => <td key={index} title={value}>{index === 1 && hasState(service) ? <span className="aws-state" data-state={value}>{value}</span> : value}</td>)}
        </tr>)}</tbody>
      </table>
      {busy && !page.rows.length && <div className="empty-result" role="status"><Loader2 size={22} className="spin"/><p>{tr('AWS CLI로 조회하는 중…', 'Querying with AWS CLI…')}</p></div>}
      {!busy && !error && page.updated > 0 && !page.rows.length && <div className="empty-result"><Server size={28}/><h3>{tr('리소스가 없습니다', 'No resources')}</h3><p>{tr(`${tab.region} 리전에 표시할 항목이 없습니다.`, `Nothing to show in ${tab.region}.`)}</p></div>}
      {page.rows.length > 0 && !filtered.length && <div className="empty-result"><Search size={24}/><p>{tr('일치하는 리소스가 없습니다.', 'No matching resources.')}</p></div>}
    </div>
    <div className="result-footer"><span>{tr('행을 선택하면 오른쪽 패널에 요약을, 더블클릭하면 상세 탭을 엽니다.', 'Select a row for a summary in the right panel; double-click for a detail tab.')}</span>{page.nextToken && <Button variant="outline" size="xs" disabled={busy} onClick={() => void load(true)}>{busy ? <Loader2 size={12} className="spin"/> : null}{tr('더 불러오기', 'Load more')}</Button>}</div>
  </section>;
}
