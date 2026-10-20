import { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql as sqlLanguage, PostgreSQL, MySQL } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Code2, Database, FileCode2, Filter, KeyRound, Layers3, Loader2, LockKeyhole, Plus, RefreshCw, Search, Settings2, Table2, Terminal, Trash2, Undo2, X, Zap } from 'lucide-react';
import * as api from './api';
import { collectEdits, csv, tableQuery, type Engine, type Profile, type Result, type Row, type Table } from './model';

const initialProfile: Profile = { id: 'demo', name: 'Woojoo playground', engine: 'postgres', host: 'demo.local', port: 5432, database: 'woojoo', username: 'postgres', password: '', tls: true };
type Connection = { profile: Profile; session: string };
const blankResult: Result = { columns: [], rows: [], elapsedMs: 0, affected: 0, truncated: false };

export default function App() {
  const [connections, setConnections] = useState<Connection[]>([{ profile: initialProfile, session: 'demo' }]);
  const [active, setActive] = useState('demo');
  const connection = connections.find(c => c.session === active)!;
  const [tableList, setTableList] = useState<Table[]>([]);
  const [selected, setSelected] = useState<Table | null>(null);
  const [editorSql, setEditorSql] = useState(tableQuery('postgres', 'public', 'users'));
  const [result, setResult] = useState<Result>(blankResult);
  const [source, setSource] = useState<'table' | 'query'>('table');
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<{ sql: string; time: string }[]>([]);
  const [scroll, setScroll] = useState(0);
  const [sort, setSort] = useState<{ name: string; desc: boolean } | null>(null);
  const [editing, setEditing] = useState<{ index: number; col: string; value: string; isNull: boolean } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const op = useRef(0);
  const busyRef = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const editorSelection = useRef('');
  const edits = collectEdits(result.rows, draft);
  const canEdit = source === 'table' && result.columns.some(c => c.primary);
  const runRef = useRef<() => void>(() => {});
  const askDiscard = () => !Object.keys(draftRef.current).length || confirm('저장하지 않은 변경 사항을 버릴까요?');
  function announce(text: string) { setNotice(text); window.setTimeout(() => setNotice(''), 4500); }
  async function perform(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { setError(String(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function openTable(table: Table, session = active, engine = connection.profile.engine) {
    if (busyRef.current || !askDiscard()) return;
    await perform(async () => {
      const data = await api.readTable(session, table);
      setSelected(table); setSource('table'); setResult(data); setDraft({}); setFilter(''); setSort(null); setScroll(0);
      setEditorSql(tableQuery(engine, table.schema, table.name));
    });
  }
  useEffect(() => {
    const token = ++op.current;
    busyRef.current = true; setBusy(true);
    setTableList([]); setSelected(null); setResult(blankResult); setDraft({}); setError('');
    api.tables(active).then(async list => {
      if (token !== op.current) return;
      setTableList(list);
      if (list.length) {
        const data = await api.readTable(active, list[0]);
        if (token !== op.current) return;
        setSelected(list[0]); setSource('table'); setResult(data);
        setEditorSql(tableQuery(connection.profile.engine, list[0].schema, list[0].name));
      }
    }).catch(e => { if (token === op.current) setError(String(e)); })
      .finally(() => { if (token === op.current) {busyRef.current = false; setBusy(false);} });
    return () => { op.current++; };
  }, [active]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); runRef.current(); }
      if (event.key === 'Escape') { setEditing(null); setShowHelp(false); }
    };
    const leave = (event: BeforeUnloadEvent) => { if (Object.keys(draftRef.current).length) event.preventDefault(); };
    window.addEventListener('keydown', key); window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', leave); };
  }, []);
  const run = () => {
    if (!askDiscard()) return;
    const text = editorSelection.current.trim() || editorSql.trim();
    if (!text) return;
    void perform(async () => {
      const data = await api.query(active, text);
      setResult(data); setSource('query'); setDraft({}); setFilter(''); setSort(null); setScroll(0);
      setHistory(h => [{ sql: text, time: new Date().toLocaleTimeString('ko-KR') }, ...h].slice(0, 30));
    });
  };
  runRef.current = run;
  async function applyChanges() {
    if (!selected) return;
    await perform(async () => {
      const count = await api.save(active, selected, edits);
      setDraft({}); setShowReview(false);
      announce(`${count}개 행의 변경 사항을 적용했습니다${active === 'demo' ? ' · 데모 메모리에 저장됨' : ''}.`);
      setResult(await api.readTable(active, selected));
    });
  }
  function exportCsv() {
    const content = csv(result.columns.map(c => c.name), result.rows);
    const url = URL.createObjectURL(new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${selected?.name ?? 'query'}-results.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const filtered = result.rows.map((row, index) => ({ row, index })).filter(({ row }) => !filter || Object.values(row).some(v => v?.toLowerCase().includes(filter.toLowerCase())));
  if (sort) filtered.sort((a, b) => (a.row[sort.name] ?? '').localeCompare(b.row[sort.name] ?? '', undefined, { numeric: true }) * (sort.desc ? -1 : 1));
  const start = Math.max(0, Math.floor(scroll / 39) - 6);
  const visible = filtered.slice(start, start + 40);
  const visibleTables = tableList.filter(t => `${t.schema}.${t.name}`.toLowerCase().includes(search.toLowerCase()));
  const schemas = [...new Set(visibleTables.map(t => t.schema))];
  return <div className="app">
    <aside className="rail">
      <img className="brand-icon" src="/icon.svg" alt="Woojoo" />
      <button className="rail-button selected" title="데이터베이스" onClick={() => setSidebarOpen(v => !v)}><Database size={21}/></button>
      <button className={`rail-button ${showHistory ? 'selected' : ''}`} title="쿼리 기록" onClick={() => setShowHistory(v => !v)}><Clock3 size={21}/></button>
      <div className="rail-bottom"><button className="rail-button" title="연결 추가" onClick={() => setShowConnect(true)}><Settings2 size={21}/></button><button className="rail-button" title="도움말" onClick={() => setShowHelp(true)}><CircleHelp size={21}/></button><div className="avatar">W</div></div>
    </aside>
    {sidebarOpen && <aside className="sidebar">
      <div className="workspace-brand"><span>woojoo<span className="brand-dot">.</span></span><span className="version">BETA</span></div>
      <div className="workspace-label">YOUR WORKSPACE <span>LOCAL</span></div>
      <div className="section-label">CONNECTIONS <button title="연결 추가" aria-label="새 연결" onClick={() => setShowConnect(true)}><Plus size={16}/></button></div>
      <div className="connections">{connections.map(c => <button disabled={busy} key={c.session} className={`connection ${active === c.session ? 'active' : ''}`} onClick={() => { if (askDiscard()) setActive(c.session); }}>
        <span className={`db-icon ${c.profile.engine !== 'postgres' ? 'mysql' : ''}`}><Database size={18}/></span>
        <span className="connection-name">{c.profile.name}<small>{c.profile.engine === 'postgres' ? 'PostgreSQL' : c.profile.engine === 'mariadb' ? 'MariaDB' : 'MySQL'} <span>· {c.session === 'demo' ? 'Demo' : c.profile.host}</span></small></span><span className="live-dot"/>
      </button>)}</div>
      <div className="divider"/>
      <div className="section-label">EXPLORER <button title="목록 새로고침" disabled={busy} onClick={() => void perform(async () => setTableList(await api.tables(active)))}><RefreshCw size={14}/></button></div>
      <label className="search-field"><Search size={14}/><input aria-label="테이블 검색" placeholder="테이블 검색..." value={search} onChange={e => setSearch(e.target.value)}/><kbd>/</kbd></label>
      <div className="tree">
        <div className="tree-db"><ChevronDown size={14}/><Database size={15}/><span>{connection.profile.database}</span><span className="count">{tableList.length}</span></div>
        {schemas.map(schema => <div key={schema}><div className="tree-schema"><ChevronDown size={13}/><Layers3 size={14}/>{schema}</div>
          {visibleTables.filter(t => t.schema === schema).map(t => <button key={`${t.schema}.${t.name}`} disabled={busy} className={`tree-table ${selected?.name === t.name && selected.schema === t.schema ? 'active' : ''}`} onClick={() => void openTable(t)}><Table2 size={14}/><span>{t.name}</span>{selected?.name === t.name && <span className="table-dot"/>}</button>)}
        </div>)}
        {!visibleTables.length && <p className="empty-tree">표시할 테이블이 없습니다.</p>}
      </div>
      <div className="sidebar-footer"><span className="live-dot"/><span>{active === 'demo' ? '샘플 데이터 · 로컬 데모' : '연결됨 · 비밀번호는 메모리에만 저장'}</span></div>
    </aside>}
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={13}/><Database size={14}/><span>{connection.profile.database}</span><ChevronRight size={13}/><strong>{selected?.schema ?? 'SQL'}</strong></div><div className="topbar-right"><span className="mode-tag">{active === 'demo' ? 'DEMO WORKSPACE' : 'LIVE CONNECTION'}</span><button className="subtle-button" onClick={() => setShowConnect(true)}><Plus size={14}/> 연결 추가</button></div></header>
      <section className="heading"><div><div className="eyebrow">DATABASE STUDIO</div><h1>데이터에 더 가까이<span>.</span></h1><p>탐색하고, 쿼리하고, 수정하세요. 흐름을 끊지 않고.</p></div><div className="connection-summary"><span className="live-dot"/>{connection.profile.engine === 'postgres' ? 'PostgreSQL' : connection.profile.engine === 'mysql' ? 'MySQL' : 'MariaDB'}<span className="vertical-line"/><LockKeyhole size={13}/>{active === 'demo' ? 'Sandbox' : connection.profile.tls ? 'TLS verified' : 'TLS disabled'}</div></section>
      <div className="tabs"><button className="tab active"><FileCode2 size={15}/>{source === 'table' ? selected?.name ?? '탐색기' : 'SQL query'}<span className="tab-dot"/></button><button className="tab-add" title="새 쿼리" disabled={busy} onClick={() => {if (askDiscard()) {setEditorSql(''); setSource('query');setDraft({});setResult(blankResult);}}}><Plus size={17}/></button><span className="tabs-spacer"/><span className="shortcut"><kbd>Ctrl</kbd><kbd>↵</kbd> 실행</span></div>
      <section className="editor-pane">
        <div className="editor-toolbar"><div><span className="language-badge">SQL</span><span className="editor-context">{connection.profile.database} <ChevronDown size={12}/></span></div><div><span className="muted editor-hint">선택한 SQL 또는 전체 구문 실행</span><button className="run-button" disabled={busy || !editorSql.trim()} onClick={run}>{busy ? <Loader2 size={14} className="spin"/> : <Zap size={14}/>}실행 <span>⌘ ↵</span></button></div></div>
        <CodeMirror value={editorSql} height="184px" theme={oneDark} editable={!busy} extensions={[sqlLanguage({dialect: connection.profile.engine === 'postgres' ? PostgreSQL : MySQL, schema: Object.fromEntries(tableList.map(t => [t.name, t.name === selected?.name ? result.columns.map(c => c.name) : []]))})]} onChange={setEditorSql} onUpdate={u => { editorSelection.current = u.state.sliceDoc(u.state.selection.main.from, u.state.selection.main.to); }} basicSetup={{lineNumbers: true, foldGutter:false, highlightActiveLine:true, autocompletion:true}}/>
        <div className="editor-footer"><span><span className="status-dot"/> {active === 'demo' ? '데모: SELECT * FROM public.users 지원' : '단일 구문 · 자동 커밋 · 최대 500행 미리보기'}</span><span>UTF-8 <span className="sep">|</span> {connection.profile.engine === 'postgres' ? 'PostgreSQL' : 'MySQL'} dialect</span></div>
      </section>
      <section className="results-pane">
        <div className="result-tabs"><div className="result-tab"><Table2 size={15}/> 결과 <span>{result.rows.length}</span></div><div className="result-meta"><Check size={13}/><span>{result.elapsedMs} ms</span><span className="sep">·</span><span>{source === 'table' ? '테이블 보기' : '쿼리 결과 · 읽기 전용'}</span></div><span className="tabs-spacer"/><button className="icon-button" title="CSV 내보내기" aria-label="CSV 내보내기" disabled={!result.columns.length} onClick={exportCsv}><ArrowDownToLine size={16}/></button><button className="icon-button" title="테이블 새로고침" aria-label="테이블 새로고침" disabled={busy || !selected} onClick={() => selected && void openTable(selected)}><RefreshCw size={15}/></button></div>
        <div className="result-toolbar"><label className="result-filter"><Filter size={14}/><input aria-label="결과 필터" placeholder="불러온 결과에서 검색..." value={filter} onChange={e => {setFilter(e.target.value);setScroll(0);}}/></label><span className="tabs-spacer"/><span className="edit-hint">{canEdit ? '셀을 더블클릭하여 편집' : '읽기 전용 결과'}</span>{edits.length > 0 && <><button className="subtle-button" disabled={busy} onClick={() => setDraft({})}><Undo2 size={14}/> 취소</button><button className="save-button" disabled={busy} onClick={() => setShowReview(true)}><Check size={14}/> 변경 검토 <span>{edits.length}</span></button></>}</div>
        {error && <div role="alert" className="error-banner"><Terminal size={15}/><span>{error}</span><button title="오류 닫기" onClick={() => setError('')}><X size={14}/></button></div>}
        <div className="grid-scroll" onScroll={e => setScroll(e.currentTarget.scrollTop)} key={`${active}-${selected?.name}-${source}`}>
          <table className="data-grid"><thead><tr><th className="row-number">#</th>{result.columns.map(c => <th key={c.name} onClick={() => setSort({name:c.name, desc:sort?.name === c.name && !sort.desc})}><div>{c.primary ? <KeyRound size={12} className="key-icon"/> : <span className="type-icon">{c.dataType.includes('int') ? '#' : 'T'}</span>}<strong>{c.name}</strong>{sort?.name === c.name && <span>{sort.desc ? '↓' : '↑'}</span>}<span className="col-type">{c.dataType}</span></div></th>)}</tr></thead><tbody>
            {start > 0 && <tr className="spacer-row" style={{height:start * 39}}><td colSpan={result.columns.length + 1}/></tr>}
            {visible.map(({row, index}) => <tr key={index}><td className="row-number">{index + 1}</td>{result.columns.map(col => {
              const key = `${index}:${col.name}`, changed = key in draft && draft[key] !== row[col.name], value = key in draft ? draft[key] : row[col.name];
              return <td key={col.name} className={`${changed ? 'changed' : ''} ${col.primary ? 'pk-cell' : ''}`} title={value ?? 'NULL'} onDoubleClick={() => { if (canEdit && col.editable && !busy) setEditing({index,col:col.name,value:value ?? '',isNull:value === null}); }}>
                {value === null ? <span className="null-value">NULL</span> : col.name === 'status' ? <span className={`status-badge ${value}`}><i/>{value}</span> : col.name === 'role' ? <span className={`role-badge ${value.toLowerCase()}`}>{value}</span> : value}
              </td>;
            })}</tr>)}
            {start + visible.length < filtered.length && <tr className="spacer-row" style={{height:(filtered.length - start - visible.length) * 39}}><td colSpan={result.columns.length + 1}/></tr>}
          </tbody></table>
          {!result.rows.length && <div className="empty-result"><Database size={32}/><h3>{busy ? '데이터를 불러오는 중...' : '다음 발견을 기다리고 있어요'}</h3><p>{result.affected ? `${result.affected}개 행에 영향을 주었습니다.` : '테이블을 선택하거나 SQL을 실행해 보세요.'}</p></div>}
          {result.rows.length > 0 && !filtered.length && <div className="empty-result"><Search size={26}/><p>일치하는 결과가 없습니다.</p></div>}
        </div>
        <div className="result-footer"><span><span className="live-dot"/> {filtered.length} rows <span className="sep">·</span> {result.columns.length} columns {result.truncated && <strong className="limit-note">· 500행에서 제한됨</strong>}</span><span>{edits.length ? `${edits.length}개 행 변경 대기` : 'All changes saved'}<span className="sep">|</span><span>미리보기 한도 500</span></span></div>
      </section>
      <footer className="app-footer"><span><Zap size={12}/> Built for your flow.</span><span>{api.desktop ? 'Tauri · Rust native' : 'Browser preview'}<span className="sep">·</span> Woojoo v0.1.0</span></footer>
    </main>
    {notice && <div role="status" className="toast"><Check size={16}/>{notice}</div>}
    {showConnect && <ConnectionDialog onClose={() => setShowConnect(false)} onConnected={(profile, session) => {setConnections(c => [...c, {profile:{...profile,password:''},session}]);if (askDiscard()) setActive(session);setShowConnect(false);}}/>}
    {editing && <div className="modal-backdrop"><div className="modal cell-modal"><div className="modal-heading"><h2>셀 편집</h2><button onClick={() => setEditing(null)} aria-label="닫기"><X size={20}/></button></div><p className="modal-description">{selected?.name} / <strong>{editing.col}</strong> · 행 {editing.index + 1}</p><textarea aria-label="셀 값" autoFocus value={editing.value} disabled={editing.isNull} onChange={e => setEditing({...editing,value:e.target.value})}/><label className="checkbox-label"><input type="checkbox" checked={editing.isNull} onChange={e => setEditing({...editing,isNull:e.target.checked})}/> NULL로 설정</label><div className="modal-actions"><button className="secondary-button" onClick={() => setEditing(null)}>취소</button><button className="primary-button" onClick={() => {setDraft(d => ({...d,[`${editing.index}:${editing.col}`]:editing.isNull ? null : editing.value}));setEditing(null);}}>변경 대기열에 추가</button></div></div></div>}
    {showReview && <div className="modal-backdrop"><div className="modal review-modal"><div className="modal-heading"><h2>변경 사항 검토</h2><button disabled={busy} onClick={() => setShowReview(false)} aria-label="닫기"><X size={20}/></button></div><p className="modal-description"><strong>{selected?.schema}.{selected?.name}</strong>의 {edits.length}개 행을 수정합니다. {active === 'demo' ? '데모 데이터에만 반영됩니다.' : '모든 변경을 하나의 트랜잭션으로 적용합니다.'}</p><div className="review-list">{edits.map((edit,i) => <div className="review-row" key={i}><small>{result.columns.filter(c => c.primary).map(c => `${c.name} = ${edit.original[c.name]}`).join(', ')}</small>{Object.entries(edit.changes).map(([col,val]) => <div key={col}><strong>{col}</strong><del>{edit.original[col] ?? 'NULL'}</del><ArrowRight size={14}/><ins>{val ?? 'NULL'}</ins></div>)}</div>)}</div>{error && <p className="dialog-error">{error}</p>}<div className="modal-actions"><button disabled={busy} className="secondary-button" onClick={() => setShowReview(false)}>돌아가기</button><button disabled={busy} className="primary-button" onClick={() => void applyChanges()}>{busy ? '적용 중...' : `${edits.length}개 행 적용`}</button></div></div></div>}
    {showHistory && <aside className="history-panel"><div className="modal-heading"><h2>쿼리 기록</h2><button onClick={() => setShowHistory(false)} aria-label="닫기"><X size={18}/></button></div><p>현재 앱 세션의 실행 기록</p>{!history.length && <div className="history-empty"><Clock3 size={28}/><p>실행한 쿼리가 여기에 표시됩니다.</p></div>}{history.map((h,i) => <button key={i} className="history-item" onClick={() => {setEditorSql(h.sql);setShowHistory(false);}}><small>{h.time}</small><code>{h.sql}</code></button>)}</aside>}
    {showHelp && <div className="modal-backdrop"><div className="modal"><div className="modal-heading"><h2>작고 빠른 데이터 작업실</h2><button onClick={() => setShowHelp(false)} aria-label="닫기"><X size={20}/></button></div><div className="help-content"><p><kbd>Ctrl + Enter</kbd> 선택한 구문 또는 편집기의 SQL 실행</p><p><strong>결과 편집</strong> 테이블 보기에서 셀 더블클릭 → 변경 검토 → 적용. 기본키와 생성 열은 수정할 수 없습니다.</p><p><strong>데모 모드</strong> 샘플 데이터는 메모리에만 존재하며 앱을 다시 열면 초기화됩니다.</p><p><strong>실제 연결</strong> 데스크톱 앱에서 PostgreSQL·MySQL·MariaDB에 연결하세요. 연결 정보는 이번 세션에만 유지됩니다.</p><p><strong>첫 버전 범위</strong> 단일 SQL, 자동 커밋, 최대 500행. SSH 터널·수동 트랜잭션·쿼리 취소·연결 저장은 후속 기능입니다.</p></div><button className="primary-button full" onClick={() => setShowHelp(false)}>시작해 볼까요</button></div></div>}
  </div>;
}

function ConnectionDialog({onClose,onConnected}:{onClose:()=>void;onConnected:(p:Profile,id:string)=>void}) {
  const [profile,setProfile] = useState<Profile>({id:crypto.randomUUID(),name:'Local PostgreSQL',engine:'postgres',host:'localhost',port:5432,database:'postgres',username:'postgres',password:'',tls:true});
  const [loading,setLoading] = useState(false);
  const [message,setMessage] = useState('');
  const field = (key: keyof Profile, value: string | number | boolean) => setProfile(p => ({...p,[key]:value}));
  async function submit(test: boolean) {
    if (!profile.name.trim() || !profile.host.trim() || !profile.database.trim() || !profile.username.trim() || !Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {setMessage('연결 이름, 호스트, DB, 사용자와 유효한 포트를 입력하세요.');return;}
    setLoading(true);setMessage('');
    try { const id = await api.connect(profile);if(test){await api.disconnect(id);setMessage('연결에 성공했습니다.');}else onConnected(profile,id); } catch(e){setMessage(String(e));}finally{setLoading(false);}
  }
  return <div className="modal-backdrop"><form className="modal connection-modal" onSubmit={e => {e.preventDefault();void submit(false);}}><div className="modal-heading"><div className="modal-symbol"><Database size={22}/></div><button type="button" disabled={loading} onClick={onClose} aria-label="닫기"><X size={20}/></button></div><h2>새로운 연결</h2><p className="modal-description">당신의 데이터가 있는 곳으로.</p><div className="engine-options">{(['postgres','mysql','mariadb'] as Engine[]).map(engine => <button key={engine} type="button" className={profile.engine === engine ? 'active' : ''} onClick={() => setProfile(p => ({...p,engine,port:engine === 'postgres'?5432:3306,username:engine === 'postgres'?'postgres':'root',database:engine==='postgres'?'postgres':'mysql',name:engine==='postgres'?'Local PostgreSQL':engine==='mysql'?'Local MySQL':'Local MariaDB'}))}><Database size={20}/>{engine === 'postgres' ? 'PostgreSQL' : engine === 'mysql' ? 'MySQL' : 'MariaDB'}</button>)}</div><label>연결 이름<input aria-label="연결 이름" value={profile.name} onChange={e=>field('name',e.target.value)}/></label><div className="form-row"><label>호스트<input aria-label="호스트" value={profile.host} onChange={e=>field('host',e.target.value)}/></label><label className="port">포트<input aria-label="포트" type="number" value={profile.port} onChange={e=>field('port',Number(e.target.value))}/></label></div><label>데이터베이스<input aria-label="데이터베이스" value={profile.database} onChange={e=>field('database',e.target.value)}/></label><div className="form-row"><label>사용자<input aria-label="사용자" value={profile.username} onChange={e=>field('username',e.target.value)}/></label><label>비밀번호<input aria-label="비밀번호" type="password" autoComplete="off" value={profile.password} onChange={e=>field('password',e.target.value)}/></label></div><label className="checkbox-label"><input type="checkbox" checked={profile.tls} onChange={e=>field('tls',e.target.checked)}/> TLS 사용 · 서버 인증서 검증</label><p className="credential-note"><LockKeyhole size={13}/> 비밀번호는 디스크에 저장하지 않습니다.</p>{message && <p role="status" className="dialog-message">{message}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={loading} onClick={()=>void submit(true)}>연결 테스트</button><button type="submit" className="primary-button" disabled={loading}>{loading?<Loader2 size={15} className="spin"/>:<Zap size={15}/>} 연결하기</button></div></form></div>;
}
