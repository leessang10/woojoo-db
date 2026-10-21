import {test,expect} from './fixtures';

test('failed queries retain explicitly stale results after dismissing the error and recover on success',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'새 쿼리',exact:true}).click();
 const editor=page.locator('.cm-content');
 await editor.fill('SELECT * FROM users LIMIT 2;');
 await page.locator('.run-button').click();
 await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
 await editor.fill('BROKEN;');
 await page.locator('.run-button').click();
 await expect(page.locator('.result-meta')).toContainText('작업 실패');
 await expect(page.locator('.result-meta')).toContainText('이전 성공 결과');
 await page.getByRole('button',{name:'오류 닫기'}).click();
 await expect(page.locator('.error-banner')).toHaveCount(0);
 await expect(page.locator('.stale-result-label')).toBeVisible();
 await page.getByRole('button',{name:'새 쿼리',exact:true}).click();
 await expect(page.locator('.stale-result-label')).toHaveCount(0);
 await page.getByRole('tab',{name:'쿼리 1',exact:true}).click();
 await expect(page.locator('.stale-result-label')).toBeVisible();
 await editor.fill('SELECT * FROM users LIMIT 1;');
 await page.locator('.run-button').click();
 await expect(page.locator('.data-grid tbody tr')).toHaveCount(1);
 await expect(page.locator('.stale-result-label')).toHaveCount(0);
 await page.getByRole('button',{name:'SQL 기록',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'SQL 기록'})).toContainText('DB 처리 12 ms');
});

test('data tools reclaim editor space and keep the filter controls together',async({page})=>{
 await page.setViewportSize({width:1280,height:720});
 await page.goto('/');
 await page.getByRole('button',{name:'데이터 도구',exact:true}).click();
 await expect(page.locator('#sql-editor')).toBeHidden();
 await expect(page.getByLabel('필터 값')).toBeVisible();
 const boxes=await Promise.all(['필터 열','필터 연산자','필터 값'].map(label=>page.getByLabel(label,{exact:true}).boundingBox()));
 expect(Math.max(...boxes.map(b=>b!.y))-Math.min(...boxes.map(b=>b!.y))).toBeLessThan(4);
 expect((await page.locator('.dw-grid').boundingBox())!.height).toBeGreaterThan(240);
 await page.getByRole('button',{name:'SQL 펼치기',exact:true}).click();
 await expect(page.locator('.cm-content')).toBeVisible();
 await page.getByRole('button',{name:'SQL 접기',exact:true}).click();
 await expect(page.locator('#sql-editor')).toBeHidden();
 await page.getByRole('button',{name:'간단한 보기',exact:true}).click();
 await page.getByRole('button',{name:'SQL 펼치기',exact:true}).click();
 await expect(page.locator('.cm-content')).toContainText('SELECT');
});

test('connection actions remain visible at the minimum window size',async({page})=>{
 await page.setViewportSize({width:960,height:640});
 await page.goto('/');
 await page.getByLabel('새 연결',{exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'새 연결'});
 const connect=dialog.getByRole('button',{name:'연결하기',exact:true});
 await expect(connect).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'연결 테스트',exact:true})).toBeDisabled();
 const button=await connect.boundingBox();
 expect(button!.y+button!.height).toBeLessThan(640);
 await dialog.getByLabel('호스트',{exact:true}).fill('example.invalid');
 expect((await connect.boundingBox())!.y).toBe(button!.y);
});

