import { useEffect, useMemo, useRef, useState } from 'react';
import { DatabaseZap, Plus, RefreshCw, PanelLeftClose, PanelLeftOpen, Search, PlugZap, Unplug, Settings2, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { NativeSelect } from '../components/ui/native-select';
import { useConfirm } from '../components/ConfirmProvider';
import { useLanguage } from '../i18n';
import { desktop } from '../api';
import type { Theme } from '../theme';
import { redisApi } from './api';
import { errorText, mergeKeys, ttlBucket, TYPES, type KeyMeta, type QueueInfo, type RedisProfile, type RedisValue, type SavedView, type TtlBucket } from './model';
import { RequestGate } from './state';
import { ConnectionDialog } from './ConnectionDialog';
import { ViewDialog } from './ViewDialog';
import { KeyExplorer, KeyTree } from './KeyExplorer';
import { KeyDetail } from './KeyDetail';
import { CacheView } from './CacheView';
import { QueueView } from './QueueView';
import { SidebarTitle } from '../components/SidebarTitle';
import './redis.css';
import { LiveFlow } from './flow/LiveFlow';

type Props = { visible: boolean; sidebarOpen: boolean; onToggleSidebar: () => void; theme: Theme };
function preference(key: string, fallback = '') { try { return localStorage.getItem(`woojoo-redis-${key}`) ?? fallback; } catch { return fallback; } }
function savePreference(key: string, value: string) { try { localStorage.setItem(`woojoo-redis-${key}`, value); } catch { /* Presentation preferences only. */ } }
export function RedisWorkspace({ visible, sidebarOpen, onToggleSidebar, theme }: Props) {
  const { language } = useLanguage(); const ko = language === 'ko'; const tr = (koText: string, en: string) => ko ? koText : en;
  const { requestConfirm } = useConfirm();
  const [demo, setDemo] = useState(false); const api = useMemo(() => redisApi(demo), [demo]);
  const [profiles, setProfiles] = useState<RedisProfile[]>([]), [views, setViews] = useState<SavedView[]>([]), [credentialSupported, setCredentialSupported] = useState(false);
  const [profileId, setProfileId] = useState(() => preference('profile')), [session, setSession] = useState('');
  const profile = profiles.find(p => p.id === profileId);
  const [connectionDialog, setConnectionDialog] = useState<{ profile?: RedisProfile } | null>(null), [viewDialog, setViewDialog] = useState<SavedView | null>(null);
  const [mode, setMode] = useState<'keys' | 'cache' | 'queue'>(() => { const p = preference('mode'); return p === 'cache' || p === 'queue' ? p : 'keys'; });
  const [presentation, setPresentation] = useState<'flow' | 'list'>('flow');
  const [patternInput, setPatternInput] = useState('*'), [pattern, setPattern] = useState('*'), [typeFilter, setTypeFilter] = useState('');
  const [keys, setKeys] = useState<KeyMeta[]>([]), [cursor, setCursor] = useState('0'), [complete, setComplete] = useState(false), [limited, setLimited] = useState(false), [observedAt, setObservedAt] = useState(0), [dbSize, setDbSize] = useState<string | null>(null);
  const [selected, setSelected] = useState<KeyMeta | null>(null), [value, setValue] = useState<RedisValue | null>(null), [detailError, setDetailError] = useState('');
  const [scanBusy, setScanBusy] = useState(false), [detailBusy, setDetailBusy] = useState(false), [connectBusy, setConnectBusy] = useState(false), [queueBusy, setQueueBusy] = useState(false);
  const [error, setError] = useState(''), [bucket, setBucket] = useState<TtlBucket | ''>(''), [queueId, setQueueId] = useState(''), [group, setGroup] = useState(''), [queueInfo, setQueueInfo] = useState<QueueInfo | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false), [serverInfo, setServerInfo] = useState<string | null>(null);
  const [topologyVerified, setTopologyVerified] = useState(false);
  const gate = useRef(new RequestGate()); const connectSerial = useRef(0); const scanLock = useRef(false); const detailLock = useRef(false); const queueLock = useRef(false);
  const latest = useRef({ session, visible, selected, queueId, group }); latest.current = { session, visible, selected, queueId, group };
  const localViews = views.filter(v => v.profileId === profileId && v.db === profile?.db);
  const currentQueue = localViews.find(v => v.id === queueId) ?? localViews.find(v => v.kind === 'list' || v.kind === 'stream');

  function invalidate(preserveCursors = false) { const ids = preserveCursors ? ['scan', 'detail', 'queue', 'info'].flatMap(lane => { const id = gate.current.cancel(lane); return id ? [id] : []; }) : gate.current.reset(); ids.forEach(id => { if (latest.current.session) void api.cancel(latest.current.session, id).catch(() => {}); }); scanLock.current = false; detailLock.current = false; queueLock.current = false; setScanBusy(false); setDetailBusy(false); setQueueBusy(false); }
  function clearData() { invalidate(); setKeys([]); setSelected(null); setValue(null); setDetailError(''); setQueueInfo(null); setQueueId(''); setGroup(''); setCursor('0'); setComplete(false); setLimited(false); setObservedAt(0); setDbSize(null); setServerInfo(null); setBucket(''); }
  async function reloadWorkspace() { const ws = await api.load(); setProfiles(ws.profiles); setViews(ws.views); setCredentialSupported(ws.credentialSupported); return ws; }
  useEffect(() => {
    let cancelled = false;
    if (!desktop && !demo) return;
    void api.load().then(async ws => { if (cancelled) return; setProfiles(ws.profiles); setViews(ws.views); setCredentialSupported(ws.credentialSupported);
      if (demo && ws.profiles[0]) { const p = ws.profiles[0]; const result = await api.connect(p, null, false); if (cancelled) { await api.disconnect(result.sessionId); return; } setProfileId(p.id); setSession(result.sessionId); setMode('keys'); }
    }).catch(e => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [api, demo]);
  useEffect(() => { if (session) void scan('*', '', '0', false); }, [session]);
  useEffect(() => { if (!visible) invalidate(true); }, [visible]);
  useEffect(() => () => { connectSerial.current++; const s = latest.current.session; gate.current.reset(); if (s) void api.disconnect(s).catch(() => {}); }, [api]);
  useEffect(() => { savePreference('mode', mode); }, [mode]);

  async function scan(nextPattern = pattern, nextType = typeFilter, nextCursor = '0', append = false, preserveSelection = false) {
    const s = latest.current.session; if (!s || scanLock.current) return;
    if (!append) { invalidate(); if (!preserveSelection) { setKeys([]); setSelected(null); setValue(null); setDetailError(''); } setComplete(false); setLimited(false); if (!preserveSelection) setBucket(''); setPattern(nextPattern); setPatternInput(nextPattern); setTypeFilter(nextType); }
    scanLock.current = true; setScanBusy(true); setError(''); const ticket = gate.current.begin('scan');
    try { const result = await api.scan({ sessionId: s, ...ticket, pattern: nextPattern || '*', typeFilter: nextType, cursor: nextCursor });
      if (!gate.current.current(ticket)) return;
      setKeys(previous => { const merged = mergeKeys(append ? previous : [], result.keys); setLimited(merged.limited); return merged.keys; });
      setCursor(result.nextCursor); setComplete(result.nextCursor === '0'); setObservedAt(result.observedAt); setDbSize(result.dbSize); setTopologyVerified(result.topologyVerified === true);
    } catch (e) { if (gate.current.current(ticket)) setError(errorText(e)); }
    finally { if (gate.current.current(ticket)) { scanLock.current = false; setScanBusy(false); } }
  }
  async function readValue(meta: KeyMeta, nextCursor?: string, keep = false, fetchMetadata = false) {
    const s = latest.current.session; if (!s) return;
    const previous = gate.current.cancel('detail'); if (previous) void api.cancel(s, previous).catch(() => {});
    const ticket = gate.current.begin('detail'); detailLock.current = true; setDetailBusy(true); setDetailError(''); if (!keep) setValue(null); setSelected(meta);
    try {
      if (fetchMetadata) { const resolved = await api.metadata({ sessionId: s, ...ticket, keyBase64: meta.key.base64 }); if (!gate.current.current(ticket)) return; setSelected(resolved); }
      const result = await api.value({ sessionId: s, ...ticket, keyBase64: meta.key.base64, cursor: nextCursor }); if (gate.current.current(ticket)) setValue(result);
    }
    catch (e) { if (gate.current.current(ticket)) setDetailError(errorText(e)); }
    finally { if (gate.current.current(ticket)) { detailLock.current = false; setDetailBusy(false); } }
  }
  async function openSavedKey(keyBase64: string) {
    await readValue({ key: { text: '', utf8: false, base64: keyBase64 }, type: 'unknown', ttlMs: null, length: null, error: null }, undefined, false, true);
  }
  async function inspectQueue(view: SavedView, nextGroup = '') {
    const s = latest.current.session; const old = gate.current.cancel('queue'); if (s && old) void api.cancel(s, old).catch(() => {});
    if (!s || view.kind !== 'stream') { queueLock.current = false; setQueueBusy(false); setQueueInfo(null); return; }
    const ticket = gate.current.begin('queue'); queueLock.current = true; setQueueBusy(true);
    try { const result = await api.queue({ sessionId: s, ...ticket, keyBase64: view.keyBase64, group: nextGroup || undefined }); if (gate.current.current(ticket)) setQueueInfo(result); }
    catch (e) { if (gate.current.current(ticket)) setError(errorText(e)); }
    finally { if (gate.current.current(ticket)) { queueLock.current = false; setQueueBusy(false); } }
  }
  function chooseQueue(view: SavedView) { setMode('queue'); setQueueId(view.id); setGroup(''); setQueueInfo(null); void openSavedKey(view.keyBase64); void inspectQueue(view); }
  useEffect(() => {
    if (!autoRefresh || !visible || !session || (mode !== 'keys' && presentation === 'flow')) return;
    const timer = setInterval(() => { const now = latest.current; if (!now.visible) return; if (now.selected && !detailLock.current) void readValue(now.selected, undefined, true); const q = views.find(v => v.id === now.queueId); if (q && !queueLock.current) void inspectQueue(q, now.group); }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, visible, session, views, api, mode, presentation]);
  async function saveProfile(p: RedisProfile) { if (!desktop && !demo) throw tr('실제 Redis 연결과 프로필 저장은 데스크톱 앱에서 사용할 수 있습니다.', 'Use the desktop app for Redis connections and profile storage.'); await api.saveProfile(p); await reloadWorkspace(); if (p.id === profileId && session) { clearData(); await api.disconnect(session); setSession(''); } setProfileId(p.id); savePreference('profile', p.id); }
  async function connect(p: RedisProfile, password: string | null, remember: boolean) {
    if (!desktop && !demo) throw tr('실제 Redis 연결은 데스크톱 앱에서 사용할 수 있습니다.', 'Redis connections require the desktop app.');
    const serial = ++connectSerial.current; setConnectBusy(true); let opened = ''; let adopted = false;
    const current = () => serial === connectSerial.current;
    try { const result = await api.connect(p, password, remember); opened = result.sessionId;
      if (!current()) return;
      await api.saveProfile(p); if (!current()) return;
      const ws = await api.load(); if (!current()) return;
      const old = latest.current.session; if (old) await api.disconnect(old); if (!current()) return;
      clearData(); setProfiles(ws.profiles); setViews(ws.views); setCredentialSupported(ws.credentialSupported);
      setProfileId(p.id); savePreference('profile', p.id); setSession(opened); adopted = true; setError('');
    } finally { if (opened && !adopted) await api.disconnect(opened).catch(() => {}); if (current()) setConnectBusy(false); }
  }
  async function disconnect() { const old = session; connectSerial.current++; setConnectBusy(false); clearData(); setSession(''); if (old) await api.disconnect(old); }
  async function exitDemo() { await disconnect(); setProfiles([]); setViews([]); setProfileId(preference('profile')); setConnectionDialog(null); setViewDialog(null); setDemo(false); setError(''); }
  async function selectProfile(id: string) { try { await disconnect(); setProfileId(id); savePreference('profile', id); } catch (e) { setError(errorText(e)); } }
  async function deleteProfile() { if (!profile) return; const yes = await requestConfirm(tr(`${profile.name} 프로필을 삭제할까요? Redis 데이터는 유지됩니다.`, `Delete ${profile.name}? Redis data is retained.`), { title: tr('연결 프로필 삭제', 'Delete connection profile'), confirmLabel: tr('삭제', 'Delete'), destructive: true }); if (!yes) return; try { await disconnect(); await api.deleteProfile(profile.id); await reloadWorkspace(); setProfileId(''); } catch (e) { setError(errorText(e)); } }
  function newView(kind: SavedView['kind']) { if (!profile) return; setViewDialog({ id: crypto.randomUUID(), profileId: profile.id, db: profile.db, kind, name: kind === 'cache' ? pattern : selected?.key.text ?? '', pattern: kind === 'cache' ? pattern : '', keyBase64: selected?.key.base64 ?? '', direction: 'unknown' }); }
  async function removeView(id: string) { try { await api.deleteView(id); await reloadWorkspace(); if (queueId === id) { setQueueId(''); setQueueInfo(null); } } catch (e) { setError(errorText(e)); } }
  async function loadServerInfo() { if (!session) return; const ticket = gate.current.begin('info'); try { const info = await api.info({ sessionId: session, ...ticket }); if (gate.current.current(ticket)) { setServerInfo(info.info); if (info.errors.length) setError(info.errors.join('\n')); } } catch (e) { if (gate.current.current(ticket)) setError(errorText(e)); } }
  const filtered = bucket ? keys.filter(k => ttlBucket(k.ttlMs) === bucket) : keys;
  const savedButton = (view: SavedView) => <div className="redis-saved-view" key={view.id}><button onClick={() => { if (view.kind === 'cache') { setMode('cache'); void scan(view.pattern, '', '0', false); } else if (view.kind === 'favorite') { setMode('keys'); void openSavedKey(view.keyBase64); } else chooseQueue(view); }} disabled={!session}>{view.name}</button><Button variant="ghost" size="icon-xs" title={tr('보기 편집', 'Edit view')} aria-label={`${tr('보기 편집', 'Edit view')} ${view.name}`} onClick={() => setViewDialog(view)}><Settings2 size={12}/></Button><Button variant="ghost" size="icon-xs" className="redis-danger" title={tr('보기 삭제', 'Delete view')} aria-label={`${tr('보기 삭제', 'Delete view')} ${view.name}`} onClick={() => void removeView(view.id)}><Trash2 size={12}/></Button></div>;

  return <div className={`redis-workspace ${sidebarOpen ? '' : 'redis-sidebar-collapsed'}`} style={!visible ? { display: 'none' } : undefined}>
    {sidebarOpen && <aside className="redis-sidebar"><SidebarTitle icon={DatabaseZap} title="Redis"/>
      <div className="redis-connection-picker"><div className="redis-section-heading"><h3>{tr('연결', 'Connection')}</h3><Button size="icon-xs" disabled={demo} aria-label={tr('연결 추가', 'Add connection')} onClick={() => setConnectionDialog({})}><Plus size={14}/></Button></div>
        <NativeSelect aria-label={tr('Redis 연결 선택', 'Select Redis connection')} value={profileId} disabled={connectBusy} onChange={e => void selectProfile(e.target.value)}><option value="">{tr('연결 선택', 'Select connection')}</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name} · DB {p.db}</option>)}</NativeSelect>
      </div>
      <div className="redis-sidebar-section"><h3>{tr('저장한 보기', 'Saved views')}</h3>{localViews.map(savedButton)}</div>
      <div className="redis-sidebar-section"><h3>{tr('키 탐색', 'Key explorer')} <small>{keys.length}</small></h3><KeyTree keys={keys} separator={profile?.separator ?? ':'} onOpen={meta => void readValue(meta)} selected={selected?.key.base64 ?? ''}/></div>
    </aside>}
    <main className="redis-main">
      <header className="redis-toolbar"><Button variant="ghost" size="icon" aria-label={tr('사이드바 전환', 'Toggle sidebar')} onClick={onToggleSidebar}>{sidebarOpen ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={17}/>}</Button><h1>Redis</h1>
        {!sidebarOpen && <NativeSelect aria-label={tr('Redis 연결 선택', 'Select Redis connection')} value={profileId} disabled={connectBusy} onChange={e => void selectProfile(e.target.value)}><option value="">{tr('연결 선택', 'Select connection')}</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name} · DB {p.db}</option>)}</NativeSelect>}
        <span className={`redis-status ${session ? 'connected' : ''}`}>{session ? tr('연결됨', 'Connected') : tr('연결 안 됨', 'Disconnected')}{demo ? ' · DEMO' : ''}</span><span className="redis-toolbar-spacer"/>
        {demo && <Button variant="outline" onClick={() => void exitDemo()}>{tr('데모 종료', 'Exit demo')}</Button>}
        {profile && !demo && <><Button variant="ghost" size="icon" title={tr('연결 편집', 'Edit connection')} aria-label={tr('연결 편집', 'Edit connection')} disabled={connectBusy} onClick={() => setConnectionDialog({ profile })}><Settings2 size={16}/></Button><Button className="redis-danger" variant="ghost" size="icon" aria-label={tr('연결 프로필 삭제', 'Delete connection profile')} onClick={() => void deleteProfile()}><Trash2 size={16}/></Button></>}
        {session ? <Button variant="outline" onClick={() => void disconnect().catch(e => setError(errorText(e)))}><Unplug size={14}/>{tr('연결 끊기', 'Disconnect')}</Button> : <Button variant="outline" disabled={!profile || connectBusy || demo} onClick={() => profile && setConnectionDialog({ profile })}><PlugZap size={14}/>{tr('연결', 'Connect')}</Button>}
        {!sidebarOpen && <Button disabled={demo} onClick={() => setConnectionDialog({})}><Plus size={14}/>{tr('연결 추가', 'Add connection')}</Button>}
      </header>
      {error && <div role="alert" className="redis-error redis-banner">{error}<button onClick={() => setError('')} aria-label={tr('오류 닫기', 'Dismiss error')}>×</button></div>}
      {!session ? <div className="redis-welcome"><DatabaseZap size={44}/><h2>{tr('Redis에 연결', 'Connect to Redis')}</h2><div><Button disabled={demo} onClick={() => setConnectionDialog({})}>{tr('새 연결 만들기', 'Create connection')}</Button>{!demo && <Button variant="outline" onClick={() => { clearData(); setError(''); setDemo(true); }}>{tr('데모 살펴보기', 'Explore demo')}</Button>}</div><p className="redis-muted">{tr('Standalone Redis · 조회 전용', 'Standalone Redis · Read only')}{!desktop && ` · ${tr('실제 접속은 데스크톱 앱에서 지원합니다.', 'Live connections require the desktop app.')}`}</p></div> : <>
        <div className="redis-modebar"><div className="redis-segments">{(['keys', 'cache', 'queue'] as const).map(m => <button key={m} aria-pressed={mode === m} onClick={() => { setMode(m); setBucket(''); }}>{m === 'keys' ? tr('키', 'Keys') : m === 'cache' ? tr('캐시', 'Cache') : tr('큐', 'Queues')}</button>)}</div><span>{profile?.environment} · {profile?.host}:{profile?.port} · DB {profile?.db}</span><span className="redis-toolbar-spacer"/>{mode !== 'keys' && <div className="redis-segments"><button aria-pressed={presentation === 'flow'} onClick={() => setPresentation('flow')}>{tr('흐름', 'Flow')}</button><button aria-pressed={presentation === 'list'} onClick={() => setPresentation('list')}>{tr('목록', 'List')}</button></div>}{(mode === 'keys' || presentation === 'list') && <label className="redis-check"><input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}/>{tr('선택 항목 5초 갱신', 'Refresh selection every 5s')}</label>}</div>
        {mode !== 'queue' && <><form className="redis-searchbar" onSubmit={e => { e.preventDefault(); void scan(patternInput, typeFilter); }}><Search size={15}/><Input aria-label={tr('키 패턴 검색', 'Key pattern search')} placeholder="user:*" value={patternInput} onChange={e => setPatternInput(e.target.value)}/><NativeSelect aria-label={tr('자료형 필터', 'Type filter')} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="">{tr('모든 자료형', 'All types')}</option>{TYPES.map(t => <option key={t}>{t}</option>)}</NativeSelect><Button type="submit" disabled={scanBusy}>{tr('검색', 'Search')}</Button><Button type="button" variant="ghost" disabled={scanBusy} onClick={() => void scan(pattern, typeFilter, '0', false, true)} aria-label={tr('키 새로고침', 'Refresh keys')}><RefreshCw size={15}/></Button>{mode === 'cache' && <Button type="button" onClick={() => newView('cache')}>{tr('패턴 저장', 'Save pattern')}</Button>}</form>
</>}
        {observedAt > 0 && !topologyVerified && <p className="redis-warning">{tr('서버 구성 확인 권한이 없습니다.\n연결 서버의 결과만 표시합니다.', 'Topology unverified. Results cover this endpoint only.')}</p>}
        {mode === 'cache' && presentation === 'list' && <><CacheView keys={keys} bucket={bucket} onBucket={setBucket} observedAt={observedAt} complete={complete}/><div className="redis-server-info"><Button variant="ghost" onClick={() => void loadServerInfo()}>{tr('서버 누적 hit/miss', 'Server hits/misses (cumulative)')}</Button>{serverInfo && <span>{serverInfo.split(/\r?\n/).filter(l => /^keyspace_(hits|misses):/.test(l)).join(' · ') || tr('지표 없음', 'Metrics unavailable')}</span>}</div></>}
        {mode !== 'keys' && <div className="redis-flow-host" style={presentation !== 'flow' ? { display: 'none' } : undefined}><LiveFlow key={`${session}:${mode}:${mode === 'queue' ? currentQueue?.id : pattern}`} api={api} session={session} active={visible && presentation === 'flow'} demo={demo} mode={mode} keys={filtered} pattern={pattern} queue={currentQueue} queues={localViews.filter(v => v.kind === 'list' || v.kind === 'stream')} onQueue={chooseQueue} theme={theme} ko={ko} separator={profile?.separator ?? ':'}/></div>}{(mode === 'keys' || presentation === 'list') && <div className={`redis-content ${selected ? 'has-detail' : ''}`}>
          <section className="redis-results">{mode === 'queue' ? <><div className="redis-queue-picker">{localViews.filter(v => v.kind === 'list' || v.kind === 'stream').map(savedButton)}</div><QueueView view={currentQueue} info={queueInfo} group={group} onGroup={g => { setGroup(g); if (currentQueue) void inspectQueue(currentQueue, g); }} busy={queueBusy}/></> : <><div className="redis-scan-status"><span>{tr(`탐색 ${keys.length.toLocaleString()}개`, `${keys.length.toLocaleString()} discovered`)}{dbSize !== null && ` / ${(topologyVerified ? tr('DB 전체', 'DB total') : tr('연결 서버', 'Endpoint'))} ${dbSize}`} · {complete ? tr('탐색 완료', 'Scan complete') : tr('일부 탐색', 'Partial scan')}{observedAt > 0 && ` · ${new Date(observedAt).toLocaleTimeString(ko ? 'ko-KR' : 'en-US')}`}</span>{scanBusy ? <Button variant="ghost" onClick={() => { const id = gate.current.cancel('scan'); if (id) void api.cancel(session, id).catch(() => {}); scanLock.current = false; setScanBusy(false); }}>{tr('중단', 'Stop')}</Button> : <Button variant="ghost" disabled={complete || limited} onClick={() => void scan(pattern, typeFilter, cursor, true)}>{tr('더 불러오기', 'Load more')}</Button>}</div>{limited && <p className="redis-warning">{tr('탐색 보관 한도에 도달했습니다. 검색 범위를 좁혀주세요.', 'Discovery limit reached. Narrow the key pattern.')}</p>}<KeyExplorer keys={filtered} selected={selected?.key.base64 ?? ''} onOpen={meta => void readValue(meta)} complete={complete} busy={scanBusy}/></>}
          </section>
          {selected && <KeyDetail value={value} busy={detailBusy} error={detailError} onPage={c => void readValue(selected, c)} onRefresh={() => void readValue(selected, undefined, true)} onClose={() => { const id = gate.current.cancel('detail'); if (id) void api.cancel(session, id).catch(() => {}); setSelected(null); setValue(null); detailLock.current = false; setDetailBusy(false); }} onFavorite={() => newView('favorite')} onQueue={() => newView(value?.type === 'stream' ? 'stream' : 'list')}/>}
        </div>}
      </>}
    </main>
    {connectionDialog && <ConnectionDialog profile={connectionDialog.profile} api={api} credentialSupported={credentialSupported} onClose={() => setConnectionDialog(null)} onSave={saveProfile} onConnect={connect}/>}
    {viewDialog && <ViewDialog initial={viewDialog} onClose={() => setViewDialog(null)} onSave={async view => { await api.saveView(view); await reloadWorkspace(); }}/ >}
  </div>;
}
