// Disposable real Redis + packaged WebView/Tauri integration verification.
// Requires Docker Desktop running and an existing release executable.
import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import net from 'node:net';

const id = randomUUID();
const container = `woojoo-redis-verify-${id}`;
const name = `Live Redis verification ${id}`;
const password = randomUUID();
const docker = (...args) => execFileSync('docker', args, { windowsHide: true, encoding: 'utf8', timeout: 120000 }).trim();
const cli = (...args) => docker('exec', '-e', `REDISCLI_AUTH=${password}`, container, 'redis-cli', '-n', '3', '--raw', ...args);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, child, page, created = false;
const results = { container, checks: [] };
try {
  docker('run', '-d', '--name', container, '-p', '127.0.0.1::6379', 'redis:7.2-alpine', 'redis-server', '--save', '', '--appendonly', 'no', '--requirepass', password);
  created = true;
  const port = Number(docker('port', container, '6379/tcp').split(':').at(-1));
  for (let i = 0; i < 30; i++) { try { if (cli('PING') === 'PONG') break; } catch {} await sleep(500); }
  results.version = cli('INFO', 'server').match(/redis_version:([^\r\n]+)/)?.[1];
  results.image = docker('inspect', '--format', '{{.Image}}', container);
  cli('SET', 'user:1001', '{"name":"Sangmu","live":true}');
  cli('SET', 'cache:weather', '{"city":"Seoul","temperature":22}', 'EX', '240');
  cli('HSET', 'cache:catalog', 'product', 'Keyboard', 'price', '980');
  cli('EXPIRE', 'cache:catalog', '1800');
  cli('RPUSH', 'queue:emails', '{"job":"welcome"}', '{"job":"receipt"}', '{"job":"reminder"}');
  cli('SADD', 'online:users', '1001', '1002', '1003');
  cli('ZADD', 'leaderboard:weekly', '980', 'Sangmu', '750', 'Alex');
  cli('XADD', 'events:orders', '1000-0', 'status', 'created');
  cli('XADD', 'events:orders', '1001-0', 'status', 'shipped');
  cli('XGROUP', 'CREATE', 'events:orders', 'orders-worker', '0');
  cli('XREADGROUP', 'GROUP', 'orders-worker', 'worker-1', 'COUNT', '1', 'STREAMS', 'events:orders', '>');
  const before = { list: cli('LRANGE', 'queue:emails', '0', '-1'), stream: cli('XRANGE', 'events:orders', '-', '+'), pending: cli('XPENDING', 'events:orders', 'orders-worker'), groups: cli('XINFO', 'GROUPS', 'events:orders') };
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const debugPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
  child = spawn(path.resolve(process.argv[2] ?? 'src-tauri/target/release/woojoo-db.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: mkdtempSync(path.join(tmpdir(), 'woojoo-redis-live-')), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } });
  let launchError; child.once('error', e => { launchError = e; });
  for (let i = 0; i < 60; i++) { if (launchError) throw launchError; try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 500 }); break; } catch { await sleep(500); } }
  if (!browser) throw Error('WebView debug endpoint unavailable');
  page = browser.contexts()[0].pages()[0];
  await expect(page.locator('.rail')).toBeVisible({ timeout: 20000 });
  expect(new URL(page.url()).hostname).toBe('tauri.localhost');
  await page.evaluate(() => { localStorage.setItem('woojoo-language', 'ko'); localStorage.setItem('woojoo-work-area', 'redis'); });
  await page.reload(); await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('button', { name: '연결 추가', exact: true }).first().click();
  await page.getByLabel('연결 이름', { exact: true }).fill(name);
  await page.getByLabel('호스트', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('포트', { exact: true }).fill(String(port));
  await page.getByLabel('DB 번호', { exact: true }).fill('3');
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '연결 테스트', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('연결 테스트 성공');
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('dialog').getByRole('button', { name: '연결', exact: true }).click();
  await expect(page.locator('.redis-status')).toHaveText('연결됨');
  results.checks.push('Packaged UI connection test + password AUTH + SELECT DB 3');
  const table = page.getByTestId('redis-key-list');
  const detail = page.getByTestId('redis-detail');
  for (const [key, content] of [['user:1001', 'Sangmu'], ['cache:catalog', 'Keyboard'], ['queue:emails', 'welcome'], ['online:users', '1003'], ['leaderboard:weekly', '980'], ['events:orders', 'shipped']]) {
    await table.getByRole('button', { name: key, exact: true }).click();
    await expect(detail).toContainText(content);
    results.checks.push(`UI typed value: ${key}`);
  }
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/redis-live-keys.png' });
  await page.getByRole('button', { name: '캐시', exact: true }).click();
  await page.getByRole('button', { name: /1–5분/ }).click();
  await expect(table).toContainText('cache:weather');
  await expect(table).not.toContainText('user:1001');
  await expect(table).not.toContainText('cache:catalog');
  await page.screenshot({ path: 'artifacts/redis-live-cache.png' });
  results.checks.push('UI cache TTL 1–5 minute bucket excludes persistent and longer-lived keys');
  await page.getByRole('button', { name: '키', exact: true }).click();
  for (const [key, viewName] of [['queue:emails', 'Live email queue'], ['events:orders', 'Live order stream']]) {
    await page.getByRole('button', { name: '키', exact: true }).click();
    await table.getByRole('button', { name: key, exact: true }).click();
    await page.getByRole('button', { name: '큐로 등록', exact: true }).click();
    await page.getByRole('dialog').getByLabel('이름', { exact: true }).fill(viewName);
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('button', { name: '큐', exact: true }).click();
    await page.locator('.redis-queue-picker').getByRole('button', { name: viewName, exact: true }).click();
    if (key === 'queue:emails') { await expect(detail).toContainText('welcome'); await expect(page.getByTestId('redis-queue-info')).toContainText('처리 방향'); }
    else { await expect(page.getByTestId('redis-queue-info')).toContainText('orders-worker'); await page.getByRole('button', { name: 'orders-worker', exact: true }).click(); await expect(page.getByTestId('redis-queue-info')).toContainText('worker-1'); await expect(page.getByTestId('redis-queue-info')).toContainText('1000-0'); }
    await page.screenshot({ path: `artifacts/redis-live-${key === 'queue:emails' ? 'list' : 'stream'}.png` });
    results.checks.push(`UI saved queue: ${key}`);
  }
  expect({ list: cli('LRANGE', 'queue:emails', '0', '-1'), stream: cli('XRANGE', 'events:orders', '-', '+'), pending: cli('XPENDING', 'events:orders', 'orders-worker'), groups: cli('XINFO', 'GROUPS', 'events:orders') }).toEqual(before);
  results.checks.push('Queue data, pending summary and group position unchanged after observation');
  await page.getByRole('button', { name: '연결 끊기', exact: true }).click();
  await expect(page.locator('.redis-status')).toHaveText('연결 안 됨');
  results.checks.push('Explicit UI disconnect');
  results.passed = true;
} finally {
  if (page && !page.isClosed()) {
    await page.evaluate(async name => { const invoke = window.__TAURI_INTERNALS__.invoke; const ws = await invoke('redis_workspace_load'); for (const profile of ws.profiles.filter(p => p.name === name)) await invoke('redis_profile_delete', { id: profile.id }); }, name).catch(e => { console.error('Profile cleanup failed:', e.message); process.exitCode = 1; });
  }
  if (browser) await browser.close().catch(() => {});
  if (child?.pid && child.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
  if (created) { docker('rm', '-f', container); results.containerRemoved = true; }
  mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/redis-live-results.json', JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results, null, 2));
