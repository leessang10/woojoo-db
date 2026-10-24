// Starts a persistent local playground and leaves the desktop app open.
import { chromium, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const docker = (...args) => execFileSync('docker', args, { windowsHide: true, encoding: 'utf8' }).trim();
const container = `woojoo-redis-playground-${Date.now()}`;
docker('run', '-d', '--name', container, '-p', '127.0.0.1::6379', 'redis:7.2-alpine');
const port = Number(docker('port', container, '6379/tcp').split(':').at(-1));
const cli = (...args) => docker('exec', container, 'redis-cli', ...args);
for (let i = 0; i < 30; i++) { try { if (cli('PING') === 'PONG') break; } catch {} await new Promise(r => setTimeout(r, 500)); }
cli('SET', 'user:1001', '{"name":"Sangmu","email":"sangmu@example.test","role":"admin"}');
cli('SET', 'user:1002', '{"name":"Alex","role":"member"}');
cli('SET', 'cache:weather', '{"city":"Seoul","temperature":22}', 'EX', '300');
cli('SET', 'cache:session', '{"userId":1001,"authenticated":true}', 'EX', '3600');
cli('HSET', 'cache:catalog', 'product', 'Keyboard', 'price', '980', 'stock', '42');
cli('EXPIRE', 'cache:catalog', '86400');
cli('RPUSH', 'queue:emails', '{"job":"welcome","to":"alex@example.test"}', '{"job":"receipt","orderId":1001}', '{"job":"reminder"}');
cli('SADD', 'online:users', '1001', '1002', '1003');
cli('ZADD', 'leaderboard:weekly', '980', 'Sangmu', '750', 'Alex', '620', 'Mina');
cli('XADD', 'events:orders', '1000-0', 'orderId', '1001', 'status', 'created');
cli('XADD', 'events:orders', '1001-0', 'orderId', '1001', 'status', 'paid');
cli('XADD', 'events:orders', '1002-0', 'orderId', '1001', 'status', 'shipped');
cli('XGROUP', 'CREATE', 'events:orders', 'orders-worker', '0');
cli('XREADGROUP', 'GROUP', 'orders-worker', 'worker-1', 'COUNT', '1', 'STREAMS', 'events:orders', '>');
const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
const debugPort = probe.address().port; await new Promise(r => probe.close(r));
const child = spawn(path.resolve('src-tauri/target/release/woojoo-db.exe'), [], { detached: true, windowsHide: false, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: mkdtempSync(path.join(tmpdir(), 'woojoo-playground-')), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } });
child.unref();
let browser;
for (let i = 0; i < 60; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 500 }); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
if (!browser) throw Error('App debug endpoint unavailable');
try {
  const page = browser.contexts()[0].pages()[0];
  await expect(page.locator('.rail')).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => { localStorage.setItem('woojoo-language', 'ko'); localStorage.setItem('woojoo-work-area', 'redis'); });
  await page.reload();
  await page.getByRole('button', { name: '연결 추가', exact: true }).first().click();
  await page.getByLabel('연결 이름', { exact: true }).fill('로컬 Redis 놀이터');
  await page.getByLabel('호스트', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('포트', { exact: true }).fill(String(port));
  await page.getByRole('dialog').getByRole('button', { name: '연결', exact: true }).click();
  await expect(page.locator('.redis-status')).toHaveText('연결됨');
  await expect(page.getByTestId('redis-key-list')).toContainText('user:1001');
  const profileId = await page.evaluate(async port => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const ws = await invoke('redis_workspace_load');
    const profile = ws.profiles.find(p => p.port === port && p.name === '로컬 Redis 놀이터');
    for (const [kind, name, key] of [['list', '이메일 작업 큐', 'queue:emails'], ['stream', '주문 이벤트 스트림', 'events:orders'], ['cache', '캐시 전체', '']]) {
      await invoke('redis_view_save', { view: { id: crypto.randomUUID(), profileId: profile.id, db: 0, name, kind, pattern: kind === 'cache' ? 'cache:*' : '', keyBase64: btoa(key), direction: 'unknown' } });
    }
    return profile.id;
  }, port);
  // Reload the saved view list through the normal connection flow.
  await page.getByRole('button', { name: '연결 끊기', exact: true }).click();
  await page.getByRole('button', { name: '연결', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '연결', exact: true }).click();
  await expect(page.locator('.redis-status')).toHaveText('연결됨');
  await expect(page.locator('.redis-sidebar')).toContainText('주문 이벤트 스트림');
  await page.getByTestId('redis-key-list').getByRole('button', { name: 'user:1001', exact: true }).click();
  await expect(page.getByTestId('redis-detail')).toContainText('Sangmu');
  await page.bringToFront();
  console.log(JSON.stringify({ container, host: '127.0.0.1', port, db: 0, password: null, profileId, appPid: child.pid, status: 'connected; left running' }, null, 2));
} finally { await browser.close(); }
