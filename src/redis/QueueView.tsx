import { SortableTable } from '../components/SortableTable';
import { useLanguage } from '../i18n';
import type { QueueInfo, SavedView } from './model';
export function QueueView({ view, info, group, onGroup, busy }: { view: SavedView | undefined; info: QueueInfo | null; group: string; onGroup: (group: string) => void; busy: boolean }) {
  const { language } = useLanguage(); const ko = language === 'ko';
  if (!view) return <p className="redis-empty-inline">{ko ? '등록한 큐를 선택하거나 List·Stream 키를 큐로 등록하세요.' : 'Select a saved queue or register a List or Stream key.'}</p>;
  return <section className="redis-queue-info" data-testid="redis-queue-info" aria-busy={busy}>
    <h3>{view.name}</h3>
    {view.kind === 'list' ? <p>{ko ? 'List 관측 · 처리 방향: ' : 'List observation · Processing direction: '}{view.direction === 'left' ? (ko ? '왼쪽' : 'Left') : view.direction === 'right' ? (ko ? '오른쪽' : 'Right') : (ko ? '알 수 없음' : 'Unknown')}. {ko ? '처리 중·성공·실패 상태는 알 수 없습니다.' : 'In-progress, success and failure states are unknown.'}</p> : <>
      <p className="redis-muted">{ko ? 'Pending: ACK 대기 메시지 (실패 건수 아님)' : 'Pending: awaiting ACK, not failures.'}</p>
      <SortableTable><thead><tr><th>{ko ? '소비자 그룹' : 'Consumer group'}</th><th>Pending</th><th>{ko ? '소비자' : 'Consumers'}</th><th>Lag</th></tr></thead><tbody>{info?.groups.map(g => <tr key={g.name} className={g.name === group ? 'selected' : ''}><td><button onClick={() => onGroup(g.name)}>{g.name}</button></td><td>{g.pending}</td><td>{g.consumers}</td><td>{g.lag ?? '—'}</td></tr>)}</tbody></SortableTable>
      {info && !info.groups.length && <p>{ko ? '소비자 그룹이 없거나 조회할 수 없습니다.' : 'No consumer groups, or unavailable.'}</p>}
      {!!info?.consumers.length && <SortableTable><thead><tr><th>{ko ? '소비자' : 'Consumer'}</th><th>Pending</th><th>Idle (ms)</th></tr></thead><tbody>{info.consumers.map(c => <tr key={c.name}><td>{c.name}</td><td>{c.pending}</td><td>{c.idle}</td></tr>)}</tbody></SortableTable>}
      {!!info?.pending.length && <><p className="redis-muted">{ko ? 'Pending 미리보기 · 최대 100개' : 'Pending preview · up to 100 entries'}</p><SortableTable><thead><tr><th>ID</th><th>{ko ? '소비자' : 'Consumer'}</th><th>Idle (ms)</th><th>{ko ? '전달 횟수' : 'Deliveries'}</th></tr></thead><tbody>{info.pending.map(p => <tr key={p.id}><td>{p.id}</td><td>{p.consumer}</td><td>{p.idle}</td><td>{p.deliveries}</td></tr>)}</tbody></SortableTable></>}
      {info?.errors.map((e, i) => <p className="redis-warning" key={i}>{e}</p>)}
    </>}
  </section>;
}
