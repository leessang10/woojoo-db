export type RedisProfile = { id: string; name: string; host: string; port: number; username: string; db: number; tls: boolean; environment: string; separator: string };
export type SavedView = { id: string; profileId: string; db: number; name: string; kind: 'cache' | 'list' | 'stream' | 'favorite'; pattern: string; keyBase64: string; direction: 'unknown' | 'left' | 'right' };
export type Workspace = { profiles: RedisProfile[]; views: SavedView[]; credentialSupported: boolean };
export type RedisBytes = { base64: string; text: string; utf8: boolean };
export type KeyMeta = { key: RedisBytes; type: string; ttlMs: string | null; length: string | null; error: string | null };
export type ReadRequest = { sessionId: string; requestId: string; generation: number; keyBase64?: string; pattern?: string; typeFilter?: string; cursor?: string; offset?: string; group?: string };
export type ScanResult = { keys: KeyMeta[]; nextCursor: string; observedAt: number; partial: boolean; dbSize: string | null; topologyVerified: boolean };
export type RedisValue = { key: RedisBytes; type: string; length: string | null; ttlMs: string | null; rows: { id: string; cells: RedisBytes[] }[]; text: RedisBytes | null; nextCursor: string | null; observedAt: number; truncated: boolean };
export type QueueInfo = { groups: { name: string; pending: string; consumers: string; lag: string | null }[]; consumers: { name: string; pending: string; idle: string }[]; pending: { id: string; consumer: string; idle: string; deliveries: string }[]; errors: string[]; observedAt: number };
export const TYPES = ['string', 'hash', 'list', 'set', 'zset', 'stream'];
export function bytes(text: string): RedisBytes { const raw = new TextEncoder().encode(text); let binary = ''; for (const b of raw) binary += String.fromCharCode(b); return { base64: btoa(binary), text, utf8: true }; }
export function hex(value: RedisBytes) { return Array.from(atob(value.base64), c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' '); }
export function jsonPreview(text: string): { valid: boolean; value?: unknown } {
  try { const value: unknown = JSON.parse(text, (_key, value: unknown) => { if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Unsafe numeric preview'); return value; }); return { valid: true, value }; } catch { return { valid: false }; }
}
export type TtlBucket = 'persistent' | 'missing' | 'minute' | 'five' | 'hour' | 'later' | 'unknown';
export const TTL_BUCKETS: TtlBucket[] = ['minute', 'five', 'hour', 'later', 'persistent', 'missing', 'unknown'];
export function ttlBucket(ms: string | null): TtlBucket { if (ms === null) return 'unknown'; const n = Number(ms); return n === -1 ? 'persistent' : n === -2 ? 'missing' : !Number.isFinite(n) || n < 0 ? 'unknown' : n <= 60000 ? 'minute' : n <= 300000 ? 'five' : n <= 3600000 ? 'hour' : 'later'; }
export function ttlText(ms: string | null, ko: boolean) { const bucket = ttlBucket(ms); if (bucket === 'persistent') return ko ? '만료 없음' : 'No expiry'; if (bucket === 'missing') return ko ? '사라짐' : 'Missing'; if (bucket === 'unknown') return '—'; const seconds = Math.ceil(Number(ms) / 1000); return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.ceil(seconds / 60)}m` : `${(seconds / 3600).toFixed(1)}h`; }
export function validateProfile(p: RedisProfile): string | null {
  if (!p.name.trim() || !p.host.trim() || /[\s/@]/.test(p.host) || p.host.includes('://')) return 'endpoint';
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) return 'port';
  if (!Number.isInteger(p.db) || p.db < 0 || p.db > 2147483647) return 'db';
  if (!p.separator || p.separator.length > 8) return 'separator';
  return null;
}
export function mergeKeys(current: KeyMeta[], incoming: KeyMeta[], maxKeys = 10000, maxBytes = 32 * 1024 * 1024) {
  const map = new Map(current.map(k => [k.key.base64, k])); let size = current.reduce((sum, k) => sum + JSON.stringify(k).length * 2, 0); let limited = false;
  for (const k of incoming) {
    const old = map.get(k.key.base64); const cost = JSON.stringify(k).length * 2 - (old ? JSON.stringify(old).length * 2 : 0);
    if ((!old && map.size >= maxKeys) || size + cost > maxBytes) { limited = true; continue; }
    map.set(k.key.base64, k); size += cost;
  }
  return { keys: [...map.values()], limited };
}
export type PrefixNode = { id: string; label: string; prefix: string; count: number; keys: KeyMeta[]; children: PrefixNode[] };
export function prefixTree(keys: KeyMeta[], separator: string): PrefixNode[] {
  const roots: PrefixNode[] = [];
  for (const key of keys) {
    const parts = key.key.utf8 ? key.key.text.split(separator || ':') : [`[binary] ${key.key.base64}`]; let nodes = roots; const path: string[] = [];
    // Bound nesting for adversarial keys; the rest stays a single literal leaf.
    if (parts.length > 32) parts.splice(31, parts.length - 31, parts.slice(31).join(separator));
    parts.forEach((part, index) => { path.push(part); const id = JSON.stringify(path); let node = nodes.find(n => n.id === id); if (!node) { node = { id, label: part, prefix: path.join(separator), count: 0, keys: [], children: [] }; nodes.push(node); } node.count++; if (index === parts.length - 1) node.keys.push(key); nodes = node.children; });
  }
  const sort = (nodes: PrefixNode[]) => { nodes.sort((a, b) => a.label.localeCompare(b.label)); nodes.forEach(n => sort(n.children)); }; sort(roots); return roots;
}
export const freshProfile = (): RedisProfile => ({ id: crypto.randomUUID(), name: '', host: '127.0.0.1', port: 6379, username: '', db: 0, tls: false, environment: '', separator: ':' });
export function errorText(error: unknown): string { return typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error); }
