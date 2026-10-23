import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Copy, Database, FileText, Folder, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useLanguage } from '../i18n';
import { awsBrowseResources, awsCancel, type AwsRow } from '../aws';
import { AwsError } from './AwsError';
import { ResourceActions } from './ResourceActions';
import { clearListCache } from './ResourceList';
import { facts, formatBytes, formatDate, mergeRows, requestId, resourceId, resourceName, serviceLabel, tags, type AwsTab } from './model';

type View = 'overview' | 'browse' | 'actions' | 'json';
const RDS_ENGINES = ['postgres', 'mysql', 'mariadb', 'aurora-postgresql', 'aurora-mysql'];
export const canConnectRds = (row: AwsRow) => RDS_ENGINES.includes(row.Engine) && !!row.Endpoint?.Address && row.DBInstanceStatus === 'available';

export function Facts({ tab, row }: { tab: AwsTab; row: AwsRow }) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const list = tags(row);
  return <>
    <dl className="aws-facts">{facts(tab.service!, row, language).map(([ko, en, value]) => <div key={en}><dt>{tr(ko, en)}</dt><dd title={value}>{value}</dd></div>)}</dl>
    {list.length > 0 && <><h3 className="aws-subheading">{tr('태그', 'Tags')}</h3><dl className="aws-facts aws-tags">{list.map(([key, value]) => <div key={key}><dt title={key}>{key}</dt><dd title={value}>{value || '—'}</dd></div>)}</dl></>}
  </>;
}

export function ResourceDetail({ tab, revision, onConnectRds }: { tab: AwsTab; revision: number; onConnectRds: (row: AwsRow) => void }) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const service = tab.service!, row = tab.row!;
  const browsable = service === 's3' || service === 'logs';
  const [view, setView] = useState<View>(browsable ? 'browse' : 'overview');
  const views: [View, string][] = [['overview', tr('개요', 'Overview')], ...(browsable ? [['browse', service === 's3' ? tr('객체', 'Objects') : tr('로그 이벤트', 'Log events')]] as [View, string][] : []), ['actions', tr('작업', 'Actions')], ['json', 'JSON']];
  return <section className="aws-detail">
    <div className="aws-detail-heading">
      <div><small>{tr(...serviceLabel[service])} · {tab.region}</small><h1 title={resourceName(service, row)}>{resourceName(service, row)}</h1></div>
      <span className="tabs-spacer"/>
      <Button variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(resourceId(service, row)).catch(() => {})}><Copy size={14}/>{tr('ID 복사', 'Copy ID')}</Button>
      {service === 'rds' && <Button size="sm" disabled={!canConnectRds(row)} title={canConnectRds(row) ? undefined : tr('사용 가능한 PostgreSQL·MySQL·MariaDB 인스턴스만 연결할 수 있습니다.', 'Only available PostgreSQL, MySQL or MariaDB instances can be connected.')} onClick={() => onConnectRds(row)}><Database size={14}/>{tr('DB 연결', 'Connect database')}</Button>}
    </div>
    <div className="object-view-bar" role="group" aria-label={tr('보기', 'View')}>{views.map(([value, label]) => <Button key={value} variant="ghost" size="bare" className="view-option" aria-pressed={view === value} onClick={() => setView(value)}>{label}</Button>)}</div>
    <div className="aws-detail-body" hidden={view !== 'overview'}><p className="aws-snapshot-note">{tr('목록에서 연 시점의 정보입니다. 최신 상태는 목록을 새로고침하세요.', 'Captured when opened from the list. Refresh the list for the latest state.')}</p><Facts tab={tab} row={row}/></div>
    {view === 'actions' && <ResourceActions tab={tab} row={row} onDone={clearListCache}/>}
    {view === 'json' && <pre className="aws-json">{JSON.stringify(row, null, 2)}</pre>}
    {browsable && <div className="aws-browse" hidden={view !== 'browse'}>{service === 's3' ? <S3Browser tab={tab} bucket={row.Name} revision={revision}/> : <LogBrowser tab={tab} group={row.logGroupName} revision={revision}/>}</div>}
  </section>;
}

