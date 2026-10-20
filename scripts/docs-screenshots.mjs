// Capture documentation from the packaged app using disposable SQLite data only.
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
const child = spawn(executable, [], {cwd:profile, windowsHide:true, stdio:'ignore', env:{...process.env,
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
  await page.getByRole('button',{name:'새 연결',exact:true}).first().click();
  await page.getByRole('button',{name:'SQLite',exact:true}).click();
  await page.getByLabel('연결 이름',{exact:true}).fill('Local notes');
  await page.getByRole('textbox',{name:'데이터베이스',exact:true}).fill('preview.sqlite3');
  await page.getByRole('button',{name:'연결하기',exact:true}).click();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','true');
  await page.locator('.cm-content').fill(    "CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE);\n"+
    "CREATE TABLE board (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES user(id), title TEXT NOT NULL, status TEXT DEFAULT 'draft', created_at TEXT DEFAULT CURRENT_TIMESTAMP);\n"+
    "INSERT INTO user VALUES (1, 'Mina Kim', 'mina@example.com'), (2, 'Alex Park', 'alex@example.com'), (3, 'Jamie Lee', 'jamie@example.com');\n"+
    "INSERT INTO board (user_id,title,status) VALUES (1,'Getting started','published'),(2,'October release notes','published'),(1,'Database migration checklist','draft'),(3,'Team handbook','published'),(2,'Query performance notes','draft');\n"+
    "SELECT b.id, u.name AS author, b.title, b.status FROM board b JOIN user u ON u.id = b.user_id ORDER BY b.id;");
  await page.locator('.query-tools').getByRole('button',{name:'스크립트 실행',exact:true}).click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(5);
  await page.getByTitle('목록 새로고침',{exact:true}).click();
  await expect(page.locator('.tree-table')).toHaveCount(2);
  await page.locator('.cm-content').fill('SELECT\n    b.id,\n    u.name AS author,\n    b.title,\n    b.status\nFROM board AS b\nJOIN user AS u ON u.id = b.user_id\nORDER BY b.id;');
  await page.locator('.run-button').click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(5);
  mkdirSync('docs/images',{recursive:true});
  await page.mouse.move(1000,40);
  await page.screenshot({path:'docs/images/workspace-ko.png'});
  await page.getByLabel('언어 / Language').selectOption('en');
  await page.getByRole('button',{name:'Switch to light mode',exact:true}).click();
  await page.waitForTimeout(300);
  await page.screenshot({path:'docs/images/workspace-en.png'});
  await page.getByLabel('언어 / Language').selectOption('ko');
  await page.locator('.tree-schema').click({button:'right'});
  await page.getByRole('menuitem',{name:'ERD 열기',exact:true}).click();
  await expect(page.locator('.erd-table-node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.waitForTimeout(500);
  await page.mouse.move(1000,40);
  await page.screenshot({path:'docs/images/erd-ko.png'});
  await page.getByLabel('언어 / Language').selectOption('en');
  await page.screenshot({path:'docs/images/erd-en.png'});
  expect(errors).toEqual([]);
  expect(await listening(1420)).toBe(false);
  console.log(JSON.stringify({executable,url:page.url(),developmentServer:false,isolatedProfile:profile,status:'passed'}));
} finally {
  await browser?.close();
  if(child.pid) {
    try { execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}); } catch { /* Already closed. */ }
  }
}
