import {test,expect} from './fixtures';
for(const language of ['ko','en']) for(const theme of ['light','dark']) test('connection design '+language+' '+theme,async({page},info)=>{
 await page.setViewportSize({width:960,height:640});
 await page.addInitScript(({language,theme})=>{localStorage.setItem('woojoo-language',language);localStorage.setItem('woojoo-theme',theme);},{language,theme});
 const ko=language==='ko';await page.goto('/');
 await page.getByLabel(ko?'새 연결':'New connection',{exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByLabel(ko?'연결 이름':'Connection name',{exact:true})).toBeFocused();
 await page.screenshot({path:info.outputPath('db.png')});
 await dialog.getByLabel(ko?'읽기 전용 연결':'Read-only connection').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('db-options.png')});
 await expect(dialog.getByRole('button',{name:ko?'프로필 저장':'Save profile',exact:true})).toBeInViewport();
 await dialog.getByLabel(ko?'환경':'Environment',{exact:true}).click();
 await page.screenshot({path:info.outputPath('db-select.png')});await page.keyboard.press('Escape');
 await dialog.getByRole('button',{name:'SQLite',exact:true}).click();await page.screenshot({path:info.outputPath('sqlite.png')});
 await dialog.getByRole('button',{name:ko?'취소':'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Docker',exact:true}).click();await page.getByRole('button',{name:ko?'데모 관계도 보기':'View demo topology'}).click();
 await page.locator('.docker-node').first().click();await expect(page.locator('.docker-details')).toBeVisible();await page.screenshot({path:info.outputPath('docker-detail.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
