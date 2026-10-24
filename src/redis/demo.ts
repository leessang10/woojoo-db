import { bytes, type KeyMeta, type ReadRequest, type RedisProfile, type RedisValue, type SavedView, type Workspace } from './model';
const profile: RedisProfile = { id: 'redis-demo', name: 'Redis playground', host: 'demo.local', port: 6379, username: '', db: 0, tls: false, environment: 'DEMO', separator: ':' };
const seed = [
  ['user:1001', 'string', '-1', '{"id":1001,"name":"Sangmu","preferences":{"language":"ko","theme":"dark"}}'],
  ['cache:weather', 'string', '45000', '{"city":"Seoul","temperature":18}'],
  ['cache:catalog', 'hash', '240000', ''], ['queue:emails', 'list', '-1', ''],
  ['online:users', 'set', '900000', ''], ['leaderboard:weekly', 'zset', '7200000', ''], ['events:orders', 'stream', '-1', ''],
  ['user', 'string', '-1', 'A key can also be a prefix'], ['user::empty', 'string', '-1', 'An empty prefix segment'],
];
const metadata = (): KeyMeta[] => seed.map(([name, type, ttlMs, value]) => ({ key: bytes(name), type, ttlMs, length: type === 'string' ? String(value.length) : '3', error: null }));
const view = (id: string, name: string, kind: SavedView['kind'], key: string): SavedView => ({ id, name, kind, profileId: profile.id, db: 0, pattern: kind === 'cache' ? key : '', keyBase64: kind === 'cache' ? '' : bytes(key).base64, direction: 'unknown' });
const workspace: Workspace = { profiles: [profile], credentialSupported: false, views: [view('cache', '애플리케이션 캐시', 'cache', 'cache:*'), view('emails', '이메일 큐', 'list', 'queue:emails'), view('orders', '주문 이벤트', 'stream', 'events:orders')] };
export async function demoCall(command: string, args: Record<string, unknown>): Promise<unknown> {
  const request = (args.request ?? {}) as ReadRequest;
  if (command === 'redis_workspace_load') return structuredClone(workspace);
  if (command === 'redis_connect') return { sessionId: 'redis-demo-session' };
  if (['redis_test_connection', 'redis_disconnect', 'redis_cancel', 'redis_forget_password'].includes(command)) return;
  if (command === 'redis_profile_save') { const p = args.profile as RedisProfile; workspace.profiles = [...workspace.profiles.filter(v => v.id !== p.id), p]; return; }
  if (command === 'redis_profile_delete') { workspace.profiles = workspace.profiles.filter(v => v.id !== args.id); workspace.views = workspace.views.filter(v => v.profileId !== args.id); return; }
  if (command === 'redis_view_save') { const v = args.view as SavedView; workspace.views = [...workspace.views.filter(x => x.id !== v.id), v]; return; }
  if (command === 'redis_view_delete') { workspace.views = workspace.views.filter(v => v.id !== args.id); return; }
  if (command === 'redis_scan') {
    const pattern = request.pattern || '*'; const rx = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return { keys: metadata().filter(k => rx.test(k.key.text) && (!request.typeFilter || k.type === request.typeFilter)), nextCursor: '0', observedAt: Date.now(), partial: false, dbSize: String(seed.length), topologyVerified: true };
  }
  if (command === 'redis_server_info') return { info: 'keyspace_hits:1204\r\nkeyspace_misses:98\r\n', dbSize: String(seed.length), errors: [] };
  if (command === 'redis_queue_inspect') return { groups: [{ name: 'orders-worker', pending: '1', consumers: '2', lag: '0' }], consumers: request.group ? [{ name: 'worker-1', pending: '1', idle: '1200' }, { name: 'worker-2', pending: '0', idle: '5300' }] : [], pending: request.group ? [{ id: '1729800000000-0', consumer: 'worker-1', idle: '1200', deliveries: '1' }] : [], errors: [], observedAt: Date.now() };
  const meta = metadata().find(k => k.key.base64 === request.keyBase64);
  if (!meta) throw 'KEY_MISSING: Key does not exist';
  if (command === 'redis_key_metadata') return meta;
  if (command === 'redis_read_value') {
    const rows: string[][] = meta.type === 'hash' ? [['sku', 'WJ-001'], ['name', 'Keyboard'], ['price', '89000']] : meta.type === 'list' ? [['{"type":"welcome","userId":1001}'], ['{"type":"receipt","orderId":42}'], ['{"type":"reminder","userId":1002}']] : meta.type === 'set' ? [['1001'], ['1002'], ['1003']] : meta.type === 'zset' ? [['Sangmu', '980'], ['Alice', '750'], ['Bob', '500']] : meta.type === 'stream' ? [['event', 'created', 'orderId', '42'], ['event', 'paid', 'orderId', '42'], ['event', 'shipped', 'orderId', '42']] : [];
    const result: RedisValue = { ...meta, text: meta.type === 'string' ? bytes(seed.find(s => s[0] === meta.key.text)![3]) : null, rows: rows.map((cells, i) => ({ id: meta.type === 'stream' ? `${1729800000000 + i * 1000}-0` : String(i), cells: cells.map(bytes) })), nextCursor: null, observedAt: Date.now(), truncated: false }; return result;
  }
  throw new Error('Unsupported demo command');
}
