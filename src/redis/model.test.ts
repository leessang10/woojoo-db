import { describe, expect, it } from 'vitest';
import { bytes, jsonPreview, mergeKeys, prefixTree, ttlBucket, validateProfile, type KeyMeta } from './model';
import { RequestGate } from './state';

const key = (name: string, ttlMs = '-1'): KeyMeta => ({ key: bytes(name), type: 'string', ttlMs, length: '1', error: null });
describe('Redis exploration', () => {
  it('does not display rounded JSON integers as original values', () => {
    expect(jsonPreview('{"id":9007199254740993}').valid).toBe(false);
    expect(jsonPreview('{"id":"9007199254740993"}')).toEqual({ valid: true, value: { id: '9007199254740993' } });
    expect(jsonPreview('null')).toEqual({ valid: true, value: null });
  });
  it('distinguishes no expiry, disappearance and unavailable TTL', () => {
    expect(['-1', '-2', '0', '60000', '60001', '300001', '3600001', null].map(ttlBucket)).toEqual(['persistent', 'missing', 'minute', 'minute', 'five', 'hour', 'later', 'unknown']);
  });
  it('keeps a key that is also a prefix and empty segments selectable', () => {
    const tree = prefixTree([key('user'), key('user:1'), key('user::name')], ':');
    expect(tree[0].keys.map(k => k.key.text)).toEqual(['user']);
    expect(tree[0].children.map(n => n.label)).toEqual(['', '1']);
    expect(tree[0].count).toBe(3);
  });
  it('deduplicates by original bytes, replacing refreshed metadata', () => {
    const binary = { ...key('same'), key: { base64: '/w==', text: 'same', utf8: false } };
    const result = mergeKeys([key('same')], [key('same', '42'), binary]);
    expect(result.keys).toHaveLength(2);
    expect(result.keys[0].ttlMs).toBe('42');
  });
  it('stops retaining keys at count and byte budgets', () => {
    expect(mergeKeys([], [key('a'), key('b')], 1).limited).toBe(true);
    expect(mergeKeys([], [key('a'.repeat(100))], 100, 10).keys).toEqual([]);
  });
  it('validates database and endpoint before attempting connections', () => {
    const p = { id: 'test', name: 'Local', host: 'localhost', port: 6379, username: '', db: 0, tls: false, environment: '', separator: ':' };
    expect(validateProfile(p)).toBeNull();
    expect(validateProfile({ ...p, db: -1 })).not.toBeNull();
    expect(validateProfile({ ...p, port: 0 })).not.toBeNull();
    expect(validateProfile({ ...p, host: 'redis://host:6379' })).not.toBeNull();
  });
});
describe('Redis request ownership', () => {
  it('rejects results after connection/search changes and newer requests', () => {
    const gate = new RequestGate(); const old = gate.begin('detail');
    const next = gate.begin('detail');
    expect(gate.current(old)).toBe(false); expect(gate.current(next)).toBe(true);
    gate.reset(); expect(gate.current(next)).toBe(false);
  });
  it('keeps independent scan and detail requests valid', () => {
    const gate = new RequestGate(); const scan = gate.begin('scan'); const detail = gate.begin('detail');
    expect(gate.current(scan)).toBe(true); expect(gate.current(detail)).toBe(true);
    gate.cancel('scan'); expect(gate.current(scan)).toBe(false); expect(gate.current(detail)).toBe(true);
  });
});
