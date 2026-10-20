import { test, expect } from '@playwright/test';

test('empty workspace creates and connects local SQLite, saves the profile and restores it',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(window,'isTauri',{value:true});
    (window as any).created=0;
    Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{transformCallback:()=>1,invoke:async(command:string,args:any)=>{
      if(command.startsWith('plugin:event|'))return 1;
      if(command==='create_local_database'){(window as any).created++;return 'C:/AppData/databases/local.sqlite3';}
      if(command==='connect_db'){(window as any).connectedProfile=args.profile;return 'local-session';}
      if(command==='list_tables')return [{schema:'main',name:'board'},{schema:'main',name:'user'}];
      if(command==='describe_table')return [{name:'id',dataType:'INTEGER',primary:true,editable:false}];
      if(command==='read_table')return {columns:[{name:'id',dataType:'INTEGER',primary:true,editable:false}],rows:[],elapsedMs:0,affected:0,truncated:false};
      throw Error(command);
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'로컬 SQLite 만들기',exact:true}).click();
  await expect(page.locator('.connection-name')).toContainText('Local SQLite');
  await expect(page.locator('.tree-table')).toHaveCount(2);
  expect(await page.evaluate(()=>(window as any).created)).toBe(1);
  expect(await page.evaluate(()=>(window as any).connectedProfile)).toMatchObject({engine:'sqlite',database:'C:/AppData/databases/local.sqlite3',readOnly:false});
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('woojoo-profiles-v1')??'[]'))).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.connection-name')).toContainText('Local SQLite');
  await expect(page.getByRole('button',{name:'다시 연결',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'로컬 SQLite 만들기',exact:true})).toHaveCount(0);
});

test('creation errors stay visible and retry is possible',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(window,'isTauri',{value:true});
    (window as any).attempts=0;
    Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{transformCallback:()=>1,invoke:async(command:string)=>{
      if(command.startsWith('plugin:event|'))return 1;
      if(command==='create_local_database'){(window as any).attempts++;throw Error('Storage unavailable');}
      throw Error(command);
    }}});
  });
  await page.goto('/');
  const button=page.getByRole('button',{name:'로컬 SQLite 만들기',exact:true});
  await button.click();
  await expect(page.getByRole('alert')).toContainText('Storage unavailable');
  await expect(button).toBeEnabled();
  await button.click();
  await expect.poll(()=>page.evaluate(()=>(window as any).attempts)).toBe(2);
  await expect(page.locator('.connection')).toHaveCount(0);
});
