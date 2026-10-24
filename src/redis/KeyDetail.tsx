import { RefreshCw, X } from 'lucide-react';
import { SortableTable } from '../components/SortableTable';
import { useState } from 'react';
import { Button } from '../components/ui/button';
import { useLanguage } from '../i18n';
import { hex, jsonPreview, ttlText, type RedisBytes, type RedisValue } from './model';

function JsonNode({ value, label, depth = 0 }: { value: unknown; label: string; depth?: number }) {
  const { language } = useLanguage();
  const [count, setCount] = useState(100);
  if (!value || typeof value !== 'object' || depth >= 16) return <div className="redis-json-leaf"><span>{label}</span>: <code>{JSON.stringify(value)}</code></div>;
  const items = Object.entries(value); return <details className="redis-json-node" open={depth < 2}><summary>{label} <small>{Array.isArray(value) ? `[${items.length}]` : `{${items.length}}`}</small></summary>{items.slice(0, count).map(([key, v]) => <JsonNode key={key} label={key} value={v} depth={depth + 1}/>)}{items.length > count && <Button variant="ghost" size="sm" onClick={() => setCount(n => n + 100)}>{language === 'ko' ? `더 보기 (${items.length - count}개 남음)` : `Load more (${items.length - count} remaining)`}</Button>}</details>;
}
function Cell({ value }: { value: RedisBytes }) { return <pre title={value.utf8 ? undefined : `base64: ${value.base64}`}>{value.utf8 ? value.text : hex(value)}</pre>; }
export function KeyDetail({ value, busy, error, onPage, onRefresh, onClose, onFavorite, onQueue }: { value: RedisValue | null; busy: boolean; error: string; onPage: (cursor?: string) => void; onRefresh: () => void; onClose: () => void; onFavorite: () => void; onQueue: () => void }) {
  const { language } = useLanguage(); const ko = language === 'ko'; const [format, setFormat] = useState<'json' | 'text' | 'hex'>('json');
  let json: unknown; let validJson = false;
  if (value?.text?.utf8 && !value.truncated && !value.nextCursor) { const parsed = jsonPreview(value.text.text); json = parsed.value; validJson = parsed.valid; }
  const displayFormat = !value?.text?.utf8 ? 'hex' : format === 'json' && !validJson ? 'text' : format;
  return <section className="redis-detail" data-testid="redis-detail" aria-busy={busy}>
    <header><h3>{value?.key.text || (ko ? '키 상세' : 'Key detail')}</h3><Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={ko ? '상세 닫기' : 'Close detail'}><X size={15}/></Button></header>
    {error && <p role="alert" className="redis-error">{error}</p>}
    {!value && <p className="redis-empty-inline">{busy ? (ko ? '불러오는 중…' : 'Loading…') : (ko ? '키를 선택하면 값을 확인할 수 있습니다.' : 'Select a key to inspect its value.')}</p>}
    {value && <><div className="redis-detail-meta"><span className={`redis-type redis-type-${value.type}`}>{value.type}</span><span>TTL {ttlText(value.ttlMs, ko)}</span><span>{ko ? '길이' : 'Length'} {value.length ?? '—'}</span><span>{new Date(value.observedAt).toLocaleTimeString(ko ? 'ko-KR' : 'en-US')}</span></div>
      <div className="redis-detail-actions"><Button variant="ghost" size="icon-sm" disabled={busy} onClick={onRefresh} aria-label={ko ? '새로고침' : 'Refresh'} title={ko ? '새로고침' : 'Refresh'}><RefreshCw size={14}/></Button><Button variant="ghost" onClick={onFavorite}>{ko ? '즐겨찾기' : 'Favorite'}</Button>{['list', 'stream'].includes(value.type) && <Button size="sm" onClick={onQueue}>{ko ? '큐로 등록' : 'Register queue'}</Button>}</div>
      {!value.key.utf8 && <p className="redis-muted">Key base64: {value.key.base64}</p>}
      {value.truncated && <p role="status" className="redis-warning">{ko ? '일부 값만 표시합니다. JSON 보기는 사용할 수 없습니다.' : 'Partial preview. This is not parsed as a complete JSON document.'}</p>}
      {value.text && <><div className="redis-segments">{(['json', 'text', 'hex'] as const).map(f => <button key={f} disabled={f === 'json' && !validJson} aria-pressed={displayFormat === f} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>)}</div><div className="redis-value-body">{displayFormat === 'json' && validJson ? <JsonNode key={value.key.base64} label="$" value={json}/> : displayFormat === 'hex' ? <pre>{hex(value.text)}</pre> : <pre>{value.text.text}</pre>}</div></>}
      {!value.text && value.rows.length > 0 && <div className="redis-value-body">{value.nextCursor !== null && <p className="redis-muted">{ko ? '정렬: 현재 항목' : 'Sort: loaded entries'}</p>}<SortableTable className="redis-value-table"><thead><tr><th>{value.type === 'stream' ? 'ID' : '#'}</th>{value.type === 'hash' ? <><th>{ko ? '필드' : 'Field'}</th><th>{ko ? '값' : 'Value'}</th></> : value.type === 'zset' ? <><th>{ko ? '멤버' : 'Member'}</th><th>{ko ? '점수' : 'Score'}</th></> : <th>{ko ? '값' : 'Value'}</th>}</tr></thead><tbody>{value.rows.map(row => <tr key={row.id}><td>{row.id}</td>{value.type === 'stream' ? <td data-sort-value={row.cells.map(cell => cell.utf8 ? cell.text : cell.base64).join(' ')}>{row.cells.map((cell, i) => <span key={i} className={i % 2 === 0 ? 'redis-stream-field' : 'redis-stream-value'}><Cell value={cell}/></span>)}</td> : row.cells.map((cell, i) => <td key={i} data-sort-value={cell.utf8 ? cell.text : cell.base64}><Cell value={cell}/></td>)}</tr>)}</tbody></SortableTable></div>}
      {!value.text && !value.rows.length && <p className="redis-muted">{ko ? '표시할 항목이 없거나 지원하지 않는 자료형입니다.' : 'No entries on this page, or unsupported data type.'}</p>}
      {!value.text && <div className="redis-pagination"><Button variant="ghost" disabled={busy} onClick={() => onPage()}>{ko ? '처음부터' : 'Start'}</Button><Button variant="outline" disabled={busy || value.nextCursor === null} onClick={() => onPage(value.nextCursor ?? undefined)}>{ko ? '다음 항목' : 'Next entries'}</Button></div>}
      {value.type === 'list' && <p className="redis-muted">{ko ? '목록이 변경되면 인덱스가 달라질 수 있습니다.' : 'Not a snapshot. Indices can shift as the list changes.'}</p>}
    </>}
  </section>;
}
