import { test, expect } from '@playwright/test';

test('execution page filters, paginates, reads full SQL and reopens in the original profile', async ({page})=>{
  await page.addInitScript(()=>{
    const profile={id:'archive-profile',name:'Archive SQLite',engine:'sqlite',host:'',port:0,database:'archive.db',username:'',tls:false};
    localStorage.setItem('woojoo-profiles-v1',JSON.stringify([profile]));
    const longSQL="SELECT '"+'한글'.repeat(400)+"';";
    const rows=Array.from({length:53},(_,i)=>({
      id:String(i),sql:i===0?longSQL:`SELECT ${i};`,profileId:profile.id,connectionName:profile.name,
      engine:'sqlite',database:profile.database,kind:'sql',status:i===1?'failed':'success',
      startedAt:Date.now()-i*1000,durationMs:i,error:i===1?'syntax error':null,
    }));
    Object.defineProperty(window,'isTauri',{value:true});
    (window as any).journalCalls=[];
    Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{
      transformCallback:()=>1,
      invoke:async(command:string,args:any)=>{
        (window as any).journalCalls.push({command,args});
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='execution_connections')return [{profileId:profile.id,connectionName:profile.name,engine:'sqlite',database:profile.database}];
        if(command==='execution_detail')return rows.find(row=>row.id===args.id);
        if(command==='execution_list'){
          const f=args.filter;
          const entries=rows.filter(r=>(!f.status||r.status===f.status)&&(!f.search||r.sql.includes(f.search)||(r.error??'').includes(f.search))&&(!f.profileId||r.profileId===f.profileId)&&(!f.since||r.startedAt>=f.since)&&(!f.until||r.startedAt<f.until));
          return {total:entries.length,entries:entries.slice(f.offset,f.offset+50).map(r=>({...r,sql:r.sql.slice(0,500)}))};
        }
        if(command==='connect_db')return 'archive-session';
        if(command==='list_tables')return [];
        throw new Error(command);
      },
    }});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'실행한 쿼리',exact:true}).click();
  const pageRegion=page.getByRole('region',{name:'실행한 쿼리',exact:true});
  await expect(pageRegion.locator('tbody tr')).toHaveCount(50);
  expect((await page.getByLabel('시작일',{exact:true}).boundingBox())!.width).toBeLessThanOrEqual(150);
  expect((await page.getByLabel('종료일',{exact:true}).boundingBox())!.width).toBeLessThanOrEqual(150);
  await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
  await expect(pageRegion.locator('tbody tr')).toHaveCount(3);
  await page.getByLabel('실행 상태',{exact:true}).selectOption('failed');
  await expect(pageRegion.locator('tbody tr')).toHaveCount(1);
  await pageRegion.locator('tbody button').click();
  await expect(page.locator('.execution-error')).toHaveText('syntax error');
  await page.getByLabel('실행 상태',{exact:true}).selectOption('');
  await page.getByLabel('SQL·오류 검색').fill('한글');
  await expect(pageRegion.locator('tbody tr')).toHaveCount(1);
  await pageRegion.locator('tbody button').click();
  await expect(page.locator('.execution-sql')).toHaveText("SELECT '"+'한글'.repeat(400)+"';");
  await page.screenshot({path:'test-results/executions-dark.png'});
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
  await expect(page.locator('.connection')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.screenshot({path:'test-results/executions-light.png'});
  await page.getByRole('button',{name:'편집기에서 열기'}).click();
  await expect(pageRegion).not.toBeVisible();
  await page.getByRole('button',{name:'다시 연결',exact:true}).click();
  await page.getByRole('button',{name:'연결하기',exact:true}).click();
  await expect(page.locator('.cm-content')).toHaveText("SELECT '"+'한글'.repeat(400)+"';");
  expect(await page.evaluate(()=>(window as any).journalCalls.some((c:any)=>c.command==='run_query'))).toBe(false);
  await page.reload();
  await page.getByRole('button',{name:'실행한 쿼리',exact:true}).click();
  await expect(pageRegion.locator('tbody tr')).toHaveCount(50);
});

test('archive remains accessible without connections and shows storage errors',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(window,'isTauri',{value:true});
    Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{transformCallback:()=>1,invoke:async(command:string)=>{
      if(command.startsWith('plugin:event|'))return 1;
      if(command==='execution_connections')return [];
      if(command==='execution_list')throw new Error('Archive unavailable');
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'실행한 쿼리',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Archive unavailable');
  await page.getByRole('button',{name:'작업 공간으로 돌아가기'}).click();
  await expect(page.locator('.workspace-empty')).toBeVisible();
});
