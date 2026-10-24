import {test, expect} from './fixtures';

for(const language of ['ko','en']) for(const theme of ['light','dark']) test('review matrix '+language+' '+theme,async({page},testInfo)=>{
 await page.setViewportSize({width:960,height:640});
 await page.addInitScript(({language,theme})=>{localStorage.setItem('woojoo-language',language);localStorage.setItem('woojoo-theme',theme);},{language,theme});
 const ko=language==='ko';
 await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
 await page.screenshot({animations:'disabled',path:testInfo.outputPath('database.png')});
 await page.getByRole('button',{name:'API',exact:true}).click();
 await page.locator('.workspace-empty').getByRole('button',{name:ko?'새 요청':'New request',exact:true}).click();
 await page.getByRole('tab',{name:ko?'인증':'Auth',exact:true}).click();
 await page.screenshot({animations:'disabled',path:testInfo.outputPath('api.png')});
 await page.getByRole('combobox',{name:ko?'HTTP 메서드':'HTTP method'}).click();
 await page.screenshot({animations:'disabled',path:testInfo.outputPath('api-select.png')});
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:/ · (탭 메뉴|Tab menu)$/}).click();
 await page.getByRole('menuitem',{name:ko?'이름 바꾸기':'Rename',exact:true}).click();
 await page.screenshot({animations:'disabled',path:testInfo.outputPath('rename.png')});
 await page.getByRole('dialog').getByRole('button',{name:ko?'취소':'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Docker',exact:true}).click();
 await page.getByRole('button',{name:ko?'데모 관계도 보기':'View demo topology'}).click();
 await expect(page.locator('.docker-node')).toHaveCount(9);
 await page.screenshot({animations:'disabled',path:testInfo.outputPath('docker.png')});
 await page.getByRole('button',{name:'Redis',exact:true}).click();
 await page.getByRole('button',{name:ko?'데모 살펴보기':'Explore demo'}).click();
 await page.getByTestId('redis-key-list').getByRole('button',{name:'user:1001',exact:true}).click();
 await page.getByRole('button',{name:ko?'상세 닫기':'Close detail',exact:true}).click();
 await page.getByTestId('redis-key-list').getByRole('button',{name:'user::empty',exact:true}).click();
 await expect(page.getByRole('button',{name:'TEXT',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.screenshot({animations:'disabled',path:testInfo.outputPath('redis.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('request views survive tab navigation and tab menus support rename and drag',async({page})=>{
 await page.goto('/'); await page.getByRole('button',{name:'API',exact:true}).click();
 await page.locator('.workspace-empty').getByRole('button',{name:'새 요청',exact:true}).click();
 await page.getByRole('tab',{name:'인증',exact:true}).click();
 const first=await page.locator('[data-managed-tab]').getAttribute('data-managed-tab');
 await page.locator('.api-new-tab').click();
 await page.locator('[data-managed-tab]').first().getByRole('tab').click();
 await expect(page.getByRole('tab',{name:'인증',exact:true})).toHaveAttribute('aria-selected','true');
 await page.locator('[data-managed-tab]').first().getByRole('button',{name:/탭 메뉴/}).click();
 await page.getByRole('menuitem',{name:'이름 바꾸기',exact:true}).click();
 await page.getByRole('dialog').getByLabel('이름',{exact:true}).fill('Auth request');
 await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();
 await expect(page.getByRole('tab',{name:'GET Auth request',exact:true})).toBeVisible();
 await page.locator('[data-managed-tab]').last().dragTo(page.locator('[data-managed-tab]').first(),{targetPosition:{x:2,y:15}});
 await expect(page.locator('[data-managed-tab]').last()).toHaveAttribute('data-managed-tab',first!);
 const split=page.getByRole('separator',{name:'요청과 응답 크기 조절'});
 await split.press('End'); await expect(split).toHaveAttribute('aria-valuenow','85');
 await split.press('Home'); await expect(split).toHaveAttribute('aria-valuenow','15');
});

test('failed retry retains previous response and save errors remain dismissible',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(window,'isTauri',{value:true});
  let sent=0;
  (window as any).__TAURI_INTERNALS__={transformCallback:()=>1,unregisterCallback:()=>{},invoke:async(command:string)=>{
   if(command==='http_workspace')return {collections:[],requests:[],environments:[],activeEnvironment:null};
   if(command==='http_send'){if(sent++)throw 'RETRY_FAILED';return {status:200,statusText:'OK',headers:[],body:'previous-response',url:'https://example.invalid',size:17,durationMs:1,version:'HTTP/1.1',base64:false,truncated:false};}
   if(command==='http_save_request')throw 'SAVE_FAILED';
   return [];
  }};
 });
 await page.goto('/');await page.getByRole('button',{name:'API',exact:true}).click();
 await page.locator('.workspace-empty').getByRole('button',{name:'새 요청',exact:true}).click();
 await page.getByLabel('URL',{exact:true}).fill('https://example.invalid');
 await page.getByRole('button',{name:'보내기',exact:true}).click();
 await expect(page.locator('.api-response')).toContainText('previous-response');
 await page.getByRole('button',{name:'보내기',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('RETRY_FAILED');
 await expect(page.locator('.api-response')).toContainText('이전 성공 응답');
 await expect(page.locator('.api-response')).toContainText('previous-response');
 await page.getByRole('button',{name:/^저장/}).click();
 await page.getByRole('dialog').getByLabel('이름',{exact:true}).fill('Test');
 await page.getByRole('dialog').getByRole('button',{name:'확인',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'SAVE_FAILED'})).toBeVisible();
 await page.waitForTimeout(2800);
 await expect(page.getByRole('alert').filter({hasText:'SAVE_FAILED'})).toBeVisible();
 await page.getByRole('button',{name:'오류 닫기',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'SAVE_FAILED'})).toHaveCount(0);
});

test('saved request actions are reachable by click and copy reports failure',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'API',exact:true}).click();
 await page.locator('.workspace-empty').getByRole('button',{name:'새 요청',exact:true}).click();
 await page.getByLabel('URL',{exact:true}).fill('https://example.invalid');
 await page.getByRole('button',{name:/^저장/}).click();
 await page.getByRole('dialog').getByLabel('이름',{exact:true}).fill('Saved request');
 await page.getByRole('dialog').getByRole('button',{name:'확인',exact:true}).click();
 await page.getByRole('button',{name:'Saved request · 메뉴',exact:true}).click();
 await expect(page.getByRole('menuitem',{name:'이름 바꾸기',exact:true})).toBeVisible();
 await expect(page.getByRole('menuitem',{name:'삭제',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('denied'))},configurable:true}));
 await page.getByRole('button',{name:'cURL',exact:true}).click();
 await expect(page.locator('.api-copy-notice')).toContainText('복사하지 못했습니다');
});

