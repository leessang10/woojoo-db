import { useEffect, useRef, useState } from 'react';
import type { RedisApi } from '../api';
import { bytes, errorText, type KeyMeta, type RedisValue } from '../model';
import { appendEvents, diffValue, parseFlowRecord, type FlowEvent } from './observation';

type Options = { api: RedisApi; session: string; active: boolean; running: boolean; demo: boolean; queueKey?: string; pattern: string; keys: KeyMeta[]; eventKey: string; notifications: boolean; interval: number };
export function useObservation(o: Options) {
  const [values, setValues] = useState<Record<string, RedisValue>>({});
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [effects, setEffects] = useState<{ event: FlowEvent; receivedAt: number }[]>([]);
  const eventsRef = useRef<FlowEvent[]>([]);
  const valuesRef = useRef(values); valuesRef.current = values;
  const baselineScope = useRef('');
  const demoJob = useRef('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(0);
  const keysRef = useRef(o.keys); keysRef.current = o.keys;
  const demoSerial = useRef(0);
  const scope = `${o.session}:${o.queueKey ?? o.pattern}`;
  const seedSignature = o.keys.slice(0, 200).map(k => k.key.base64).join(',');
  useEffect(() => { setValues({}); setEvents([]); setEffects([]); eventsRef.current = []; setUpdatedAt(0); setError(''); }, [scope]);
  const ingest = (incoming: FlowEvent[]) => {
    const now = Date.now(), old = new Set(eventsRef.current.map(e => `${e.sourceId}:${e.id}`));
    const next = appendEvents(eventsRef.current, incoming, now);
    eventsRef.current = next; setEvents(next);
    const fresh = next.filter(e => !e.late && !old.has(`${e.sourceId}:${e.id}`));
    if (fresh.length) setEffects(previous => [...previous.filter(e => now - e.receivedAt < 2100), ...fresh.map(event => ({ event, receivedAt: now }))].slice(-30));
  };

  useEffect(() => {
    if (!o.active) return;
    if (!o.running && baselineScope.current === scope && (o.queueKey ? !!valuesRef.current[o.queueKey] : keysRef.current.filter(k => !['list', 'stream'].includes(k.type)).slice(0, 12).every(k => !!valuesRef.current[k.key.base64]))) return;
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
    let subscription = '', afterId: string | null = null, scanCursor = '0', lastScan = Date.now(), round = 0;
    let reconnect = false;
    const pending = new Set<string>();
    const previous = new Map<string, RedisValue>(); // Re-baseline after pauses and source changes.
    const known = new Map(keysRef.current.slice(0, 200).map(k => [k.key.base64, k]));
    const request = (keyBase64?: string) => { const requestId = crypto.randomUUID(); pending.add(requestId); return { sessionId: o.session, requestId, generation: 0, keyBase64 }; };
    const read = async (key: string) => {
      if (o.demo && valuesRef.current[key]) return;
      const req = request(key);
      try {
        const value = await o.api.value(req);
        if (disposed) return;
        if (!o.demo) ingest(diffValue(previous.get(key), value));
        previous.set(key, value);
        setValues(old => ({ ...old, [key]: value }));
      } finally { pending.delete(req.requestId); }
    };
    async function tick() {
      try {
        if (reconnect) {
          const result = await o.api.notificationsStart(o.session);
          if (disposed) { await o.api.notificationsStop(o.session, result.subscriptionId); return; }
          subscription = result.subscriptionId; reconnect = false; previous.clear(); setStatus('gap'); setError('');
        }
        if (o.running && !o.queueKey && Date.now() - lastScan >= 15000) {
          const req = request();
          try { const scan = await o.api.scan({ ...req, pattern: o.pattern, cursor: scanCursor });
            if (disposed) return;
            scanCursor = scan.nextCursor;
            for (const key of scan.keys) if (known.has(key.key.base64) || known.size < 200) known.set(key.key.base64, key);
          } finally { pending.delete(req.requestId); }
          lastScan = Date.now();
        }
        const ids = o.queueKey ? [o.queueKey] : [...known.values()].filter(k => !['list', 'stream'].includes(k.type)).map(k => k.key.base64);
        const sample = ids.slice(round, round + 12); round = round + 12 >= ids.length ? 0 : round + 12;
        for (let i = 0; i < sample.length; i += 4) {
          const results = await Promise.allSettled(sample.slice(i, i + 4).map(read));
          if (disposed) return;
          const failure = results.find(r => r.status === 'rejected');
          if (failure?.status === 'rejected') setError(errorText(failure.reason));
        }
        if (o.running && !o.demo && o.eventKey) {
          const req = request(bytes(o.eventKey).base64);
          try {
            const batch = await o.api.flowEvents(req, afterId);
            if (disposed) return;
            afterId = batch.lastId;
            if (batch.gap) { previous.clear(); setStatus('gap'); }
            if (!batch.baseline) ingest(batch.records.flatMap(record => { const event = parseFlowRecord(record, Date.now()); return event && (o.queueKey ? event.keyBase64 === o.queueKey : known.has(event.keyBase64)) ? [event] : []; }));
          } finally { pending.delete(req.requestId); }
        }
        if (subscription) {
          const batch = await o.api.notificationsPoll(o.session, subscription);
          if (disposed) return;
          if (batch.gap) { previous.clear(); setStatus('gap'); }
          if (!batch.connected) {
            setError(batch.error || 'Notification connection closed');
            void o.api.notificationsStop(o.session, subscription).catch(() => {});
            subscription = ''; reconnect = true; previous.clear(); setStatus('gap');
          }
          const mapping: Record<string, FlowEvent['kind']> = { expired: 'expired', del: 'deleted', unlink: 'deleted', set: 'write', hset: 'write', expire: 'ttl', persist: 'ttl', lpush: 'changed', rpush: 'changed', lpop: 'changed', rpop: 'changed', xadd: 'changed', xdel: 'changed', xtrim: 'changed', sadd: 'changed', srem: 'changed', zadd: 'changed', zrem: 'changed', hdel: 'changed', incrby: 'changed' };
          ingest(batch.records.filter(r => mapping[r.operation] && (o.queueKey ? r.keyBase64 === o.queueKey : known.has(r.keyBase64))).map(r => ({ id: r.id, sourceId: `keyspace:${subscription}`, at: r.observedAt, keyBase64: r.keyBase64, kind: mapping[r.operation], origin: 'keyspace' as const, label: r.operation })));
        }
        if (!disposed) { baselineScope.current = scope; setUpdatedAt(Date.now()); }
      } catch (e) { if (!disposed) setError(errorText(e)); }
      finally { if (!disposed && o.running) timer = setTimeout(() => void tick(), o.interval); }
    }
    async function start() {
      setError('');
      setStatus(o.demo ? 'demo' : o.eventKey ? 'service' : 'snapshot');
      if (o.running && o.notifications && !o.demo) {
        try { const result = await o.api.notificationsStart(o.session);
          if (disposed) { await o.api.notificationsStop(o.session, result.subscriptionId); return; }
          subscription = result.subscriptionId;
          if (result.coverage !== 'keyevent') setStatus('notifications-unverified');
        } catch (e) { if (!disposed) setError(errorText(e)); }
      }
      if (!disposed) await tick();
    }
    void start();
    return () => {
      disposed = true; clearTimeout(timer);
      for (const id of pending) void o.api.cancel(o.session, id).catch(() => {});
      if (subscription) void o.api.notificationsStop(o.session, subscription).catch(() => {});
    };
  }, [scope, seedSignature, o.api, o.active, o.running, o.demo, o.eventKey, o.notifications, o.interval]);

  function simulate(kind: FlowEvent['kind'], target?: string) {
    if (!o.demo) return;
    const key = target ?? o.queueKey ?? Object.keys(values)[demoSerial.current % Math.max(1, Object.keys(values).length)];
    if (!key) return;
    const at = Date.now(), serial = ++demoSerial.current;
    const value = valuesRef.current[key];
    if (o.queueKey && value) {
      if (kind === 'enqueue') {
        demoJob.current = `job-${serial}`;
        const next = { ...value, observedAt: at, length: String(BigInt(value.length ?? '0') + 1n), rows: [...value.rows, { id: demoJob.current, cells: [bytes(demoJob.current)] }].slice(-12) };
        valuesRef.current = { ...valuesRef.current, [key]: next }; setValues(valuesRef.current);
      } else if (kind === 'dequeue') {
        // Demo's synthetic delivery token is separate from a Stream's retained log.
        demoJob.current = value.rows[0]?.id ?? demoJob.current;
        if (value.type === 'list' && value.rows.length) {
          const next = { ...value, observedAt: at, length: String(BigInt(value.length ?? '1') > 0 ? BigInt(value.length ?? '1') - 1n : 0n), rows: value.rows.slice(1) };
          valuesRef.current = { ...valuesRef.current, [key]: next }; setValues(valuesRef.current);
        }
      }
    } else if (value && ['write', 'ttl'].includes(kind)) {
      valuesRef.current = { ...valuesRef.current, [key]: { ...value, observedAt: at, ttlMs: '60000' } }; setValues(valuesRef.current);
    }
    ingest([{ id: `demo-${serial}`, sourceId: 'demo', at, keyBase64: key, kind, origin: 'demo', jobId: o.queueKey ? demoJob.current || 'demo-job' : undefined }]);
    // Demo effects are explicitly separate from Redis observations and never sent to Redis.
  }
  const simulateRef = useRef(simulate); simulateRef.current = simulate;
  useEffect(() => {
    if (!o.demo || !o.running || !o.active) return;
    let step = 0;
    const timer = setInterval(() => { const kinds: FlowEvent['kind'][] = o.queueKey ? ['enqueue', 'dequeue', 'completed', 'enqueue', 'dequeue', 'failed', 'retry'] : ['hit', 'write', 'miss', 'ttl']; simulateRef.current(kinds[step++ % kinds.length]); }, 1700);
    return () => clearInterval(timer);
  }, [o.demo, o.running, o.active, o.queueKey]);
  return { values, events, effects, status, error, updatedAt, simulate };
}
