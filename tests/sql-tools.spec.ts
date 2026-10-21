import { chooseOption } from './select-control';
import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 쿼리', exact: true }).click();
});

test('SQL file upload retains its name and browser download contains the editor text', async ({ page }) => {
  const sql = 'SELECT * FROM users LIMIT 2;';
  await page.locator('.query-tools input[type=file]').setInputFiles({ name: 'example.sql', mimeType: 'text/plain', buffer: Buffer.from(sql) });
  await expect(page.locator('.cm-content')).toHaveText(sql);
  await expect(page.locator('.query-tools')).toContainText('example.sql');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.query-tools').getByRole('button', { name: '다운로드', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('example.sql');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe(sql);
  await expect(page.locator('.query-tools')).toContainText('다운로드를 요청');
});

test('script keeps individual results and stops after an error', async ({ page }) => {
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 2; SELECT * FROM users LIMIT 1;');
  await page.locator('.query-tools').getByRole('button', { name: '스크립트 실행', exact: true }).click();
  await expect(page.locator('.script-result-tabs button')).toHaveCount(2);
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(1);
  await page.locator('.script-result-tabs button').first().click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 3; BROKEN; SELECT * FROM users LIMIT 1;');
  await page.locator('.query-tools').getByRole('button', { name: '스크립트 실행', exact: true }).click();
  await expect(page.locator('.script-result-tabs button').last()).toContainText('Error');
  await expect(page.locator('.script-result-tabs button')).toHaveCount(2);
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(3);
});

test('typed parameters execute and searchable history survives reload without parameter values', async ({ page }) => {
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT :limit;');
  await page.locator('.query-tools').getByRole('button', { name: '스크립트 실행', exact: true }).click();
  const parameters = page.getByRole('dialog', { name: 'SQL 매개변수', exact: true });
  await expect(parameters).toBeVisible();
  await chooseOption(parameters.getByLabel('limit 타입'), 'number');
  await parameters.getByLabel('limit 값').fill('2');
  await parameters.getByRole('button', { name: '실행', exact: true }).click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.query-tools')).toBeVisible();
  await page.locator('.query-tools').getByRole('button', { name: 'SQL 기록', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'SQL 기록', exact: true });
  await history.getByLabel('기록 검색').fill(':limit');
  await expect(history.locator('pre')).toHaveText('SELECT * FROM users LIMIT :limit;');
  await history.getByLabel('기록 검색').fill('does-not-exist');
  await expect(history.locator('pre')).toHaveCount(0);
});
test('MySQL routine definitions use the explicit server script path after confirmation',async({page})=>{
 await page.addInitScript(()=>{(window as any).objectSql=[];Object.defineProperty(window,'isTauri',{value:true});Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async(command:string,args:any)=>{if(command==='connect_db')return 'mysql-objects';if(command==='list_tables')return [];if(command==='run_object_sql'){(window as any).objectSql.push(args.sql);return {columns:[],rows:[],affected:0,elapsedMs:1,truncated:false};}throw new Error(command);}}});});
 await page.goto('/');await page.getByLabel('새 연결',{exact:true}).click();await page.getByRole('button',{name:'MySQL',exact:true}).click();await page.getByRole('button',{name:'연결하기',exact:true}).click();await expect(page.locator('.connection-name').filter({hasText:'Local MySQL'})).toBeVisible();await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','true');const sql='CREATE PROCEDURE example() BEGIN SELECT 1; SELECT 2; END;';await page.locator('.cm-content').fill(sql);await page.locator('.run-button').click();
await page.getByRole('alertdialog').getByRole('button', { name: '취소', exact: true }).click();expect(await page.evaluate(()=>(window as any).objectSql)).toEqual([]);await page.locator('.run-button').click();
await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click();await expect.poll(()=>page.evaluate(()=>(window as any).objectSql)).toEqual([sql]);
});
