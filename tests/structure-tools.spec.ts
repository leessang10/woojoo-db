import {test,expect} from './fixtures';

test('detail tabs show readable DDL, constraint editing and empty objects',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(window,'isTauri',{value:true});
  Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async(command:string)=>{
   if(command==='connect_db')return 'structure-tools';
   if(command==='list_tables')return [{schema:'main',name:'board'}];
   if(command==='read_table')return {columns:[],rows:[],elapsedMs:0,affected:0,truncated:false};
   if(command==='schema_info')return {info:{name:'main',charset:'UTF-8'},tables:[{schema:'main',name:'board',engine:'SQLite',charset:'UTF-8'}]};
   if(command==='describe_table')return [{name:'id',dataType:'INTEGER',primary:true,editable:false,nullable:false}];
   if(command==='table_ddl')return 'CREATE TABLE board (\n    id INTEGER PRIMARY KEY,\n    user_id INTEGER NOT NULL,\n    title TEXT NOT NULL,\n    content TEXT DEFAULT \'\',\n    FOREIGN KEY (user_id) REFERENCES user(id)\n);';
   if(command==='table_info')return {indexes:[{name:'board_user_id_idx',definition:'CREATE INDEX board_user_id_idx ON board(user_id)'}],constraints:[{name:'Table definition (includes constraints)',definition:'CREATE TABLE board (id INTEGER PRIMARY KEY);'}]};
   if(command==='object_list')return (window as any).objectFixtures??[];
   throw new Error(command);
  }}});
 });
 await page.goto('/');await page.getByLabel('새 연결',{exact:true}).click();await page.getByRole('button',{name:'SQLite',exact:true}).click();await page.getByRole('textbox',{name:'데이터베이스',exact:true}).fill('preview.sqlite3');await page.getByRole('button',{name:'연결하기',exact:true}).click();await expect(page.locator('.tree-table')).toHaveText('board');await page.locator('.tree-table').click();
 const dialog=page.getByRole('dialog');
 await page.getByRole('button',{name:'테이블 수정',exact:true}).click();
 await expect(dialog.getByLabel('Charset',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('설명',{exact:true})).toHaveCount(0);
 await dialog.getByLabel('테이블 이름',{exact:true}).fill('renamed_board');
 await dialog.getByRole('button',{name:'SQL 검토',exact:true}).click();
 await expect(dialog.getByLabel('실행 SQL')).toContainText('ALTER TABLE "main"."board" RENAME TO "renamed_board"');
 await page.keyboard.press('Escape');
 for(const theme of ['dark','light']) {
  if(theme==='light')await page.getByRole('button',{name:'라이트 모드로 전환',exact:true}).click();
  await page.getByRole('tab',{name:'DDL',exact:true}).click();
  await expect(page.getByRole('tab',{name:'DDL',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.object-definitions .cm-content')).toHaveAttribute('contenteditable','false');
  await expect(page.locator('.object-definitions .cm-content')).toContainText('FOREIGN KEY');
  expect((await page.locator('.object-definitions .cm-editor').boundingBox())!.height).toBeGreaterThan(250);
  await page.screenshot({animations:'disabled',path:`test-results/structure-ddl-${theme}.png`});
  await page.getByRole('tab',{name:/^인덱스/}).click();
  await page.getByRole('button',{name:'인덱스 · 제약조건 편집',exact:true}).click();
  await expect(dialog.locator('.structure-definition-row')).toHaveCount(2);
  await expect(dialog.getByText('테이블 정의 · 제약조건 포함',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'삭제',exact:true})).toHaveCount(1);
  await page.screenshot({animations:'disabled',path:`test-results/structure-constraints-${theme}.png`});
  await dialog.getByLabel('이름',{exact:true}).fill('board_title_idx');await dialog.getByLabel('컬럼 (쉼표로 구분)',{exact:true}).fill('title');
  await dialog.getByRole('button',{name:'SQL 미리보기',exact:true}).click();
  await expect(dialog.locator('textarea')).toHaveValue('CREATE INDEX "main"."board_title_idx" ON "board" ("title");');
  await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'뷰',exact:true}).click();
  await expect(page.getByText('일치하는 결과가 없습니다.',{exact:true})).toBeVisible();
  await page.screenshot({animations:'disabled',path:`test-results/structure-objects-${theme}.png`});
  await page.keyboard.press('Escape');
 }
 await page.evaluate(()=>{(window as any).objectFixtures=[{schema:'main',name:'board_view',kind:'view'},{schema:'main',name:'board_fn',kind:'function'},{schema:'main',name:'board_proc',kind:'procedure'},{schema:'main',name:'board_trigger',kind:'trigger'}];});
 await page.getByRole('tab',{name:'루틴',exact:true}).click();
 await expect(page.locator('.object-table tbody tr')).toHaveCount(2);
 await expect(page.locator('.object-table')).toContainText('board_fn');
 await expect(page.locator('.object-table')).toContainText('board_proc');
 await page.getByRole('tab',{name:'트리거',exact:true}).click();
 await expect(page.locator('.object-table tbody tr')).toHaveCount(1);
 await expect(page.locator('.object-table')).toContainText('board_trigger');
 await page.getByRole('tab',{name:'뷰',exact:true}).click();
 await expect(page.locator('.object-table tbody tr')).toHaveCount(1);
 await expect(page.locator('.object-table')).toContainText('board_view');
 await page.setViewportSize({width:960,height:640});await page.getByRole('tab',{name:'DDL',exact:true}).click();
 const box=(await page.locator('.object-definitions .cm-editor').boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.width).toBeGreaterThan(300);
 await page.getByRole('button',{name:'SQL 편집기로 열기',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('.editor-pane .cm-content')).toContainText('CREATE TABLE board');
});
