import { chooseOption } from './select-control';
import { test, expect } from '@playwright/test';

test('history panel and tab filter, page, read full SQL, pages, reads full SQL and reopens in the original profile', async ({page})=>{
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
  await page.locator('.topbar').getByRole('button',{name:'쿼리 기록',exact:true}).click();
  const history=page.getByRole('region',{name:'쿼리 기록',exact:true});
  await expect(history.locator('.history-entry')).toHaveCount(50);
  await history.getByRole('button',{name:/더 보기/}).click();
  await expect(history.locator('.history-entry')).toHaveCount(53);
  await history.getByRole('button',{name:'전체 기록 보기',exact:true}).click();
  const all=page.getByRole('region',{name:'전체 쿼리 기록',exact:true});
  await expect(page.getByRole('tab',{name:'쿼리 기록',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(all.locator('.history-entry')).toHaveCount(50);
  const originalOrder=await all.locator('.history-entry').allTextContents();
  await all.getByRole('button',{name:'상세 보기'}).nth(1).click();
  const durationHeader=all.getByRole('columnheader',{name:'소요 시간'});
  await durationHeader.click(); await durationHeader.click();
  await expect(durationHeader).toHaveAttribute('aria-sort','descending');
  await expect(all.locator('.history-entry').first()).toContainText('SELECT 49;');
  expect(await all.locator('.history-detail-row').evaluate(row=>row.previousElementSibling?.getAttribute('data-status'))).toBe('failed');
  await durationHeader.click();
  expect(await all.locator('.history-entry').allTextContents()).toEqual(originalOrder);
  await all.locator('.history-entry[data-expanded="true"]').getByRole('button',{name:'상세 보기'}).click();
  await chooseOption(all.getByLabel('실행 상태',{exact:true}), 'failed');
  await expect(all.locator('.history-entry')).toHaveCount(1);
  await all.getByRole('button',{name:'상세 보기'}).click();
  await expect(all.locator('.history-detail-error')).toHaveText('syntax error');
  await chooseOption(all.getByLabel('실행 상태',{exact:true}), '');
  await all.getByLabel('SQL·오류 검색').fill('한글');
  await expect(all.locator('.history-entry')).toHaveCount(1);
  await expect(all.locator('.history-sql')).toContainText('한글');
  await all.getByRole('button',{name:'상세 보기'}).click();
  await expect(all.locator('.history-full-sql')).toHaveText("SELECT '"+'한글'.repeat(400)+"';");
  await history.getByLabel('SQL·오류 검색').fill('한글');
  await expect(history.locator('.history-entry')).toHaveCount(1);
  await page.screenshot({path:'test-results/executions-dark.png'});
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
  await page.screenshot({path:'test-results/executions-light.png'});
  await history.locator('.history-open').click();
  await expect(history).toBeVisible();
  await page.getByRole('button',{name:'다시 연결',exact:true}).click();
  await page.getByRole('button',{name:'연결하기',exact:true}).click();
  await expect(page.locator('.cm-content')).toHaveText("SELECT '"+'한글'.repeat(400)+"';");
  expect(await page.evaluate(()=>(window as any).journalCalls.some((c:any)=>c.command==='run_query'))).toBe(false);
  await page.reload();
  await expect(page.getByRole('region',{name:'쿼리 기록',exact:true}).locator('.history-entry')).toHaveCount(50);
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
  await page.locator('.topbar').getByRole('button',{name:'쿼리 기록',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Archive unavailable');
  await page.locator('.rail').getByRole('button',{name:'데이터베이스',exact:true}).click();
  await expect(page.locator('.workspace-empty')).toBeVisible();
});
