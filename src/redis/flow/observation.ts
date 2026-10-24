import type { RedisValue } from '../model';

export type FlowEvent = {
  id: string; sourceId: string; sequence?: string; at: number; keyBase64: string;
  kind: 'enqueue' | 'dequeue' | 'completed' | 'failed' | 'retry' | 'hit' | 'miss' | 'write' | 'created' | 'deleted' | 'expired' | 'ttl' | 'changed' | 'discovered' | 'missing' | 'length';
  jobId?: string; attemptId?: string; group?: string; consumer?: string; label?: string; delta?: number;
  origin: 'service' | 'snapshot' | 'keyspace' | 'demo'; late?: boolean;
};
const KINDS = new Set<FlowEvent['kind']>(['enqueue', 'dequeue', 'completed', 'failed', 'retry', 'hit', 'miss', 'write', 'created', 'deleted', 'expired', 'ttl', 'changed', 'discovered', 'missing', 'length']);
const MAX_EVENTS = 5000, MAX_AGE = 600_000, MAX_BYTES = 16 * 1024 * 1024;
const text = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const sequence = (value: unknown): value is string => text(value, 128) && /^\d+(?:-\d+)?$/.test(value);
const base64 = (value: unknown): value is string => typeof value === 'string' && value.length <= 16384 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);

/** The observation stream is untrusted input; unknown properties and payloads are discarded. */
export function parseFlowRecord(record: { id: string; fields: Record<string, string> }, now: number): FlowEvent | null {
  try {
    if (!record || !record.fields || !text(record.id)) return null;
    let fields: Record<string, unknown> = record.fields;
    if (fields.event !== undefined) {
      if (!text(fields.event, 65536)) return null;
      const parsed: unknown = JSON.parse(fields.event);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      fields = parsed as Record<string, unknown>;
    }
    const id = fields.eventId ?? fields.id ?? record.id;
    const atRaw = fields.at ?? fields.occurredAt;
    const at = typeof atRaw === 'number' ? atRaw : typeof atRaw === 'string' && atRaw.trim() ? Number(atRaw) : NaN;
    if (!text(id) || !text(fields.sourceId) || !base64(fields.keyBase64) || !KINDS.has(fields.kind as FlowEvent['kind']) || !Number.isSafeInteger(at) || at < 0 || at > now + 60_000) return null;
    const result: FlowEvent = { id, sourceId: fields.sourceId, keyBase64: fields.keyBase64, at, kind: fields.kind as FlowEvent['kind'], origin: 'service' };
    const seq = fields.sequence ?? fields.sourceSequence;
    if (seq !== undefined) { if (!sequence(seq)) return null; result.sequence = seq; }
    for (const prop of ['jobId', 'attemptId', 'group', 'consumer', 'label'] as const) {
      if (fields[prop] !== undefined) { if (!text(fields[prop], prop === 'label' ? 2048 : 512)) return null; result[prop] = fields[prop]; }
    }
    if (fields.delta !== undefined) { const delta = Number(fields.delta); if (!Number.isSafeInteger(delta)) return null; result.delta = delta; }
    return result;
  } catch { return null; }
}

function compareSequence(a: string, b: string): number {
  const aa = a.split('-').map(BigInt), bb = b.split('-').map(BigInt);
  return aa[0] < bb[0] ? -1 : aa[0] > bb[0] ? 1 : (aa[1] ?? 0n) < (bb[1] ?? 0n) ? -1 : (aa[1] ?? 0n) > (bb[1] ?? 0n) ? 1 : 0;
}

