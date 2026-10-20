import { chooseOption } from './select-control';
import {test,expect} from './fixtures';

test('profiles retain SQLite environment settings but never credentials, and can be edited/deleted',async({page})=>{
  await page.goto('/');
  await page.getByLabel('새 연결',{exact:true}).click();
  await page.getByRole('button',{name:'SQLite',exact:true}).click();
  await page.getByLabel('연결 이름',{exact:true}).fill('Local inventory');
  await page.getByRole('textbox',{name:'데이터베이스',exact:true}).fill('C:\\data\\inventory.sqlite');
  await page.getByLabel('그룹',{exact:true}).fill('Personal');
  await chooseOption(page.getByLabel('환경',{exact:true}), 'staging');
  await page.getByLabel('읽기 전용 연결').check();
  await page.getByRole('button',{name:'프로필 저장'}).click();
  await expect(page.getByRole('button',{name:'다시 연결',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.locator('.connection-name').filter({hasText:'Local inventory'})).toContainText('Personal · staging · RO');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('woojoo-profiles-v1')!));
  expect(stored[0]).toMatchObject({password:'',readOnly:true,engine:'sqlite',group:'Personal'});
  await page.locator('.connection').filter({hasText:'Local inventory'}).click({button:'right'});
  await page.getByRole('menuitem',{name:'프로필 수정 / 다시 연결'}).click();
  await page.getByLabel('연결 이름',{exact:true}).fill('Inventory renamed');
  await page.getByRole('button',{name:'프로필 저장'}).click();
  await expect(page.locator('.connection-name').filter({hasText:'Inventory renamed'})).toBeVisible();
  await page.locator('.connection').filter({hasText:'Inventory renamed'}).click({button:'right'});
  await page.getByRole('menuitem',{name:'프로필 삭제'}).click();
await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.locator('.connection')).toHaveCount(1);
});

test('workspace restores SQL and active tab without restoring result data',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'새 쿼리',exact:true}).click();
  await page.locator('.cm-content').fill('SELECT * FROM users LIMIT 3;');
  await page.locator('.run-button').click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(3);
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('woojoo-workspace-v1'))).toContain('LIMIT 3');
  await page.reload();
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM users LIMIT 3;');
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(0);
  await page.getByRole('tab',{name:'users',exact:true}).click();
  await expect(page.getByRole('cell',{name:'Alex Morgan',exact:true})).toBeVisible();
});

test('simple SELECT results edit the original row and retain their query',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.run-button')).toBeEnabled();
  await page.locator('.cm-content').fill('SELECT * FROM public.users LIMIT 2;');
  await page.locator('.run-button').click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
  await page.getByRole('cell',{name:'Alex Morgan',exact:true}).dblclick();
  await page.getByLabel('셀 값').fill('Edited from SQL');
  await page.getByRole('button',{name:'변경 대기열에 추가'}).click();
  await page.getByRole('button',{name:/변경 검토/}).click();
  await page.getByRole('button',{name:'1개 행 적용'}).click();
  await expect(page.getByRole('cell',{name:'Edited from SQL',exact:true})).toBeVisible();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
});
