import { useConfirm } from './components/ConfirmProvider';
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { ModalSurface } from './components/ModalSurface';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useLanguage } from './i18n';
import type { Engine, Result } from './model';
import { appendQueryHistory, bindParameters, executeScript, explainSql, formatSql, parameterNames, type Parameter, type ScriptResult } from './sql-workbench';

export type SqlFileMetadata = { path: string | null; name: string; savedSql: string };
type NativeFile = { path: string; name: string; sql: string };
export type QueryToolsProps = {
  primaryAction?: ReactNode;
  /** Controls shown before the tool groups, such as the execution schema. */
  leadingAction?: ReactNode;
  onOpenCommonSql?: () => void;
  commonSqlDisabled?: boolean;
  engine: Engine; session: string | null; sql: string; disabled?: boolean;
  onSqlChange: (sql: string) => void;
  onExecute: (sql: string) => Promise<Result>;
  onResults?: (results: ScriptResult[]) => void;
  onFileChange?: (file: SqlFileMetadata) => void;
  onBusyChange?: (busy: boolean) => void;
  initialFile?: SqlFileMetadata | null;
  historyKey?: string;
  connectionName?: string;
  beforeExecute?: (sql: string) => boolean | Promise<boolean>;
  /** Lets global shortcuts reach this toolbar's commands. */
  commandsRef?: MutableRefObject<{ save?: () => void; runScript?: () => void; cancel?: () => void }>;
};

