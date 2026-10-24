import { describe, expect, it } from 'vitest';
import { bytes, type RedisValue } from '../model';
import { appendEvents, diffValue, parseFlowRecord, type FlowEvent } from './observation';

const value = (overrides: Partial<RedisValue> = {}): RedisValue => ({ key: bytes('cache:a'), type: 'string', length: '3', ttlMs: '10000', rows: [], text: bytes('old'), nextCursor: null, observedAt: 10000, truncated: false, ...overrides });
const event = (id: string, overrides: Partial<FlowEvent> = {}): FlowEvent => ({ id, sourceId: 'service:a', at: 10000, keyBase64: 'YQ==', kind: 'hit', origin: 'service', ...overrides });

describe('Redis flow observations', () => {
  it('accepts normalized stream fields and JSON envelopes without trusting the origin', () => {
    const fields = { sourceId: 'api', kind: 'hit', keyBase64: 'YQ==', occurredAt: '10000', sourceSequence: '90071992547409930', origin: 'demo' };
    expect(parseFlowRecord({ id: '1-0', fields }, 10000)).toMatchObject({ id: '1-0', sequence: fields.sourceSequence, at: 10000, origin: 'service' });
    expect(parseFlowRecord({ id: '2-0', fields: { event: JSON.stringify({ ...fields, eventId: 'my-id' }) } }, 10000)?.id).toBe('my-id');
  });
  it('rejects malformed, oversized, invalid, or future-dated events without throwing', () => {
    const fields = { sourceId: 'api', kind: 'hit', keyBase64: 'YQ==', at: '10000' };
    const invalid: Record<string, string>[] = [{ event: '{' }, { ...fields, keyBase64: '??' }, { ...fields, kind: 'arbitrary' }, { ...fields, at: '' }, { ...fields, at: '999999999' }, { ...fields, sourceSequence: 'NaN' }, { ...fields, label: 'x'.repeat(2049) }];
    for (const bad of invalid) expect(parseFlowRecord({ id: '1', fields: bad }, 10000)).toBeNull();
  });
  it('deduplicates by source and event id', () => {
    expect(appendEvents([event('a')], [event('a'), event('a', { sourceId: 'b' })], 10000)).toHaveLength(2);
  });
  it('compares arbitrarily large sequences numerically and retains late history', () => {
    const result = appendEvents([], [event('a', { sequence: '90071992547409939' }), event('b', { sequence: '90071992547409940' }), event('c', { sequence: '90071992547409938' })], 10000);
    expect(result.map(item => !!item.late)).toEqual([false, false, true]);
    expect(appendEvents(result, [event('d', { sequence: '90071992547409941' })], 10000).at(-1)?.late).toBeUndefined();
  });
  it('compares stream-style sequences numerically and timestamp fallback only within a source', () => {
    expect(appendEvents([], [event('a', { sequence: '100-9' }), event('b', { sequence: '100-10' }), event('c', { sequence: '99-99' })], 10000).map(item => !!item.late)).toEqual([false, false, true]);
    expect(appendEvents([event('a')], [event('b', { at: 9999 }), event('c', { at: 9999, sourceId: 'other' })], 10000).map(item => !!item.late)).toEqual([false, true, false]);
  });
  it('bounds retained records by age, count, and memory', () => {
    expect(appendEvents([], [event('old', { at: 1 })], 700000)).toHaveLength(0);
    const many = Array.from({ length: 5500 }, (_, i) => event(String(i)));
    const bounded = appendEvents([], many, 10000);
    expect(bounded).toHaveLength(5000); expect(bounded[0].id).toBe('500');
    const large = appendEvents([], many.map(item => ({ ...item, label: 'x'.repeat(2048) })), 10000);
    expect(large.reduce((sum, item) => sum + JSON.stringify(item).length * 2, 0)).toBeLessThanOrEqual(16 * 1024 * 1024);
  });
  it('starts a baseline silently and ignores natural TTL countdown', () => {
    expect(diffValue(undefined, value())).toEqual([]);
    expect(diffValue(value(), value({ observedAt: 12000, ttlMs: '8000' }))).toEqual([]);
    expect(diffValue(value(), value({ observedAt: 12000, ttlMs: '10000' })).map(item => item.kind)).toEqual(['ttl']);
  });
  it('distinguishes complete value changes from partial preview changes', () => {
    expect(diffValue(value(), value({ text: bytes('new') }))).toMatchObject([{ kind: 'changed', label: 'value' }]);
    expect(diffValue(value({ truncated: true }), value({ text: bytes('new'), truncated: true }))).toMatchObject([{ kind: 'changed', label: 'preview' }]);
    expect(diffValue(value({ truncated: true }), value({ truncated: true }))).toEqual([]);
  });
  it('does not invent list job identities or business results from length or preview changes', () => {
    const list = value({ type: 'list', text: null, rows: [{ id: '0', cells: [bytes('same')] }] });
    const delta = diffValue(list, { ...list, length: '4' });
    expect(delta).toMatchObject([{ kind: 'length', delta: 1 }]); expect(delta[0].jobId).toBeUndefined();
    expect(diffValue(list, { ...list, rows: [{ id: '0', cells: [bytes('other')] }] })).toMatchObject([{ kind: 'changed', label: 'preview' }]);
  });
  it('labels newly observed stream rows as discovered and does not infer removals', () => {
    const stream = value({ type: 'stream', text: null, truncated: true, rows: [{ id: '1-0', cells: [] }] });
    expect(diffValue(stream, { ...stream, rows: [{ id: '2-0', cells: [] }] })).toMatchObject([{ kind: 'discovered', jobId: '2-0' }]);
    expect(diffValue(stream, { ...stream, rows: [] })).toEqual([]);
  });
  it('reports confirmed absence without guessing expiration versus deletion', () => {
    expect(diffValue(value(), value({ type: 'none', ttlMs: '-2' }))).toMatchObject([{ kind: 'missing' }]);
  });
});
