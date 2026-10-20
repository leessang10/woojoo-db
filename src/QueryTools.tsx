import { useConfirm } from './components/ConfirmProvider';
import { useEffect, useRef, useState } from 'react';
import { ModalSurface } from './components/ModalSurface';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useLanguage } from './i18n';
import type { Engine, Result } from './model';
import { appendQueryHistory, bindParameters, executeScript, explainSql, formatSql, HISTORY_KEY, parameterNames, readQueryHistory, type Parameter, type ScriptResult } from './sql-workbench';

export type SqlFileMetadata = { path: string | null; name: string; savedSql: string };
type NativeFile = { path: string; name: string; sql: string };
export type QueryToolsProps = {
  engine: Engine; session: string | null; sql: string; disabled?: boolean;
  onSqlChange: (sql: string) => void;
  onExecute: (sql: string) => Promise<Result>;
  onResults?: (results: ScriptResult[]) => void;
  onFileChange?: (file: SqlFileMetadata) => void;
  onBusyChange?: (busy: boolean) => void;
  initialFile?: SqlFileMetadata | null;
  historyKey?: string;
  connectionName?: string;
  beforeExecute?: () => boolean | Promise<boolean>;
};

export function QueryTools({ engine, session, sql, disabled, onSqlChange, onExecute, onResults, onFileChange, onBusyChange, initialFile, historyKey, connectionName, beforeExecute }: QueryToolsProps) {
  const { language } = useLanguage();
  const { requestConfirm } = useConfirm();
  const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [file, setFile] = useState<SqlFileMetadata | null>(initialFile ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(() => readQueryHistory(historyKey));
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<{ sql: string; names: string[] } | null>(null);
  const [parameters, setParameters] = useState<Record<string, Parameter>>({});
  const [summary, setSummary] = useState('');
  const browserFile = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const [execution, setExecution] = useState({ manual: false, inTransaction: false, running: false, readOnly: false, transactionStateKnown:true });
  const nativeSession = isTauri() && !!session && session !== 'demo';
  useEffect(() => {
    if (!nativeSession) return;
    let active = true;
    const refresh = () => { void invoke<typeof execution>('execution_state', { id: session }).then(value => { if (active) setExecution(value); }).catch(() => {}); };
    refresh(); const timer = setInterval(refresh, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [nativeSession, session]);
  async function control(command: string, args: Record<string, unknown> = {}) {
    try {
      await invoke(command, { id: session, ...args });
      setExecution(await invoke<typeof execution>('execution_state', { id: session })); setError('');
    } catch (e) { setError(String(e)); }
  }
  const dirty = file ? sql !== file.savedSql : !!sql.trim();
  const remember = (next: SqlFileMetadata) => { setFile(next); onFileChange?.(next); };
  const accept = (next: NativeFile) => { onSqlChange(next.sql); remember({ path: next.path, name: next.name, savedSql: next.sql }); };
  async function open() {
    setError('');
    if (dirty && !await requestConfirm(tr('저장하지 않은 SQL을 바꾸시겠습니까?', 'Replace the unsaved SQL?'))) return;
    try {
      if (!isTauri()) { browserFile.current?.click(); return; }
      const next = await invoke<NativeFile | null>('sql_open_file'); if (next) accept(next);
    } catch (e) { setError(String(e)); }
  }
  async function save(as: boolean) {
    setError('');
    try {
      if (isTauri()) {
        const next = await invoke<NativeFile | null>('sql_save_file', { path: as ? null : file?.path ?? null, sql });
        if (next) remember({ path: next.path, name: next.name, savedSql: next.sql });
      } else {
        const url = URL.createObjectURL(new Blob([sql], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a'); a.href = url; a.download = file?.name ?? 'query.sql'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        // A browser download cannot confirm that a file was actually saved.
        setSummary(tr('SQL 다운로드를 요청했습니다.', 'SQL download requested.'));
      }
    } catch (e) { setError(String(e)); }
  }
  async function execute(source: string, values?: Record<string, Parameter>) {
    if (!session || busy || disabled) return;
    setError(''); setSummary('');
    let started = false;
    try {
      const names = parameterNames(source, engine);
      if (names.length && !values) {
        setParameters(Object.fromEntries(names.map(name => [name, { type: 'text', value: '' }])));
        setPending({ sql: source, names }); return;
      }
      const rendered = values ? bindParameters(source, engine, values) : source;
      if (beforeExecute && !await beforeExecute()) return;
      started = true; setPending(null); cancelled.current = false; setBusy(true); onBusyChange?.(true);
      const results = await executeScript(rendered, engine, onExecute, onResults, () => cancelled.current);
      const failure = results.find(result => result.error);
      if (failure) setError(`${tr('문장', 'Statement')} ${failure.index}: ${failure.error}`);
      setSummary(`${results.length} ${tr('문장 실행', 'statements executed')}`);
      if (results.length) {
        const persisted = appendQueryHistory({ id: crypto.randomUUID(), sql: source, engine, at: new Date().toISOString(), success: !failure, count: results.length, duration: results.reduce((sum, entry) => sum + (entry.result?.elapsedMs ?? 0), 0), connection: historyKey, connectionName });
        setHistory(readQueryHistory(historyKey));
        if (!persisted) setError(tr('쿼리는 실행했지만 로컬 기록을 저장할 수 없습니다.', 'Query executed, but local history could not be saved.'));
      }
    } catch (e) { setError(String(e)); }
    finally { if (started) { setBusy(false); onBusyChange?.(false); } }
  }
  const buttonDisabled = busy || disabled;
  return <div className="query-tools" style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Button variant="outline" size="xs" disabled={buttonDisabled} onClick={() => void open()}>{tr('SQL 열기', 'Open SQL')}</Button>
      <Button variant="outline" size="xs" disabled={buttonDisabled} onClick={() => void save(false)}>{isTauri() ? tr('저장', 'Save') : tr('다운로드', 'Download')}</Button>
      {isTauri() && <Button variant="outline" size="xs" disabled={buttonDisabled} onClick={() => void save(true)}>{tr('다른 이름으로 저장', 'Save as')}</Button>}
      <Button variant="outline" size="xs" disabled={buttonDisabled || !sql.trim()} onClick={() => { try { onSqlChange(formatSql(sql, engine)); setError(''); } catch (e) { setError(String(e)); } }}>{tr('SQL 정렬', 'Format SQL')}</Button>
      <Button variant="outline" size="xs" disabled={buttonDisabled || !session || !sql.trim()} onClick={() => void execute(sql)}>{tr('스크립트 실행', 'Run script')}</Button>
      <Button variant="outline" size="xs" disabled={buttonDisabled || !session || !sql.trim()} onClick={() => { try { void execute(explainSql(sql, engine)); } catch (e) { setError(String(e)); } }}>EXPLAIN</Button>
      <Button variant="outline" size="xs" onClick={() => { setHistory(readQueryHistory(historyKey)); setHistoryOpen(value => !value); }}>{tr('저장된 기록', 'Saved history')}</Button>
      {nativeSession && <>
        <Button variant="outline" size="xs" disabled={buttonDisabled || execution.running || execution.readOnly || execution.inTransaction && execution.manual} onClick={() => void control('transaction_mode', { manual: !execution.manual })}>{execution.manual ? tr('수동 커밋', 'Manual commit') : tr('자동 커밋', 'Auto commit')}</Button>
        <Button variant="outline" size="xs" disabled={buttonDisabled || execution.running || !execution.inTransaction} onClick={() => void control('transaction_finish', { commit: true })}>COMMIT</Button>
        <Button variant="outline" size="xs" disabled={buttonDisabled || execution.running || !execution.inTransaction} onClick={() => void control('transaction_finish', { commit: false })}>ROLLBACK</Button>
        <Button variant="outline" size="xs" disabled={!execution.running && !busy && !disabled} onClick={() => { cancelled.current = true; void control('cancel_query'); }}>{tr('실행 취소', 'Cancel query')}</Button>
      </>}
      {file && <span title={file.path ?? file.name}>{file.name}{dirty ? ' •' : ''}</span>}
      {summary && <span role="status">{summary}</span>}
    </div>
    {execution.transactionStateKnown===false&&<p role="status">{tr('서버 스크립트 실행 후 트랜잭션 상태를 확인할 수 없습니다. COMMIT 또는 ROLLBACK으로 종료하세요.','Transaction state is unknown after the server script. Finish with COMMIT or ROLLBACK.')}</p>}
    <Input ref={browserFile} type="file" accept=".sql,text/plain" hidden onChange={async event => {
      const selected = event.target.files?.[0]; event.target.value = '';
      if (!selected) return;
      try {
        if (selected.size > 10_000_000) throw new Error(tr('SQL 파일은 10 MB 이하여야 합니다.', 'SQL files must be under 10 MB.'));
        const contents = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer());
        onSqlChange(contents); remember({ path: null, name: selected.name, savedSql: contents });
      } catch (e) { setError(String(e)); }
    }} />
    {error && !pending && <p role="alert" style={{ color: 'var(--destructive, #ef6464)', whiteSpace: 'pre-wrap' }}>{error}</p>}
    {pending && <ModalSurface title={tr('SQL 매개변수', 'SQL parameters')} onClose={() => setPending(null)}><section className="modal" role="dialog" aria-label={tr('SQL 매개변수', 'SQL parameters')}>
      <p>{tr('매개변수 값은 기록에 저장하지 않습니다. 문자열, 숫자, boolean 또는 NULL을 선택하세요.', 'Parameter values are not stored in history. Choose text, number, boolean or NULL.')}</p>
      {pending.names.map(name => <label key={name} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <span>:{name}</span>
        <NativeSelect aria-label={`${name} ${tr('타입', 'type')}`} value={parameters[name].type} onChange={event => setParameters(previous => ({ ...previous, [name]: { ...previous[name], type: event.target.value as Parameter['type'] } }))}>
          <option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="null">NULL</option>
        </NativeSelect>
        <Input aria-label={`${name} ${tr('값', 'value')}`} disabled={parameters[name].type === 'null'} value={parameters[name].value} onChange={event => setParameters(previous => ({ ...previous, [name]: { ...previous[name], value: event.target.value } }))} />
      </label>)}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <Button variant="outline" size="xs" onClick={() => void execute(pending.sql, parameters)}>{tr('실행', 'Run')}</Button>{' '}
      <Button variant="outline" size="xs" onClick={() => setPending(null)}>{tr('취소', 'Cancel')}</Button>
    </section></ModalSurface>}
    {historyOpen && <ModalSurface title={tr('쿼리 기록', 'Query history')} onClose={() => setHistoryOpen(false)}><section className="modal" aria-label={tr('쿼리 기록', 'Query history')} style={{ maxHeight: '75vh', overflow: 'auto', width: 650 }}>
      <div className="modal-heading"><h2>{tr('쿼리 기록', 'Query history')}</h2><Button variant="ghost" size="sm" onClick={() => setHistoryOpen(false)}>{tr('닫기', 'Close')}</Button></div>
      <p>{tr('최근 200개 SQL을 이 기기에 저장합니다. SQL에 직접 쓴 값도 저장됩니다.', 'The last 200 SQL entries are stored on this device, including values written directly in SQL.')}</p>
      <Input aria-label={tr('기록 검색', 'Search history')} placeholder={tr('SQL 검색', 'Search SQL')} value={search} onChange={event => setSearch(event.target.value)} />
      <Button variant="outline" size="xs" onClick={() => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyKey ? readQueryHistory().filter(entry => entry.connection !== historyKey) : [])); setHistory([]); } catch (e) { setError(String(e)); } }}>{tr('기록 지우기', 'Clear history')}</Button>
      {history.filter(entry => entry.sql.toLowerCase().includes(search.toLowerCase())).map(entry => <div key={entry.id} style={{ borderBottom: '1px solid var(--border)', padding: 6 }}>
        <Button variant="outline" size="xs" disabled={buttonDisabled} onClick={async () => {
          if (dirty && !await requestConfirm(tr('저장하지 않은 SQL을 바꾸시겠습니까?', 'Replace the unsaved SQL?'))) return;
          onSqlChange(entry.sql); setHistoryOpen(false);
        }}>{tr('불러오기', 'Load')}</Button> <small>{new Date(entry.at).toLocaleString()} · {entry.engine} · {entry.connectionName ?? connectionName ?? entry.connection ?? '—'} · {entry.duration ?? '—'} ms · {entry.success ? '✓' : '✕'}</small>
        <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{entry.sql}</pre>
      </div>)}
      {!history.length && <p>{tr('실행 기록이 없습니다.', 'No query history yet.')}</p>}
    </section></ModalSurface>}
  </div>;
}
