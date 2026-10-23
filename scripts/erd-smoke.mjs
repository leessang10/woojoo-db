// Test the packaged executable, with Vite stopped and an isolated WebView profile.
import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

async function chooseOption(trigger, value) {
  await trigger.click();
  await trigger.page().getByRole('option').and(trigger.page().locator(`[data-value=${JSON.stringify(value)}]`)).click();
}
/** Language lives in Settings; open it, pick the language and close it again. */
async function chooseLanguage(page, value) {
  await page.keyboard.press('Control+,');
  await chooseOption(page.getByLabel('언어 / Language'), value);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}

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
  await chooseLanguage(page, 'ko');

  const databasePath=path.join(profile,'erd.sqlite3');
  const id=await page.evaluate(async database=>{
    const invoke=window.__TAURI_INTERNALS__.invoke;
    const id=await invoke('connect_db',{profile:{id:'erd-smoke',name:'ERD smoke',engine:'sqlite',host:'',port:0,database,username:'',password:'',tls:false}});
    await invoke('run_query',{id,sql:'CREATE TABLE users (id INTEGER PRIMARY KEY)'});
    await invoke('run_query',{id,sql:'CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER)'});
    await invoke('run_query',{id,sql:'INSERT INTO users VALUES (1)'});
    await invoke('run_query',{id,sql:'INSERT INTO orders VALUES (1,1)'});
    return id;
  },databasePath);
  await page.getByRole('button',{name:'새 연결',exact:true}).first().click();
  await page.getByRole('button',{name:'SQLite',exact:true}).click();
  await page.getByLabel('연결 이름',{exact:true}).fill('ERD smoke');
  await page.getByRole('textbox',{name:'데이터베이스',exact:true}).fill(databasePath);
  await page.getByRole('button',{name:'연결하기',exact:true}).click();
  await expect(page.locator('.tree-table')).toHaveCount(2);
  await page.locator('.tree-schema').click({button:'right'});
  await page.getByRole('menuitem',{name:'ERD 열기',exact:true}).click();
  await expect(page.locator('.erd-table-node')).toHaveCount(2);
  const dialog=page.getByRole('dialog');
  await page.locator('.erd-toolbar').getByRole('button',{name:'테이블 추가',exact:true}).click();
  await dialog.getByLabel('이름',{exact:true}).fill('tags');
  await dialog.getByRole('button',{name:'변경 대기열에 추가',exact:true}).click();
  const orders=page.locator('.erd-table-node').filter({has:page.locator('header strong',{hasText:'orders'})});
  const users=page.locator('.erd-table-node').filter({has:page.locator('header strong',{hasText:'users'})});
  await orders.locator('header').click({button:'right'});await page.getByRole('menuitem',{name:'컬럼 추가',exact:true}).click();
  await dialog.getByLabel('컬럼 이름 1',{exact:true}).fill('note');await dialog.getByRole('button',{name:'변경 대기열에 추가',exact:true}).click();
  await orders.locator('[data-column="user_id"]').click({button:'right'});await page.getByRole('menuitem',{name:'인덱스 추가',exact:true}).click();
  await dialog.getByLabel('이름',{exact:true}).fill('orders_user_idx');await dialog.getByRole('button',{name:'변경 대기열에 추가',exact:true}).click();
  await page.locator('.erd-toolbar').getByRole('button',{name:'전체 보기',exact:true}).click();await orders.hover();
  const from=await orders.locator('[data-handleid="out:user_id"]').boundingBox(),to=await users.locator('[data-handleid="in:id"]').boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:15});await page.mouse.up();
  await expect(dialog).toBeVisible();await dialog.getByLabel('이름',{exact:true}).fill('orders_user_fk');await dialog.getByRole('button',{name:'변경 대기열에 추가',exact:true}).click();
  const query=sql=>page.evaluate(({id,sql})=>window.__TAURI_INTERNALS__.invoke('run_query',{id,sql}),{id,sql});
  expect((await query("SELECT name FROM sqlite_master WHERE name='tags'")).rows).toHaveLength(0);
  await page.locator('.erd-toolbar').getByRole('button',{name:'커밋 (4)',exact:true}).click();
  await expect(dialog.locator('pre')).toContainText('CREATE');
  await dialog.getByRole('button',{name:'DB에 적용',exact:true}).click();
  await expect(page.locator('.erd-toolbar').getByRole('button',{name:'커밋',exact:true})).toBeDisabled({timeout:20000});
  expect((await query('SELECT * FROM orders')).rows).toHaveLength(1);
  expect((await query("SELECT name FROM sqlite_master WHERE name IN ('tags','orders_user_idx')")).rows).toHaveLength(2);
  expect((await query("PRAGMA table_info('orders')")).rows.some(r=>r.name==='note')).toBe(true);
  expect((await query("PRAGMA foreign_key_list('orders')")).rows).toHaveLength(1);
  await expect(query('INSERT INTO orders (id,user_id) VALUES (2,999)')).rejects.toBeDefined();
  expect(errors).toEqual([]);mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/erd-native.png'});
  console.log(JSON.stringify({status:'passed',databasePath,checks:['staging without writes','table','column','index','dragged FK','existing rows preserved','FK enforcement'],errors}));
} finally {
  await browser?.close();
  if(child.pid) {
    try { execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}); } catch { /* Already closed. */ }
  }
}
