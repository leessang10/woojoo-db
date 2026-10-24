import { SortableTable } from '../components/SortableTable';
import { useMemo, useState, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { useLanguage } from '../i18n';
import { prefixTree, ttlText, type KeyMeta, type PrefixNode } from './model';

function Branch({ node, onOpen, selected }: { node: PrefixNode; onOpen: (key: KeyMeta) => void; selected: string }) {
  const [count, setCount] = useState(100);
  if (!node.children.length) return <div className="redis-tree-leaf">{node.keys.map(key => <button key={key.key.base64} title={key.key.text} className={selected === key.key.base64 ? 'selected' : ''} onClick={() => onOpen(key)}>{node.label || '∅'}<small>{key.type}</small></button>)}</div>;
  return <details className="redis-tree-branch"><summary><span>{node.label || '∅'}</span><small>{node.count}</small></summary>
    {node.keys.map(key => <button key={key.key.base64} className={selected === key.key.base64 ? 'selected' : ''} onClick={() => onOpen(key)}>{key.key.text || '∅'}<small>{key.type}</small></button>)}
    {node.children.slice(0, count).map(child => <Branch key={child.id} node={child} onOpen={onOpen} selected={selected}/>)}
    {node.children.length > count && <button onClick={() => setCount(n => n + 100)}>+100</button>}
  </details>;
}
export function KeyTree({ keys, separator, onOpen, selected }: { keys: KeyMeta[]; separator: string; onOpen: (key: KeyMeta) => void; selected: string }) {
  const tree = useMemo(() => prefixTree(keys, separator), [keys, separator]); const [count, setCount] = useState(100);
  return <div className="redis-key-tree">{tree.slice(0, count).map(node => <Branch key={node.id} node={node} selected={selected} onOpen={onOpen}/>)}{tree.length > count && <button onClick={() => setCount(n => n + 100)}>+100</button>}</div>;
}
export function KeyExplorer({ keys, selected, onOpen, complete, busy }: { keys: KeyMeta[]; selected: string; onOpen: (key: KeyMeta) => void; complete: boolean; busy: boolean }) {
  const { language } = useLanguage(); const ko = language === 'ko'; const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [keys]);
  const shown = keys.slice(page * 200, (page + 1) * 200);
  return <div className="redis-key-list" data-testid="redis-key-list" aria-busy={busy}>
    {keys.length > 200 && <p className="redis-muted redis-sort-note">{ko ? '정렬: 현재 페이지' : 'Sort: current page'}</p>}
    <SortableTable aria-label={ko ? '키 목록' : 'Key list'}><thead><tr><th>{ko ? '키' : 'Key'}</th><th>{ko ? '자료형' : 'Type'}</th><th>TTL</th><th>{ko ? '길이 / 항목 수' : 'Length / count'}</th></tr></thead>
      <tbody>{shown.map(item => <tr key={item.key.base64} className={selected === item.key.base64 ? 'selected' : ''}><td data-sort-value={item.key.text}><button onClick={() => onOpen(item)} title={item.key.utf8 ? item.key.text : `base64: ${item.key.base64}`}>{item.key.text || '(empty key)'}{!item.key.utf8 && <small> binary</small>}</button>{item.error && <small className="redis-error">{item.error}</small>}</td><td><span className={`redis-type redis-type-${item.type}`}>{item.type}</span></td><td data-sort-value={item.ttlMs ?? undefined}>{ttlText(item.ttlMs, ko)}</td><td>{item.length ?? '—'}</td></tr>)}</tbody>
    </SortableTable>
    {!keys.length && <p className="redis-empty-inline">{busy ? (ko ? '키를 탐색하고 있습니다…' : 'Scanning keys…') : complete ? (ko ? '표시할 키가 없습니다.' : 'No matching keys.') : (ko ? '아직 키를 발견하지 못했습니다. 더 불러오기를 계속하세요.' : 'No keys discovered yet. Continue loading.')}</p>}
    {keys.length > 200 && <footer className="redis-pagination"><Button variant="ghost" disabled={!page} onClick={() => setPage(p => p - 1)}>{ko ? '이전' : 'Previous'}</Button><span>{page * 200 + 1}–{Math.min(keys.length, (page + 1) * 200)} / {keys.length}</span><Button variant="ghost" disabled={(page + 1) * 200 >= keys.length} onClick={() => setPage(p => p + 1)}>{ko ? '다음' : 'Next'}</Button></footer>}
  </div>;
}
