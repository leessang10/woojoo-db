// Test the packaged executable, with Vite stopped and an isolated WebView profile.
import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

const executable = path.resolve(process.argv[2] ?? 'src-tauri/target/release/woojoo-db.exe');
const port = 9226;
const listening = port => new Promise(resolve => {
  const socket = net.connect({host:'127.0.0.1',port});
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => { socket.destroy(); resolve(false); });
});
if (await listening(1420)) throw new Error('Stop the development server on port 1420 before testing the release.');
if (await listening(port)) throw new Error(`Debug port ${port} is already in use.`);
const profile = mkdtempSync(path.join(tmpdir(), 'woojoo-release-smoke-'));
const child = spawn(executable, [], {windowsHide:true, stdio:'ignore', env:{...process.env,
  WEBVIEW2_USER_DATA_FOLDER:profile,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`,
}});
let launchError;
child.once('error', error => { launchError=error; });
let browser;
try {
  for (let attempt=0; attempt<60; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`App exited with ${child.exitCode}`);
    if (await listening(port)) break;
    await new Promise(resolve => setTimeout(resolve,500));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page');
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.workspace-brand')).toHaveText('Woojoo', {timeout:20000});
  expect(new URL(page.url()).hostname).toBe('tauri.localhost');
  expect(await page.evaluate(() => !!window.__TAURI_INTERNALS__)).toBe(true);
  await page.getByLabel('언어 / Language').selectOption('ko');
  await expect(page.locator('.workspace-empty')).toBeVisible();
  const database = page.locator('.rail').getByRole('button',{name:'데이터베이스',exact:true});
  const archive = page.locator('.rail').getByRole('button',{name:'실행한 쿼리',exact:true});
  await expect(page.locator('.rail').getByRole('button',{name:'쿼리 기록',exact:true})).toHaveCount(0);
  await archive.click();
  await expect(page.getByRole('region',{name:'실행한 쿼리',exact:true})).toBeVisible();
  await database.click();
  await expect(page.locator('.workspace-empty')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(database).toHaveAttribute('aria-current','page');
  await page.getByRole('button',{name:'새 연결',exact:true}).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.workspace-brand')).toHaveText('Woojoo');
  await expect(page.locator('.workspace-empty')).toBeVisible();
  mkdirSync('test-results',{recursive:true});
  await page.screenshot({path:'test-results/release-smoke.png'});
  expect(errors).toEqual([]);
  expect(await listening(1420)).toBe(false);
  console.log(JSON.stringify({executable,url:page.url(),developmentServer:false,isolatedProfile:profile,status:'passed'}));
} finally {
  await browser?.close();
  if(child.pid) {
    try { execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}); } catch { /* Already closed. */ }
  }
}
