import {test,expect,type Page} from './fixtures';

async function mock(page:Page, initial:'empty'|'saved'|'failure'='empty') {
  await page.addInitScript(initial=>{
    const w=window as any;
    w.connectCalls=[];
    const saved={id:'remember-test',name:'Remembered database',engine:'mariadb',host:'db.example',port:3306,database:'app',username:'user',password:'',tls:true,readOnly:true,rememberPassword:true};
    if(initial!=='empty'&&!localStorage.getItem('mock-initialized')){
      localStorage.setItem('mock-initialized','yes');
      localStorage.setItem('woojoo-profiles-v1',JSON.stringify([saved]));
      localStorage.setItem('woojoo-active-profile',saved.id);
      localStorage.setItem('mock-vault','yes');
    }
    let memory=false;
    Object.defineProperty(window,'isTauri',{value:true});
    Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async(command:string,args:any)=>{
      if(command==='credential_status'){
        const matches=['engine','host','port','database','username','tls'].every(k=>args.profile[k]===(saved as any)[k]);
        const stored=matches&&localStorage.getItem('mock-vault')==='yes';
        return {supported:true,saved:stored,available:stored||memory&&matches};
      }
      if(command==='connect_db'){
        w.connectCalls.push({hasPassword:!!args.profile.password,rememberPassword:args.profile.rememberPassword});
        if(initial==='failure'&&!args.profile.password)throw 'Authentication failed';
        memory=true;
        if(args.profile.rememberPassword)localStorage.setItem('mock-vault','yes');
        else localStorage.removeItem('mock-vault');
        return 'native-session';
      }
      if(command==='forget_password'){memory=false;localStorage.removeItem('mock-vault');return;}
      if(command==='disconnect_db')return;
      if(command==='list_tables')return [];
      if(command==='execution_state')return {inTransaction:false};
      throw new Error(command);
    }}});
  },initial);
  await page.goto('/');
}

test('opt-in persists only the preference and reconnects without a frontend password',async({page})=>{
  await mock(page);
  await page.getByLabel('새 연결',{exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'MariaDB',exact:true}).click();
  await dialog.getByLabel('연결 이름',{exact:true}).fill('Remembered database');
  await dialog.getByLabel('호스트',{exact:true}).fill('db.example');
  await dialog.getByRole('textbox',{name:'데이터베이스',exact:true}).fill('app');
  await dialog.getByLabel('사용자',{exact:true}).fill('user');
  await expect(dialog.getByRole('checkbox',{name:'이 PC에 비밀번호 기억'})).not.toBeChecked();
  await dialog.getByRole('checkbox',{name:'이 PC에 비밀번호 기억'}).check();
  await dialog.getByLabel('비밀번호',{exact:true}).fill('test-only-secret');
  await dialog.getByRole('button',{name:'연결하기',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  const stored=await page.evaluate(()=>localStorage.getItem('woojoo-profiles-v1')!);
  expect(stored).not.toContain('test-only-secret');
  expect(JSON.parse(stored)[0]).toMatchObject({rememberPassword:true,password:''});
  await page.reload();
  await expect(page.locator('.connection .live-dot')).not.toHaveClass(/offline/);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await page.evaluate(()=>(window as any).connectCalls)).toEqual([{hasPassword:false,rememberPassword:true}]);
});

test('deleting the stored password disables auto reconnect and clears the saved indicator',async({page})=>{
  await mock(page,'saved');
  await expect(page.locator('.connection .live-dot')).not.toHaveClass(/offline/);
  await page.locator('.connection').click({button:'right'});
  await page.getByRole('menuitem',{name:'프로필 수정 / 다시 연결'}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByLabel('비밀번호',{exact:true})).toHaveValue('');
  await expect(dialog.getByText(/비밀번호 저장됨/)).toBeVisible();
  await dialog.getByRole('button',{name:'저장된 비밀번호 삭제'}).click();
  await expect(dialog.getByRole('status')).toHaveText('저장된 비밀번호를 삭제했습니다.');
  await expect(dialog.getByRole('checkbox',{name:'이 PC에 비밀번호 기억'})).not.toBeChecked();
  await page.reload();
  await expect(page.locator('.connection .live-dot')).toHaveClass(/offline/);
  expect(await page.evaluate(()=>(window as any).connectCalls)).toEqual([]);
});

test('automatic authentication failure prompts once and accepts a replacement password',async({page})=>{
  await mock(page,'failure');
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByText(/자동 연결하지 못했습니다/)).toBeVisible();
  expect(await page.evaluate(()=>(window as any).connectCalls)).toHaveLength(1);
  await dialog.getByLabel('비밀번호',{exact:true}).fill('new-test-password');
  await dialog.getByRole('button',{name:'연결하기',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.connection .live-dot')).not.toHaveClass(/offline/);
});

test('changing the destination clears typed passwords and the saved credential hint',async({page})=>{
  await mock(page,'saved');
  await expect(page.locator('.connection .live-dot')).not.toHaveClass(/offline/);
  await page.locator('.connection').click({button:'right'});
  await page.getByRole('menuitem',{name:'프로필 수정 / 다시 연결'}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByText(/비밀번호 저장됨/)).toBeVisible();
  await dialog.getByLabel('비밀번호',{exact:true}).fill('replacement');
  await dialog.getByLabel('호스트',{exact:true}).fill('different.example');
  await expect(dialog.getByLabel('비밀번호',{exact:true})).toHaveValue('');
  await expect(dialog.getByText(/비밀번호 저장됨/)).not.toBeVisible();
});
