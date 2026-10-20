import {test,expect} from './fixtures';
test('schema and column CRUD with SQL review and deletion confirmation',async({page})=>{
 await page.goto('/');await page.locator('.tree-schema').click();
 await expect(page.getByText('DB 인코딩',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'테이블 추가',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByLabel('테이블 이름',{exact:true}).fill('notes');
 await dialog.getByRole('button',{name:'SQL 검토'}).click();
 await expect(dialog.getByLabel('실행 SQL')).toContainText('CREATE TABLE "public"."notes"');
 await dialog.getByRole('button',{name:'구조 변경 적용'}).click();
 await expect(dialog).not.toBeVisible();await page.locator('.tree-table').filter({hasText:'notes'}).click();
 await expect(page.getByRole('heading',{name:'notes',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'컬럼 추가',exact:true}).click();
 await dialog.getByLabel('컬럼 이름 1',{exact:true}).fill('body');
 await dialog.getByRole('button',{name:'SQL 검토'}).click();await dialog.getByRole('button',{name:'구조 변경 적용'}).click();
 const row=page.locator('.object-table tbody tr').filter({hasText:'body'});await expect(row).toBeVisible();
 await row.getByRole('button',{name:'변경',exact:true}).click();
 await dialog.getByLabel('컬럼 이름 1',{exact:true}).fill('content');
 await dialog.getByRole('button',{name:'SQL 검토'}).click();await dialog.getByRole('button',{name:'구조 변경 적용'}).click();
 await page.locator('.object-table tbody tr').filter({hasText:'content'}).getByRole('button',{name:'삭제',exact:true}).click();
 await dialog.getByRole('button',{name:'SQL 검토'}).click();await expect(dialog.getByRole('button',{name:'구조 변경 적용'})).toBeDisabled();
 await page.screenshot({path:'test-results/structure-delete-spacing.png'});await dialog.getByLabel('삭제 대상 이름 입력').fill('content');await dialog.getByRole('button',{name:'구조 변경 적용'}).click();
 await expect(page.locator('.object-table tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:'설명 수정',exact:true}).click();await expect(dialog.getByLabel('설명',{exact:true})).toBeFocused();await dialog.getByLabel('설명',{exact:true}).fill('Notes description');await dialog.getByLabel('테이블 이름',{exact:true}).fill('renamed_notes');
 await dialog.getByRole('button',{name:'SQL 검토'}).click();await dialog.getByRole('button',{name:'구조 변경 적용'}).click();
 await expect(page.getByRole('heading',{name:'renamed_notes',exact:true})).toBeVisible();
 await expect(page.locator('.object-comment')).toContainText('Notes description');
 await page.getByRole('button',{name:'테이블 삭제',exact:true}).click();await dialog.getByRole('button',{name:'SQL 검토'}).click();
 await dialog.getByLabel('삭제 대상 이름 입력').fill('public.renamed_notes');await dialog.getByRole('button',{name:'구조 변경 적용'}).click();
 await expect(page.locator('.tree-table')).toHaveCount(1);await expect(page.getByRole('heading',{name:'public',exact:true})).toBeVisible();
});
test('pending data edits block schema modification',async({page})=>{
 await page.goto('/');await page.getByText('Alex Morgan',{exact:true}).dblclick();await page.getByLabel('셀 값').fill('pending');await page.getByRole('button',{name:'변경 대기열에 추가'}).click();await page.locator('.tree-table').click();await page.getByRole('button',{name:'컬럼 추가',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByRole('alert')).toContainText('먼저 데이터 탭');
});
test('MySQL metadata and reviewed DDL transport report permission errors',async({page})=>{
 await page.addInitScript(()=>{
 Object.defineProperty(window,'isTauri',{value:true});Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async(command:string,args:any)=>{
 if(command==='connect_db')return 'mysql-test';
 if(command==='list_tables')return [{schema:'app',name:'notes'}];
 if(command==='read_table')return {columns:[],rows:[],elapsedMs:0,affected:0,truncated:false};
 if(command==='schema_info')return {info:{name:'app',charset:'utf8mb4',collation:'utf8mb4_bin'},tables:[{schema:'app',name:'notes',engine:'InnoDB',charset:'utf8mb4',collation:'utf8mb4_bin',comment:''}]};
 if(command==='table_info')return {indexes:[],constraints:[]};
 if(command==='describe_table')return [{name:'id',dataType:'bigint',primary:true,editable:false,nullable:false,defaultValue:null,extra:'auto_increment'}];
 if(command==='execute_ddl'){(window as any).reviewed=args;throw new Error('ALTER command denied');}throw new Error(command);
 }}});
 });
 await page.goto('/');await page.getByLabel('새 연결',{exact:true}).click();await page.getByRole('button',{name:'MySQL',exact:true}).click();await page.getByRole('button',{name:'연결하기',exact:true}).click();await page.locator('.tree-table').click();await expect(page.getByText('utf8mb4',{exact:true})).toBeVisible();await page.getByRole('button',{name:'컬럼 추가',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('컬럼 이름 1',{exact:true}).fill('title');await d.getByLabel('Charset 1',{exact:true}).fill('utf8mb4');await d.getByRole('button',{name:'SQL 검토'}).click();const sql=await d.getByLabel('실행 SQL').textContent();await d.getByRole('button',{name:'구조 변경 적용'}).click();await expect(d.getByRole('alert')).toContainText('ALTER command denied');expect(await page.evaluate(()=>(window as any).reviewed.sqls.join(';')+';')).toBe(sql);await expect(d.getByRole('button',{name:'SQL 검토'})).toBeEnabled();
});
