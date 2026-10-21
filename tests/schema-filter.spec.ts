import {test,expect} from './fixtures';

test('blank MySQL database connects and schema choices include empty schemas and persist',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(window,'isTauri',{value:true});
  Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async(command:string,args:any)=>{
   if(command==='credential_status')return {supported:true,saved:false,available:false};
   if(command==='connect_db'){(window as any).connectedProfile=args.profile;return 'multi';}
   if(command==='list_schemas')return ['app','analytics','empty'];
   if(command==='list_tables')return [{schema:'app',name:'users'},{schema:'analytics',name:'events'}];
   if(command==='read_table')return {columns:[],rows:[],elapsed_ms:0};
   if(command==='disconnect_db')return;
   throw new Error(command);
  }}});
 });
 await page.goto('/');await page.getByLabel('새 연결',{exact:true}).click();
 await page.getByRole('button',{name:'MySQL',exact:true}).click();
 await page.getByRole('textbox',{name:'데이터베이스',exact:true}).fill('');
 await page.getByRole('button',{name:'연결하기',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).connectedProfile.database)).toBe('');
 await expect(page.locator('.tree-schema')).toHaveText(['analytics','app','empty']);
 await page.getByRole('button',{name:'스키마 선택',exact:true}).click();
 await page.getByRole('checkbox',{name:/analytics/}).uncheck();
 await page.getByRole('dialog').getByRole('button',{name:'확인',exact:true}).click();
 await expect(page.locator('.tree-schema')).toHaveText(['app','empty']);
 await expect(page.locator('.tree-table')).toHaveText(['users']);
 await page.getByRole('button',{name:'스키마 선택',exact:true}).click();
 await page.getByRole('button',{name:'전체 해제',exact:true}).click();
 await expect(page.locator('.tree-schema')).toHaveCount(0);
 await page.getByRole('button',{name:'전체 선택',exact:true}).click();
 await expect(page.locator('.tree-schema')).toHaveCount(3);
 await page.getByRole('checkbox',{name:/analytics/}).uncheck();
 await expect.poll(()=>page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('woojoo-schema-filters-v1')??'{}')))).toEqual([['app','empty']]);
 await page.getByRole('button',{name:'새로고침',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('checkbox',{name:/analytics/})).not.toBeChecked();
 await page.screenshot({path:'test-results/schema-filter.png'});
});

test('SQLite still requires a file path',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'isTauri',{value:true});Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async()=>{throw new Error('Unexpected invocation');}}});});
 await page.goto('/');await page.getByLabel('새 연결',{exact:true}).click();await page.getByRole('button',{name:'SQLite',exact:true}).click();
 await page.getByRole('button',{name:'연결하기',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('입력하세요');
 await expect(page.getByRole('dialog')).toBeVisible();
});
