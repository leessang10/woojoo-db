import { test, expect } from './fixtures';

test('many saved connections do not reduce table tree space and can be searched and switched', async ({ browser }) => {
  const heights=[];
  for (const count of [1,16]) {
    const page=await browser.newPage({viewport:{width:960,height:700}});
    await page.addInitScript(count=>{
      if(localStorage.getItem('woojoo-profiles-v1'))return;
      localStorage.setItem('woojoo-profiles-v1',JSON.stringify(Array.from({length:count},(_,i)=>({id:'db-'+i,name:'Database '+String(i+1).padStart(2,'0'),engine:'sqlite',host:'',port:0,database:'database-'+i+'.sqlite3',username:'',tls:false,group:i%2?'Personal':'Work',environment:i%2?'development':'production'}))));
      localStorage.setItem('woojoo-active-profile','db-0');
    },count);
    await page.goto('/');
    await expect(page.locator('.connection')).toHaveCount(1);
    heights.push((await page.locator('.tree').boundingBox())!.height);
    await page.getByRole('button',{name:'연결 전환',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'연결 검색'})).toBeFocused();
    await expect(page.locator('[data-connection-option]')).toHaveCount(count);
    const before=await page.locator('.tree').boundingBox();
    expect(before!.height).toBe(heights.at(-1));
    if(count===16){
      expect(await page.locator('.connection-picker-list').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
      await page.getByRole('textbox',{name:'연결 검색'}).fill('Database 16');
      await expect(page.locator('[data-connection-option]')).toHaveCount(1);
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('[data-connection-option]')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('.connection-name')).toContainText('Database 16');
      await expect(page.locator('.connection-picker')).not.toBeVisible();
      await expect(page.getByRole('button',{name:'연결 전환',exact:true})).toBeFocused();
      expect((await page.locator('.tree').boundingBox())!.height).toBe(heights[0]);
      await page.reload();
      await expect(page.locator('.connection-name')).toContainText('Database 16');
      await page.getByRole('button',{name:'연결 전환',exact:true}).click();
      await page.getByRole('textbox',{name:'연결 검색'}).fill('no-such-profile');
      await expect(page.getByText('일치하는 연결이 없습니다.')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.connection-picker')).not.toBeVisible();
    }
    await page.close();
  }
  expect(heights[0]).toBe(heights[1]);
});

test('switching connections still protects pending data changes',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('woojoo-profiles-v1',JSON.stringify([{id:'other',name:'Other database',engine:'sqlite',host:'',port:0,database:'other.db',username:'',tls:false}])));
  await page.goto('/');
  await page.getByRole('button',{name:'연결 전환',exact:true}).click();
  await page.locator('[data-connection-option]').filter({hasText:'Woojoo playground'}).click();
  await expect(page.getByText('Alex Morgan',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'데이터 도구',exact:true}).click();
  await page.getByLabel('1 name',{exact:true}).fill('Keep edited name');
  await page.getByRole('button',{name:'연결 전환',exact:true}).click();
  await page.locator('[data-connection-option]').filter({hasText:'Other database'}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'취소',exact:true}).click();
  await expect(page.locator('.connection-name')).toContainText('Woojoo playground');
  await expect(page.getByLabel('1 name',{exact:true})).toHaveValue('Keep edited name');
});