/** Retains late records for inspection, but marks them to exclude them from live effects. */
export function appendEvents(previous: FlowEvent[], incoming: FlowEvent[], now: number): FlowEvent[] {
  const seen = new Set<string>();
  const watermarks = new Map<string, { sequence?: string; at: number }>();
  const all: FlowEvent[] = [];
  for (const event of [...previous, ...incoming]) {
    if (!Number.isFinite(event.at) || event.at < now - MAX_AGE || event.at > now + 60_000) continue;
    const identity = JSON.stringify([event.sourceId, event.id]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const mark = watermarks.get(event.sourceId);
    const validSeq = sequence(event.sequence) ? event.sequence : undefined;
    const late = event.late || !!mark && (validSeq && mark.sequence ? compareSequence(validSeq, mark.sequence) <= 0 : event.at < mark.at);
    all.push(late ? { ...event, late: true } : event);
    if (!late) watermarks.set(event.sourceId, { sequence: validSeq ?? mark?.sequence, at: Math.max(mark?.at ?? 0, event.at) });
  }
  const result: FlowEvent[] = [];
  let size = 0;
  for (let i = all.length - 1; i >= 0 && result.length < MAX_EVENTS; i--) {
    const cost = JSON.stringify(all[i]).length * 2;
    if (size + cost > MAX_BYTES) continue;
    size += cost; result.push(all[i]);
  }
  return result.reverse();
}

const safeNumber = (value: string | null) => value !== null && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const preview = (value: RedisValue) => JSON.stringify(value.text ? value.text.base64.slice(0, 65536) : value.rows.slice(0, 200).map(row => [row.id, row.cells.slice(0, 64).map(cell => cell.base64.slice(0, 4096))]));

/** Snapshot differences describe observations, never inferred business outcomes. */
export function diffValue(previous: RedisValue | undefined, next: RedisValue, now = next.observedAt): FlowEvent[] {
  if (!previous || previous.key.base64 !== next.key.base64) return [];
  const events: FlowEvent[] = [];
  const add = (kind: FlowEvent['kind'], extra: Partial<FlowEvent> = {}) => events.push({ id: `${next.key.base64}:${next.observedAt}:${kind}:${events.length}`, sourceId: `snapshot:${next.key.base64}`, at: now, keyBase64: next.key.base64, kind, origin: 'snapshot', ...extra });
  const wasMissing = previous.type === 'none' || previous.ttlMs === '-2', isMissing = next.type === 'none' || next.ttlMs === '-2';
  if (isMissing) { if (!wasMissing) add('missing'); return events; }
  if (wasMissing) { add('discovered'); return events; }
  const beforeTtl = safeNumber(previous.ttlMs), afterTtl = safeNumber(next.ttlMs);
  if (beforeTtl !== null && afterTtl !== null && beforeTtl >= -1 && afterTtl >= -1 && (beforeTtl === -1 && afterTtl >= 0 || beforeTtl >= 0 && afterTtl === -1 || beforeTtl >= 0 && afterTtl >= 0 && Math.abs(next.observedAt + afterTtl - previous.observedAt - beforeTtl) > 1500)) add('ttl');
  const beforeLength = safeNumber(previous.length), afterLength = safeNumber(next.length);
  if (previous.type !== next.type) { add('changed', { label: 'type' }); return events; }
  if (next.type === 'list') {
    if (beforeLength !== null && afterLength !== null && beforeLength !== afterLength) add('length', { delta: afterLength - beforeLength });
    else if (preview(previous) !== preview(next)) add('changed', { label: 'preview' });
  } else if (next.type === 'stream') {
    const known = new Set(previous.rows.slice(0, 200).map(row => row.id));
    for (const row of next.rows.slice(0, 200)) if (!known.has(row.id)) add('discovered', { jobId: row.id });
  } else if (preview(previous) !== preview(next)) {
    const full = !previous.truncated && !next.truncated && !previous.nextCursor && !next.nextCursor && (next.type === 'string' ? (previous.text?.base64.length ?? Infinity) <= 65536 && (next.text?.base64.length ?? Infinity) <= 65536 : previous.rows.length <= 200 && next.rows.length <= 200 && [...previous.rows, ...next.rows].every(row => row.cells.length <= 64 && row.cells.every(cell => cell.base64.length <= 4096)));
    add('changed', { label: full ? 'value' : 'preview' });
  }
  return events;
}
