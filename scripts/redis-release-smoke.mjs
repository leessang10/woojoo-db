// Verify the packaged WebView -> Tauri IPC -> native TCP path against an isolated
// protocol fixture. This is deliberately not described as a real Redis server test.
import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import net from 'node:net';

const executable = path.resolve(process.argv[2] ?? 'src-tauri/target/release/woojoo-db.exe');
const profileDir = mkdtempSync(path.join(tmpdir(), 'woojoo-redis-smoke-'));
const payload = Buffer.from('{"nativeRedisSmoke":true,"count":42}');
const key = Buffer.from('smoke:key');
const trace = [];
const sockets = new Set();
const bulk = b => Buffer.concat([Buffer.from(`$${b.length}\r\n`), b, Buffer.from('\r\n')]);
const array = items => Buffer.concat([Buffer.from(`*${items.length}\r\n`), ...items]);
function parse(buffer) {
  const end = buffer.indexOf('\r\n'); if (end < 0) return null;
  if (buffer[0] !== 42) throw Error('Expected RESP request array');
  const n = Number(buffer.subarray(1, end)); let offset = end + 2; const args = [];
  for (let i = 0; i < n; i++) { const next = buffer.indexOf('\r\n', offset); if (next < 0) return null; if (buffer[offset] !== 36) throw Error('Expected bulk argument'); const length = Number(buffer.subarray(offset + 1, next)); if (!Number.isSafeInteger(length) || length < 0 || length > 65536) throw Error('Invalid request length'); if (buffer.length < next + 2 + length + 2) return null; args.push(buffer.subarray(next + 2, next + 2 + length)); offset = next + length + 4; }
  return { args, offset };
}
const server = net.createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); let buffer = Buffer.alloc(0);
  socket.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); try { for (;;) { const parsed = parse(buffer); if (!parsed) break; buffer = buffer.subarray(parsed.offset); const [command, ...args] = parsed.args; const name = command.toString(); trace.push(name);
    let result;
    if (name === 'SELECT') result = Buffer.from('+OK\r\n');
    else if (name === 'INFO') result = bulk(Buffer.from(args[0]?.toString() === 'server' ? 'redis_version:7.2.0\r\nredis_mode:standalone\r\n' : 'cluster_enabled:0\r\n'));
    else if (name === 'SCAN') result = array([bulk(Buffer.from('0')), array([bulk(key)])]);
    else if (name === 'TYPE') result = Buffer.from('+string\r\n');
    else if (name === 'PTTL') result = Buffer.from(':-1\r\n');
    else if (name === 'STRLEN') result = Buffer.from(`:${payload.length}\r\n`);
    else if (name === 'DBSIZE') result = Buffer.from(':1\r\n');
    else if (name === 'GETRANGE') result = bulk(payload.subarray(Number(args[1]), Number(args[2]) + 1));
    else result = Buffer.from('-ERR unsupported smoke command\r\n');
    socket.write(result);
  } } catch (e) { socket.destroy(e); } });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const portProbe = net.createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const debugPort = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
const child = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profileDir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } });
let browser; let launchError; child.once('error', e => { launchError = e; });
try {
  for (let i = 0; i < 60; i++) {
    if (launchError) throw launchError; if (child.exitCode !== null) throw Error(`App exited: ${child.exitCode}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 500 }); break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!browser) throw Error('Packaged WebView debug endpoint did not start');
  const context = browser.contexts()[0]; const page = context.pages()[0] ?? await context.waitForEvent('page');
  await expect(page.locator('.rail')).toBeVisible({ timeout: 20000 });
  expect(new URL(page.url()).hostname).toBe('tauri.localhost');
  const result = await page.evaluate(async ({ port, id }) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const profile = { id, name: 'Isolated protocol smoke', host: '127.0.0.1', port, username: '', db: 0, tls: false, environment: 'test', separator: ':' };
    const { sessionId } = await invoke('redis_connect', { profile, password: null, remember: false });
    try {
      const request = { sessionId, requestId: crypto.randomUUID(), generation: 1, pattern: '*', cursor: '0' };
      const scan = await invoke('redis_scan', { request });
      const value = await invoke('redis_read_value', { request: { ...request, requestId: crypto.randomUUID(), keyBase64: scan.keys[0].key.base64 } });
      return { scan, value };
    } finally { await invoke('redis_disconnect', { sessionId }); }
  }, { port: server.address().port, id: `smoke-${randomUUID()}` });
  expect(result.scan.topologyVerified).toBe(true); expect(result.scan.nextCursor).toBe('0'); expect(result.scan.keys[0].ttlMs).toBe('-1');
  expect(JSON.parse(result.value.text.text)).toEqual({ nativeRedisSmoke: true, count: 42 });
  expect(trace.every(cmd => ['SELECT', 'INFO', 'SCAN', 'TYPE', 'PTTL', 'STRLEN', 'DBSIZE', 'GETRANGE'].includes(cmd))).toBe(true);
  await page.getByRole('button', { name: 'Redis', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Redis', exact: true, level: 1 })).toBeVisible();
  mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/redis-native-release.png' });
  console.log('PASS: packaged Redis workspace, native IPC, topology probe, SCAN, value read, disconnect; isolated protocol fixture only.');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child.pid && child.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* Already exited. */ } }
  for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
}