export function QueryTools({ onOpenCommonSql, commonSqlDisabled, primaryAction, leadingAction, engine, session, sql, disabled, onSqlChange, onExecute, onResults, onFileChange, onBusyChange, initialFile, historyKey, connectionName, beforeExecute, commandsRef }: QueryToolsProps) {
  const { language } = useLanguage();
  const { requestConfirm } = useConfirm();
  const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [file, setFile] = useState<SqlFileMetadata | null>(initialFile ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ sql: string; names: string[] } | null>(null);
  const [parameters, setParameters] = useState<Record<string, Parameter>>({});
  const [summary, setSummary] = useState('');
  const browserFile = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });
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
      if (beforeExecute && !await beforeExecute(rendered)) return;
      started = true; setPending(null); cancelled.current = false; setBusy(true); onBusyChange?.(true);
      const results = await executeScript(rendered, engine, onExecute, onResults, () => cancelled.current);
      const failure = results.find(result => result.error);
      if (failure) setError(`${tr('문장', 'Statement')} ${failure.index}: ${failure.error}`);
      setSummary(`${results.length} ${tr('문장 실행', 'statements executed')}`);
      if (results.length) {
        const persisted = appendQueryHistory({ id: crypto.randomUUID(), sql: source, engine, at: new Date().toISOString(), success: !failure, count: results.length, durationScope: 'db', duration: results.reduce((sum, entry) => sum + (entry.result?.elapsedMs ?? 0), 0), connection: historyKey, connectionName });
        if (!persisted) setError(tr('쿼리는 실행했지만 로컬 기록을 저장할 수 없습니다.', 'Query executed, but local history could not be saved.'));
      }
    } catch (e) { setError(String(e)); }
    finally { if (started) { setBusy(false); onBusyChange?.(false); } }
  }
  const buttonDisabled = busy || disabled;
  function cancel() { cancelled.current = true; void control('cancel_query'); }
  if (commandsRef) commandsRef.current = {
    save: () => void save(false),
    runScript: () => { if (!buttonDisabled && session && sql.trim()) void execute(sql); },
    cancel: nativeSession ? cancel : undefined,
  };
  useEffect(() => {
    // Hidden scrollbars need a visible cue when buttons are cut off.
    const element = scroller.current;
    if (!element) return;
    const update = () => setOverflow({ start: element.scrollLeft > 1, end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 });
    update();
    const observer = new ResizeObserver(update); observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
  }, [nativeSession, !!onOpenCommonSql]);
  return <div className="query-tools">
    <div className="query-toolbar">
      {leadingAction && <div className="query-leading-action">{leadingAction}</div>}
      <div className="query-toolbar-scroll" ref={scroller} data-overflow-start={overflow.start} data-overflow-end={overflow.end} onWheel={event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY; }}>
      <div className="query-tool-group" role="group" aria-label={tr('SQL 파일', 'SQL files')}>
      <Button variant="outline" size="xs" disabled={busy} onClick={() => void open()}>{tr('SQL 열기', 'Open SQL')}</Button>
      <Button variant="outline" size="xs" title={tr('Ctrl/Cmd+S', 'Ctrl/Cmd+S')} onClick={() => void save(false)}>{isTauri() ? tr('저장', 'Save') : tr('다운로드', 'Download')}</Button>
      {isTauri() && <Button variant="outline" size="xs" onClick={() => void save(true)}>{tr('다른 이름으로 저장', 'Save as')}</Button>}
      </div>
      <div className="query-tool-group" role="group" aria-label={tr('SQL 도구', 'SQL tools')}>
      <Button variant="outline" size="xs" disabled={busy || !sql.trim()} onClick={() => { try { onSqlChange(formatSql(sql, engine)); setError(''); } catch (e) { setError(String(e)); } }}>{tr('SQL 정렬', 'Format SQL')}</Button>
      <Button variant="outline" size="xs" title={tr('편집기 전체를 문장별로 실행 · Ctrl/Cmd+Shift+Enter', 'Run every statement · Ctrl/Cmd+Shift+Enter')} disabled={buttonDisabled || !session || !sql.trim()} onClick={() => void execute(sql)}>{tr('스크립트 실행', 'Run script')}</Button>
      <Button variant="outline" size="xs" disabled={buttonDisabled || !session || !sql.trim()} onClick={() => { try { void execute(explainSql(sql, engine)); } catch (e) { setError(String(e)); } }}>EXPLAIN</Button>
      </div>
      {onOpenCommonSql && <div className="query-tool-group" role="group" aria-label={tr('SQL 템플릿', 'SQL templates')}><Button variant="outline" size="xs" disabled={commonSqlDisabled || buttonDisabled} onClick={onOpenCommonSql}>{tr('자주 쓰는 SQL', 'Common SQL')}</Button></div>}
      {nativeSession && <div className="query-tool-group" role="group" aria-label={tr('트랜잭션', 'Transactions')}>
        <Button variant="outline" size="xs" disabled={buttonDisabled || execution.running || execution.readOnly || execution.inTransaction && execution.manual} onClick={() => void control('transaction_mode', { manual: !execution.manual })}>{execution.manual ? tr('수동 커밋', 'Manual commit') : tr('자동 커밋', 'Auto commit')}</Button>
        <Button variant="outline" size="xs" disabled={buttonDisabled || execution.running || !execution.inTransaction} onClick={() => void control('transaction_finish', { commit: true })}>COMMIT</Button>
        <Button variant="outline" size="xs" disabled={buttonDisabled || execution.running || !execution.inTransaction} onClick={() => void control('transaction_finish', { commit: false })}>ROLLBACK</Button>
        <Button variant="outline" size="xs" disabled={!execution.running && !busy && !disabled} onClick={cancel}>{tr('쿼리 중지', 'Stop query')}</Button>
      </div>}
      </div>
      {primaryAction && <div className="query-primary-action">{primaryAction}</div>}
    </div>
    {(file || summary) && <div className="query-tool-status">
      {file && <span title={file.path ?? file.name}>{file.name}{dirty ? ' •' : ''}</span>}
      {summary && <span role="status">{summary}</span>}
    </div>}
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
    {error && !pending && <p role="alert" className="query-tool-error">{error}</p>}
    {pending && <ModalSurface title={tr('SQL 매개변수', 'SQL parameters')} onClose={() => setPending(null)}><form className="modal" role="dialog" aria-label={tr('SQL 매개변수', 'SQL parameters')} onSubmit={event => { event.preventDefault(); void execute(pending.sql, parameters); }}>
      <div className="modal-heading"><h2>{tr('SQL 매개변수', 'SQL parameters')}</h2></div>
      <p className="modal-description">{tr('매개변수 값은 기록에 저장하지 않습니다. 문자열, 숫자, boolean 또는 NULL을 선택하세요.', 'Parameter values are not stored in history. Choose text, number, boolean or NULL.')}</p>
      {pending.names.map(name => <label key={name} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <span>:{name}</span>
        <NativeSelect aria-label={`${name} ${tr('타입', 'type')}`} value={parameters[name].type} onChange={event => setParameters(previous => ({ ...previous, [name]: { ...previous[name], type: event.target.value as Parameter['type'] } }))}>
          <option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="null">NULL</option>
        </NativeSelect>
        <Input aria-label={`${name} ${tr('값', 'value')}`} autoFocus={name === pending.names[0]} disabled={parameters[name].type === 'null'} value={parameters[name].value} onChange={event => setParameters(previous => ({ ...previous, [name]: { ...previous[name], value: event.target.value } }))} />
      </label>)}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" variant="outline" size="sm" onClick={() => setPending(null)}>{tr('취소', 'Cancel')}</Button><Button type="submit" size="sm">{tr('실행', 'Run')}</Button></div>
    </form></ModalSurface>}
  </div>;
}
