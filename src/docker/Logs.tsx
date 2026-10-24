import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { appendLogs, text } from './model';
import { errorMessage, startLogs, stopLogs } from './api';
export function DockerLogs({ context, id, name, language, demo }: { context: string; id: string; name: string; language: string; demo: boolean }) {
  const [buffer, setBuffer] = useState({ lines: [] as string[], truncated: false });
  const [filter, setFilter] = useState(''), [follow, setFollow] = useState(true), [error, setError] = useState(''), [done, setDone] = useState(false), [revision, setRevision] = useState(0);
  const scroll = useRef<HTMLPreElement>(null); const tr = (ko: string, en: string) => text(language, ko, en);
  useEffect(() => {
    setBuffer({ lines: [], truncated: false }); setError(''); setDone(false);
    if (demo) { setBuffer({ lines: ['[DEMO] Starting application…', '[DEMO] Ready to accept connections.'], truncated: false }); setDone(true); return; }
    const subscription = crypto.randomUUID(); let closed = false; let started = false;
    void startLogs(context, id, subscription, event => {
      if (closed || event.subscription !== subscription) return;
      setBuffer(old => { const next = appendLogs(old.lines, event.lines); return { lines: next.lines, truncated: old.truncated || next.truncated || event.truncated }; });
      if (event.error) setError(event.error); setDone(event.done);
    }).then(() => { started = true; if (closed) void stopLogs(subscription).catch(() => {}); }).catch(e => { if (!closed) { setError(String(e)); setDone(true); } });
    return () => { closed = true; if (started) void stopLogs(subscription).catch(() => {}); };
  }, [context, id, demo, revision]);
  useEffect(() => { if (follow && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [buffer, follow]);
  const visible = buffer.lines.filter(line => line.toLowerCase().includes(filter.toLowerCase()));
  return <section className="docker-logs" aria-label={tr('컨테이너 로그', 'Container logs')}>
    <header><strong>{name}</strong><span>{done ? tr('스트림 종료', 'Stream ended') : tr('실시간 로그', 'Live logs')}</span><Input aria-label={tr('로그 검색', 'Search logs')} placeholder={tr('로그 검색', 'Search logs')} value={filter} onChange={e => setFilter(e.target.value)}/><Button variant="outline" size="sm" aria-pressed={follow} onClick={() => setFollow(v => !v)}>{follow ? tr('스크롤 일시정지', 'Pause scrolling') : tr('자동 스크롤', 'Follow')}</Button><Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(visible.join('\n')).catch(e => setError(String(e)))}>{tr('복사', 'Copy')}</Button>{done && !demo && <Button variant="outline" size="sm" onClick={() => setRevision(v => v + 1)}>{tr('다시 연결', 'Reconnect')}</Button>}</header>
    {buffer.truncated && <small className="docker-warning">{tr('로그 일부가 생략되었습니다. 최대 5,000줄 / 2MiB를 유지합니다.', 'Some logs were dropped. Retaining up to 5,000 lines / 2MiB.')}</small>}
    {error && <p role="alert" className="docker-warning">{errorMessage(error, language)}</p>}
    <pre ref={scroll} tabIndex={0}>{visible.join('\n') || tr('로그를 기다리는 중…', 'Waiting for logs…')}</pre>
  </section>;
}