for(const language of ['ko','en']) for(const theme of ['light','dark']) test('DB deletion layout '+language+' '+theme,async({page},testInfo)=>{
 await page.setViewportSize({width:960,height:640});const ko=language==='ko';
 await page.addInitScript(({language,theme})=>{localStorage.setItem('woojoo-language',language);localStorage.setItem('woojoo-theme',theme);},{language,theme});
 await page.goto('/');
 await page.locator('.object-view-bar').getByRole('button',{name:ko?'구조':'Structure',exact:true}).click();
 await page.getByRole('button',{name:ko?'테이블 삭제':'Drop table',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:ko?'SQL 검토':'Review SQL',exact:true}).click();
 const remove=dialog.getByRole('button',{name:ko?'테이블 삭제':'Drop table',exact:true});
 await expect(remove).toHaveAttribute('data-variant','destructive');
 await expect(remove).toBeDisabled();
 await page.screenshot({path:testInfo.outputPath('db-delete.png'),animations:'disabled'});
 const box=await remove.boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(640);
});
test('Redis switching from JSON to text selects the actual format',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Redis',exact:true}).click();
 await page.getByRole('button',{name:'데모 살펴보기'}).click();
 const list=page.getByTestId('redis-key-list');
 await list.getByRole('button',{name:'user:1001',exact:true}).click();
 await expect(page.getByRole('button',{name:'JSON',exact:true})).toHaveAttribute('aria-pressed','true');
 await list.getByRole('button',{name:'user::empty',exact:true}).click();
 await expect(page.getByRole('button',{name:'TEXT',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'JSON',exact:true})).toHaveAttribute('aria-pressed','false');
});