/** Shared paging for S3 objects and log events: one native page per request, cancellable. */
function useBrowse(tab: AwsTab, identity: (row: AwsRow) => string) {
  const [rows, setRows] = useState<AwsRow[]>([]), [next, setNext] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  const running = useRef<string | null>(null), rowsRef = useRef(rows); rowsRef.current = rows;
  const nextRef = useRef(next); nextRef.current = next;
  async function load(query: Omit<Parameters<typeof awsBrowseResources>[0], 'profile' | 'region' | 'nextToken' | 'request'>, more = false) {
    if (running.current) void awsCancel(running.current);
    const request = requestId(); running.current = request;
    setBusy(true); setError('');
    if (!more) { setRows([]); setNext(null); }
    const token = more ? nextRef.current : null;
    try {
      const page = await awsBrowseResources({ ...query, profile: tab.profile, region: tab.region, nextToken: token, request });
      if (running.current !== request) return;
      setRows(mergeRows(more ? rowsRef.current : [], page.rows, identity));
      setNext(page.nextToken && page.nextToken !== token ? page.nextToken : null);
      setLoaded(true);
    } catch (reason) {
      if (running.current === request && String(reason) !== 'AWS_CANCELLED') setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      if (running.current === request) { running.current = null; setBusy(false); }
    }
  }
  useEffect(() => () => { if (running.current) void awsCancel(running.current); running.current = null; }, []);
  return { rows, next, busy, error, loaded, load };
}

function S3Browser({ tab, bucket, revision }: { tab: AwsTab; bucket: string; revision: number }) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [prefix, setPrefix] = useState(''), [draft, setDraft] = useState('');
  const browse = useBrowse(tab, row => `${row.kind}:${row.Prefix ?? row.Key}`);
  const open = (path: string, more = false) => { if (!more) { setPrefix(path); setDraft(path); } void browse.load({ kind: 'objects', resource: bucket, prefix: path }, more); };
  useEffect(() => { open(prefix); }, [revision]);
  const parts = prefix.split('/').filter(Boolean);
  return <>
    <div className="result-toolbar aws-toolbar">
      <nav className="aws-path" aria-label={tr('경로', 'Path')}>
        <Button variant="ghost" size="xs" disabled={browse.busy} onClick={() => open('')}>{bucket}</Button>
        {parts.map((part, index) => <span key={index} className="aws-path-part"><ChevronRight size={12}/><Button variant="ghost" size="xs" disabled={browse.busy} onClick={() => open(parts.slice(0, index + 1).join('/') + '/')}>{part}</Button></span>)}
      </nav>
      <span className="tabs-spacer"/>
      <form className="aws-path-form" onSubmit={event => { event.preventDefault(); open(draft); }}><Input aria-label={tr('접두사', 'Prefix')} placeholder={tr('접두사로 이동 (예: logs/2026/)', 'Go to prefix (e.g. logs/2026/)')} value={draft} onChange={event => setDraft(event.target.value)}/></form>
      <Button variant="ghost" size="bare" className="icon-button" aria-label={tr('객체 새로고침', 'Refresh objects')} disabled={browse.busy} onClick={() => open(prefix)}><RefreshCw size={15} className={browse.busy ? 'spin' : ''}/></Button>
    </div>
    <AwsError error={browse.error} profile={tab.profile} onRetry={() => open(prefix)}/>
    <div className="grid-scroll">
      <table className="data-grid aws-grid"><thead><tr><th><div><strong>{tr('이름', 'Name')}</strong></div></th><th><div><strong>{tr('크기', 'Size')}</strong></div></th><th><div><strong>{tr('수정일', 'Modified')}</strong></div></th><th><div><strong>{tr('스토리지 클래스', 'Storage class')}</strong></div></th></tr></thead>
        <tbody>{browse.rows.map(row => row.kind === 'folder'
          ? <tr key={'d' + row.Prefix} tabIndex={0} className="aws-folder" onDoubleClick={() => open(row.Prefix)} onKeyDown={event => { if (event.key === 'Enter') open(row.Prefix); }} onClick={() => open(row.Prefix)}><td><Folder size={14}/> {String(row.Prefix).slice(prefix.length)}</td><td>—</td><td>—</td><td>—</td></tr>
          : <tr key={'f' + row.Key}><td title={row.Key}><FileText size={14}/> {String(row.Key).slice(prefix.length) || row.Key}</td><td>{formatBytes(row.Size ?? 0)}</td><td>{formatDate(row.LastModified, language)}</td><td>{row.StorageClass ?? '—'}</td></tr>)}</tbody>
      </table>
      {browse.busy && !browse.rows.length && <div className="empty-result" role="status"><Loader2 size={22} className="spin"/></div>}
      {browse.loaded && !browse.busy && !browse.error && !browse.rows.length && <div className="empty-result"><Folder size={26}/><p>{tr('이 경로에 객체가 없습니다.', 'No objects at this path.')}</p></div>}
    </div>
    <div className="result-footer"><span>{browse.rows.length} {tr('항목', browse.rows.length === 1 ? 'item' : 'items')}{browse.next ? '+' : ''} · {tr('객체 내용 보기와 다운로드는 지원하지 않습니다.', 'Viewing and downloading objects is not supported.')}</span>{browse.next && <Button variant="outline" size="xs" disabled={browse.busy} onClick={() => open(prefix, true)}>{tr('더 불러오기', 'Load more')}</Button>}</div>
  </>;
}

