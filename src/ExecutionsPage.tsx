import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, FileCode2, RefreshCw } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { useLanguage } from './i18n';

export type ExecutionEntry = {
  id:string; sql:string; profileId:string; connectionName:string; engine:string; database:string;
  kind:string; status:string; startedAt:number; durationMs:number|null; error:string|null;
};
type Connection = Pick<ExecutionEntry,'profileId'|'connectionName'|'engine'|'database'>;
type Result = { entries:ExecutionEntry[]; total:number };
export function ExecutionsPage({onClose,onOpen,profileIds}:{onClose:()=>void;onOpen:(entry:ExecutionEntry)=>void;profileIds:string[]}) {
  const {language}=useLanguage();
  const tr=(ko:string,en:string)=>language==='ko'?ko:en;
  const [search,setSearch]=useState(''),[profile,setProfile]=useState(''),[status,setStatus]=useState('');
  const [since,setSince]=useState(''),[until,setUntil]=useState('');
  const [offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
  const [result,setResult]=useState<Result>({entries:[],total:0});
  const [connections,setConnections]=useState<Connection[]>([]);
  const [selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<ExecutionEntry|null>(null);
  const [error,setError]=useState(''),[detailError,setDetailError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
  const native=isTauri();
  const labels:Record<string,string>={running:tr('실행 중','Running'),success:tr('성공','Success'),failed:tr('실패','Failed'),cancelled:tr('취소됨','Cancelled'),interrupted:tr('중단됨','Interrupted')};
  const kinds:Record<string,string>={sql:'SQL',object:tr('객체 SQL','Object SQL'),transaction:tr('트랜잭션','Transaction'),structure:tr('구조 변경','Structure')};
  useEffect(()=>{
    if(!native)return;
    const subscription=listen('executions-changed',()=>setRevision(v=>v+1)).catch(()=>()=>{});
    return()=>{void subscription.then(unlisten=>unlisten()).catch(()=>{});};
  },[native]);
  useEffect(()=>{
    if(!native)return;
    let live=true;
    const timer=setTimeout(()=>{
      const from=since?new Date(`${since}T00:00:00`).getTime():null;
      const end=until?new Date(`${until}T00:00:00`):null;
      if(end)end.setDate(end.getDate()+1);
      if(from!==null&&end&&from>=end.getTime()){setError(tr('날짜 범위를 확인하세요.','Check the date range.'));setBusy(false);return;}
      setBusy(true);setError('');
      void Promise.all([
        invoke<Result>('execution_list',{filter:{search,profileId:profile,status,since:from,until:end?.getTime()??null,offset}}),
        invoke<Connection[]>('execution_connections'),
      ]).then(([page,list])=>{if(live){setResult(page);setConnections(list);}}).catch(e=>{if(live)setError(String(e));}).finally(()=>{if(live)setBusy(false);});
    },200);
    return()=>{live=false;clearTimeout(timer);};
  },[native,search,profile,status,since,until,offset,revision]);
  useEffect(()=>{
    setDetail(null);setDetailError('');setCopied(false);
    if(!selected)return;
    let live=true;
    void invoke<ExecutionEntry>('execution_detail',{id:selected}).then(value=>{if(live)setDetail(value);}).catch(e=>{if(live)setDetailError(String(e));});
    return()=>{live=false;};
  },[selected,revision]);
  function filter(action:()=>void){setBusy(true);action();setOffset(0);setSelected(null);}
  async function copy(){if(!detail)return;try{await navigator.clipboard.writeText(detail.sql);setCopied(true);}catch{setDetailError(tr('복사하지 못했습니다.','Could not copy SQL.'));}}
  const date=(value:number)=>new Date(value).toLocaleString(language==='ko'?'ko-KR':'en-US');
  return <section className="executions-page" aria-label={tr('실행한 쿼리','Executed queries')}>
    <header className="executions-heading"><div><Button variant="ghost" size="icon-sm" aria-label={tr('작업 공간으로 돌아가기','Back to workspace')} onClick={onClose}><ArrowLeft/></Button><h1>{tr('실행한 쿼리','Executed queries')}</h1></div><Button variant="outline" size="sm" disabled={!native||busy} onClick={()=>setRevision(v=>v+1)}><RefreshCw/>{tr('새로고침','Refresh')}</Button></header>
    {!native?<div className="workspace-empty">{tr('실행 내역은 데스크톱 앱에서 확인할 수 있습니다.','Execution records are available in the desktop app.')}</div>:<>
      <div className="executions-filters">
        <Input aria-label={tr('SQL·오류 검색','Search SQL or errors')} placeholder={tr('SQL·오류 검색','Search SQL or errors')} value={search} onChange={e=>filter(()=>setSearch(e.target.value))}/>
        <NativeSelect aria-label={tr('연결 필터','Connection filter')} value={profile} onChange={e=>filter(()=>setProfile(e.target.value))}><option value="">{tr('모든 연결','All connections')}</option>{connections.map(c=><option key={c.profileId} value={c.profileId}>{c.connectionName||c.database}</option>)}</NativeSelect>
        <NativeSelect aria-label={tr('실행 상태','Execution status')} value={status} onChange={e=>filter(()=>setStatus(e.target.value))}><option value="">{tr('모든 상태','All statuses')}</option>{Object.entries(labels).map(([key,label])=><option value={key} key={key}>{label}</option>)}</NativeSelect>
        <Input type="date" aria-label={tr('시작일','Start date')} value={since} onChange={e=>filter(()=>setSince(e.target.value))}/>
        <span>–</span><Input type="date" aria-label={tr('종료일','End date')} value={until} onChange={e=>filter(()=>setUntil(e.target.value))}/>
      </div>
      {error&&<p className="error-banner" role="alert">{error}</p>}
      <div className={`executions-body ${selected?'with-detail':''}`}>
        <div className="executions-list" aria-busy={busy}>
          <div className="executions-scroll"><table><thead><tr><th>{tr('실행 시각','Executed at')}</th><th>{tr('연결','Connection')}</th><th>{tr('상태','Status')}</th><th>{tr('소요 시간','Duration')}</th><th>SQL</th></tr></thead><tbody>
            {result.entries.map(entry=><tr key={entry.id} className={entry.id===selected?'selected':''}><td>{date(entry.startedAt)}</td><td title={entry.connectionName}>{entry.connectionName||entry.database}</td><td><span className="execution-status" data-status={entry.status}>{labels[entry.status]??entry.status}</span></td><td>{entry.durationMs===null?'—':`${entry.durationMs.toLocaleString()} ms`}</td><td><Button variant="outline" size="sm" disabled={busy} onClick={()=>setSelected(entry.id)} title={entry.sql}><span>{entry.sql}</span></Button></td></tr>)}
          </tbody></table>{!busy&&!error&&!result.entries.length&&<div className="executions-empty">{tr('실행 내역이 없습니다.','No executions found.')}</div>}</div>
          <footer><span>{result.total.toLocaleString()} {tr('건','executions')}</span><div><Button variant="ghost" size="icon-sm" aria-label={tr('이전 페이지','Previous page')} disabled={busy||offset===0} onClick={()=>{setOffset(v=>Math.max(0,v-50));setSelected(null);}}><ChevronLeft/></Button><span>{Math.floor(offset/50)+1} / {Math.max(1,Math.ceil(result.total/50))}</span><Button variant="ghost" size="icon-sm" aria-label={tr('다음 페이지','Next page')} disabled={busy||offset+50>=result.total} onClick={()=>{setOffset(v=>v+50);setSelected(null);}}><ChevronRight/></Button></div></footer>
        </div>
        {selected&&<aside className="execution-detail" aria-label={tr('실행 상세','Execution details')}>
          {detailError&&<p role="alert" className="error-banner">{detailError}</p>}
          {detail?<><div className="execution-detail-actions"><Button variant="outline" size="sm" onClick={()=>void copy()}><Copy/>{copied?tr('복사됨','Copied'):tr('SQL 복사','Copy SQL')}</Button><Button size="sm" disabled={!profileIds.includes(detail.profileId)} title={!profileIds.includes(detail.profileId)?tr('연결 프로필이 삭제되었습니다.','Connection profile no longer exists.'):undefined} onClick={()=>onOpen(detail)}><FileCode2/>{tr('편집기에서 열기','Open in editor')}</Button></div>
            <dl><dt>{tr('연결','Connection')}</dt><dd>{detail.connectionName}</dd><dt>{tr('데이터베이스','Database')}</dt><dd>{detail.database} · {detail.engine}</dd><dt>{tr('실행 시각','Executed at')}</dt><dd>{date(detail.startedAt)}</dd><dt>{tr('실행 유형','Execution type')}</dt><dd>{kinds[detail.kind]??detail.kind}</dd><dt>{tr('상태','Status')}</dt><dd>{labels[detail.status]??detail.status}</dd><dt>{tr('소요 시간','Duration')}</dt><dd>{detail.durationMs===null?'—':`${detail.durationMs} ms`}</dd></dl>
            {detail.status==='interrupted'&&<p>{tr('앱 종료로 완료 여부를 확인하지 못했습니다.','Completion could not be confirmed before the app exited.')}</p>}
            {detail.error&&<pre className="execution-error">{detail.error}</pre>}
            <pre className="execution-sql">{detail.sql}</pre>
          </>:!detailError&&<p>{tr('불러오는 중…','Loading…')}</p>}
        </aside>}
      </div>
    </>}
  </section>;
}
