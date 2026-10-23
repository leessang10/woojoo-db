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
  await expect(page.locator('.workspace-empty')).toBeVisible();
  const database = page.locator('.rail').getByRole('button',{name:'탐색기',exact:true});
  const archive = page.locator('.rail').getByRole('button',{name:'쿼리 기록',exact:true});
  await archive.click();
  await expect(page.getByRole('region',{name:'쿼리 기록',exact:true})).toBeVisible();
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
  // Exercise tab navigation and pointer reordering in the packaged WebView.
  await page.getByRole('button',{name:'새 연결',exact:true}).first().click();
  await page.getByRole('button',{name:'SQLite',exact:true}).click();
  await page.getByLabel('연결 이름',{exact:true}).fill('Tab smoke');
  await page.getByRole('textbox',{name:'데이터베이스',exact:true}).fill(path.join(profile,'tabs.sqlite3'));
  await page.getByRole('button',{name:'연결하기',exact:true}).click();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','true');
  await page.locator('.cm-content').fill('CREATE TABLE tab_smoke (id INTEGER PRIMARY KEY);');
  await page.locator('.run-button').click();
  await expect(page.locator('.run-button')).toBeEnabled();
  await page.getByTitle('목록 새로고침',{exact:true}).click();
  await expect(page.locator('.tree-table')).toHaveCount(1);
  for(let i=0;i<2;i++) {
    await archive.click();
    await database.click();
    await page.locator('.tree-table').click();
    await expect(page.getByRole('region',{name:'쿼리 기록',exact:true})).toHaveCount(0);
    await expect(page.locator('.object-view-bar')).toBeVisible();
  }
  await page.locator('.tab-add').click();
  const last=page.getByRole('tab').last();
  await last.dblclick();
  await page.getByRole('textbox',{name:'탭 이름',exact:true}).fill('Renamed');
  await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();
  const origin=await page.getByRole('tab',{name:'Renamed',exact:true}).boundingBox();
  const destination=await page.getByRole('tab').first().boundingBox();
  await page.mouse.move(origin.x+origin.width/2,origin.y+origin.height/2);
  await page.mouse.down();
  await page.mouse.move(destination.x+3,destination.y+destination.height/2,{steps:12});
  await page.mouse.up();
  await expect(page.getByRole('tab').first()).toHaveText('Renamed');
  await page.screenshot({path:'test-results/tabs-native.png'});
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('woojoo-workspace-v1')??'{}').tabs?.some(tab=>tab.customName==='Renamed'))).toBe(true);
  while(await page.locator('.tab-close').count()) {
    await page.locator('.tab-close').last().click();
    if(await page.getByRole('alertdialog').count()) await page.getByRole('alertdialog').getByRole('button',{name:'확인',exact:true}).click();
  }
  await expect(page.getByRole('heading',{name:'열린 탭이 없습니다',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('woojoo-workspace-v1')??'{}').tabs?.filter(tab=>tab.profileId!=='demo').length)).toBe(0);
  await page.reload();
  await expect(page.locator('.workspace-brand')).toHaveText('Woojoo');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.evaluate(()=>{
    localStorage.setItem('woojoo-profiles-v1',JSON.stringify(Array.from({length:16},(_,i)=>({id:'preview-'+i,name:'Database '+String(i+1).padStart(2,'0'),engine:'sqlite',host:'',port:0,database:'preview-'+i+'.sqlite3',username:'',tls:false,group:i%2?'Personal':'Work',environment:i%2?'development':'production'}))));
    localStorage.setItem('woojoo-active-profile','preview-0');
  });
  await page.reload();
  await expect(page.locator('.connection')).toHaveCount(1);
  const treeHeight=(await page.locator('.tree').boundingBox()).height;
  await page.getByRole('button',{name:'연결 전환',exact:true}).click();
  await expect(page.locator('[data-connection-option]')).toHaveCount(16);
  await page.screenshot({path:'test-results/connection-switcher-native.png'});
  await page.getByRole('textbox',{name:'연결 검색'}).fill('Database 16');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.connection-name')).toContainText('Database 16');
  expect((await page.locator('.tree').boundingBox()).height).toBe(treeHeight);
  expect(errors).toEqual([]);
  expect(await listening(1420)).toBe(false);
  console.log(JSON.stringify({executable,url:page.url(),developmentServer:false,isolatedProfile:profile,status:'passed'}));
} finally {
  await browser?.close();
  if(child.pid) {
    try { execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}); } catch { /* Already closed. */ }
  }
}