const RANGES: [number, string, string][] = [[1, '최근 1시간', 'Last hour'], [6, '최근 6시간', 'Last 6 hours'], [24, '최근 24시간', 'Last 24 hours'], [168, '최근 7일', 'Last 7 days'], [720, '최근 30일', 'Last 30 days']];
function LogBrowser({ tab, group, revision }: { tab: AwsTab; group: string; revision: number }) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [hours, setHours] = useState(1), [pattern, setPattern] = useState('');
  const range = useRef({ startTime: 0, endTime: 0, pattern: '' });
  const browse = useBrowse(tab, row => String(row.eventId ?? JSON.stringify(row)));
  function search(more = false) {
    if (!more) { const endTime = Date.now(); range.current = { endTime, startTime: endTime - hours * 3_600_000, pattern }; }
    void browse.load({ kind: 'events', resource: group, ...range.current }, more);
  }
  useEffect(() => { search(); }, [revision]);
  return <>
    <form className="result-toolbar aws-toolbar" onSubmit={event => { event.preventDefault(); search(); }}>
      <NativeSelect size="sm" aria-label={tr('기간', 'Range')} value={String(hours)} onChange={event => setHours(Number(event.target.value))}>{RANGES.map(([value, ko, en]) => <NativeSelectOption key={value} value={String(value)}>{tr(ko, en)}</NativeSelectOption>)}</NativeSelect>
      <Input className="aws-pattern" aria-label={tr('필터 패턴', 'Filter pattern')} placeholder={tr('필터 패턴 (예: ERROR 또는 { $.status = 500 })', 'Filter pattern (e.g. ERROR or { $.status = 500 })')} value={pattern} onChange={event => setPattern(event.target.value)}/>
      <Button type="submit" size="sm" disabled={browse.busy}>{browse.busy ? <Loader2 size={13} className="spin"/> : null}{tr('조회', 'Search')}</Button>
      <span className="tabs-spacer"/>
      {range.current.endTime > 0 && <span className="aws-updated">{formatDate(range.current.startTime, language)} – {formatDate(range.current.endTime, language)}</span>}
    </form>
    <AwsError error={browse.error} profile={tab.profile} onRetry={() => search()}/>
    <div className="grid-scroll aws-log-list">
      {browse.rows.map(row => <article key={row.eventId ?? `${row.timestamp}${row.message}`} className="aws-log-event"><header><time>{formatDate(row.timestamp, language)}</time><span title={row.logStreamName}>{row.logStreamName}</span></header><pre>{String(row.message ?? '').trimEnd()}</pre></article>)}
      {browse.busy && !browse.rows.length && <div className="empty-result" role="status"><Loader2 size={22} className="spin"/></div>}
      {browse.loaded && !browse.busy && !browse.error && !browse.rows.length && <div className="empty-result"><FileText size={26}/><p>{browse.next ? tr('이 페이지에는 이벤트가 없습니다. 더 불러와 보세요.', 'No events on this page. Try loading more.') : tr('조건에 맞는 로그 이벤트가 없습니다.', 'No matching log events.')}</p></div>}
    </div>
    <div className="result-footer"><span>{browse.rows.length} {tr('이벤트', browse.rows.length === 1 ? 'event' : 'events')}{browse.next ? '+' : ''} · {tr('오래된 순', 'Oldest first')}</span>{browse.next && <Button variant="outline" size="xs" disabled={browse.busy} onClick={() => search(true)}>{tr('더 불러오기', 'Load more')}</Button>}</div>
  </>;
}
