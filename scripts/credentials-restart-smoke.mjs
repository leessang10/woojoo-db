// Opt-in read-only verification against an authorized DB; uses an isolated
// WebView profile and removes only the credential created by this test.
// node scripts/credentials-restart-smoke.mjs <dotenv-path> [executable]
import { chromium, expect } from '@playwright/test';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

const [envPath, executable='src-tauri/target/release/woojoo-db.exe']=process.argv.slice(2);
if(!envPath)throw new Error('Supply the dotenv file path');
const line=readFileSync(envPath,'utf8').split(/\r?\n/).find(x=>/^\s*SQL_URL_MASTER\s*=/.test(x));
if(!line)throw new Error('SQL_URL_MASTER is missing');
let url;
try{url=new URL(line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,''));}
catch{throw new Error('Invalid database URL');}
const password=decodeURIComponent(url.password);
const folder=mkdtempSync(path.join(tmpdir(),'woojoo-credential-restart-'));
const server=net.createServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
await new Promise(resolve=>server.close(resolve));
let child,browser,page,profile;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){
  let launchError;
  child=spawn(path.resolve(executable),[],{windowsHide:true,stdio:'ignore',env:{...process.env,
    WEBVIEW2_USER_DATA_FOLDER:folder,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`,
  }});
  child.on('error',error=>{launchError=error;});
  for(let i=0;i<60;i++){
    if(launchError)throw launchError;
    if(child.exitCode!==null)throw new Error(`App exited with ${child.exitCode}`);
    try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break;}catch{}
    await wait(500);
  }
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context=browser.contexts()[0];
  page=context.pages()[0]??await context.waitForEvent('page');
  await expect(page.locator('.workspace-brand')).toHaveText('Woojoo',{timeout:20000});
  expect(new URL(page.url()).hostname).toBe('tauri.localhost');
}
async function stop(){
  if(browser){await browser.close();browser=undefined;}
  if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  child=undefined;
  await wait(1000);
}
async function status(){
  return page.evaluate(profile=>window.__TAURI_INTERNALS__.invoke('credential_status',{profile}),profile);
}
async function forget(){
  if(profile&&page&&!page.isClosed())await page.evaluate(profileId=>window.__TAURI_INTERNALS__.invoke('forget_password',{profileId}),profile.id);
}
try{
  await start();
  await page.getByRole('button',{name:'새 연결',exact:true}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'MariaDB',exact:true}).click();
  await dialog.getByLabel('연결 이름',{exact:true}).fill('Credential restart verification');
  await dialog.getByLabel('호스트',{exact:true}).fill(url.hostname);
  await dialog.getByLabel('포트',{exact:true}).fill(url.port||'3306');
  await dialog.getByRole('textbox',{name:'데이터베이스',exact:true}).fill(decodeURIComponent(url.pathname.slice(1)));
  await dialog.getByLabel('사용자',{exact:true}).fill(decodeURIComponent(url.username));
  await expect(dialog.getByRole('checkbox',{name:/TLS/})).toBeChecked();
  await dialog.getByRole('checkbox',{name:'읽기 전용 연결',exact:true}).check();
  await dialog.getByRole('checkbox',{name:'이 PC에 비밀번호 기억',exact:true}).check();
  await dialog.getByLabel('비밀번호',{exact:true}).fill(password);
  await dialog.getByRole('button',{name:'연결하기',exact:true}).click();
  await expect(dialog).not.toBeVisible({timeout:20000});
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('woojoo-profiles-v1')??'[]').length)).toBe(1);
  profile=await page.evaluate(()=>JSON.parse(localStorage.getItem('woojoo-profiles-v1'))[0]);
  expect(profile.password).toBe('');
  expect(profile.rememberPassword).toBe(true);
  expect(await status()).toMatchObject({supported:true,saved:true,available:true});
  const firstPid=child.pid;
  await stop();
  await start();
  expect(child.pid).not.toBe(firstPid);
  await expect(page.locator('.connection .live-dot')).not.toHaveClass(/offline/,{timeout:20000});
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await status()).toMatchObject({saved:true,available:true});
  const storage=await page.evaluate(()=>JSON.stringify({...localStorage}));
  expect(storage.includes(password)).toBe(false);
  if(!await page.locator('.cm-content').count())await page.getByRole('button',{name:'새 쿼리',exact:true}).first().click();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','true',{timeout:20000});
  await page.locator('.cm-content').fill('SELECT 1 AS credential_restart_ok');
  await page.getByRole('button',{name:'실행',exact:true}).click();
  await expect(page.getByRole('columnheader',{name:/credential_restart_ok/})).toBeVisible({timeout:15000});
  await expect(page.getByRole('cell',{name:'1',exact:true}).last()).toBeVisible();
  mkdirSync('test-results',{recursive:true});
  await page.screenshot({path:'test-results/credential-restart-verified.png'});
  console.log('New app process automatically reconnected with verified TLS and executed SELECT 1; no password in profile or localStorage.');
  // Delete through the user-facing action and prove a third process stays offline.
  await page.locator('.connection').click({button:'right'});
  await page.getByRole('menuitem',{name:'프로필 수정 / 다시 연결'}).click();
  await expect(page.getByRole('dialog').getByLabel('비밀번호',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'저장된 비밀번호 삭제',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('저장된 비밀번호를 삭제했습니다.');
  expect(await status()).toMatchObject({saved:false,available:false});
  await stop();
  await start();
  await expect(page.locator('.connection .live-dot')).toHaveClass(/offline/);
  await expect(page.getByRole('button',{name:'다시 연결',exact:true})).toBeVisible();
  expect(await status()).toMatchObject({saved:false,available:false});
  console.log('Deleting the saved password cleared the vault and disabled automatic connection on the next process start.');
}catch(error){
  let message=String(error);
  for(const secret of [password,url.password].filter(Boolean))message=message.replaceAll(secret,'[REDACTED]');
  console.error(message);process.exitCode=1;
}finally{
  try{await forget();}catch{console.error('Test credential cleanup failed; delete the test profile credential in Windows Credential Manager.');process.exitCode=1;}
  await stop();
}
