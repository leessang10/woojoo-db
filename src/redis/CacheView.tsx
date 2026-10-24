import { useLanguage } from '../i18n';
import { TTL_BUCKETS, ttlBucket, type KeyMeta, type TtlBucket } from './model';
export function CacheView({ keys, bucket, onBucket, observedAt, complete }: { keys: KeyMeta[]; bucket: TtlBucket | ''; onBucket: (b: TtlBucket | '') => void; observedAt: number; complete: boolean }) {
  const { language } = useLanguage(); const ko = language === 'ko';
  const labels: Record<TtlBucket, string> = { minute: ko ? '1분 이내' : 'Within 1 min', five: ko ? '1–5분' : '1–5 min', hour: ko ? '5–60분' : '5–60 min', later: ko ? '1시간 이상' : 'Over 1 hour', persistent: ko ? '만료 없음' : 'No expiry', missing: ko ? '사라짐' : 'Missing', unknown: ko ? '확인 불가' : 'Unavailable' };
  const counts = Object.fromEntries(TTL_BUCKETS.map(b => [b, 0])) as Record<TtlBucket, number>; keys.forEach(k => counts[ttlBucket(k.ttlMs)]++);
  const max = Math.max(1, ...Object.values(counts));
  return <section className="redis-cache"><div className="redis-cache-caption"><strong>{ko ? '만료 현황' : 'Expiration'}</strong><span>{ko ? `탐색한 ${keys.length.toLocaleString()}개 기준` : `Based on ${keys.length.toLocaleString()} discovered keys`} · {complete ? (ko ? '탐색 완료' : 'Scan complete') : (ko ? '일부 탐색' : 'Partial scan')} · {observedAt ? new Date(observedAt).toLocaleTimeString() : '—'}</span></div>
    <div className="redis-ttl-bars">{TTL_BUCKETS.map(b => <button key={b} aria-pressed={bucket === b} onClick={() => onBucket(bucket === b ? '' : b)}><span>{labels[b]}</span><i style={{ width: `${counts[b] / max * 100}%` }}/><strong>{counts[b]}</strong></button>)}</div>
    <p className="redis-muted">{ko ? '전체 데이터의 추정치가 아닌 관측값입니다. TTL은 마지막 조회 시점 기준입니다.' : 'Observed values, not estimates of the entire dataset. TTL is measured at the last refresh.'}</p>
  </section>;
}
