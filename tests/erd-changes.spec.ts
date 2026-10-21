import {test,expect} from './fixtures';
import {chooseOption} from './select-control';
test('ERD stages tables, columns, indexes and dragged physical/virtual foreign keys before commit',async({page})=>{
 await page.addInitScript(()=>{
  const col=(name:string,primary=false)=>({name,dataType:'integer',primary,editable:!primary});
  const schema:any={tables:[{table:{schema:'main',name:'orders'},columns:[col('id',true),col('user_id')]},{table:{schema:'main',name:'users'},columns:[col('id',true)]}],foreignKeys:[]};
  (window as any).applied=[];
  Object.defineProperty(window,'isTauri',{value:true});Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async(cmd:string,args:any)=>{
   if(cmd==='connect_db')return 'erd-edit';if(cmd==='list_tables')return schema.tables.map((t:any)=>t.table);
   if(cmd==='read_table')return {columns:[],rows:[],elapsedMs:0,affected:0,truncated:false};
   if(cmd==='read_erd')return structuredClone(schema);
   if(cmd==='erd_plan'){(window as any).planned=args.operations;return {sqls:['-- reviewed changes','CREATE TABLE tags (id INTEGER PRIMARY KEY);'],expectedSnapshot:'snapshot',transactional:true,warnings:[]};}
   if(cmd==='erd_apply'){
    (window as any).applied=args.operations;
    for(const op of args.operations){
     if(op.kind==='createTable')schema.tables.push({table:op.table,columns:op.columns});
     if(op.kind==='addColumn')schema.tables.find((t:any)=>t.table.name===op.table.name).columns.push(op.column);
     if(op.kind==='addForeignKey')schema.foreignKeys.push({id:op.id,name:op.name,source:op.table,target:op.target,sourceColumns:op.columns,targetColumns:op.targetColumns});
    }
    return {completed:args.operations.length,total:args.operations.length,error:null,transactional:true};
   }
   throw new Error(cmd);
  }}});
 });
 await page.goto('/');await page.getByLabel('새 연결',{exact:true}).click();await page.getByRole('button',{name:'SQLite',exact:true}).click();await page.getByRole('textbox',{name:'데이터베이스',exact:true}).fill('test.sqlite3');await page.getByRole('button',{name:'연결하기',exact:true}).click();await expect(page.locator('.tree-table')).toHaveCount(2);
 await page.locator('.tree-schema').click({button:'right'});await page.getByRole('menuitem',{name:'ERD 열기',exact:true}).click();await expect(page.locator('.erd-table-node')).toHaveCount(2);
 await page.locator('.erd-toolbar').getByRole('button',{name:'테이블 추가',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByLabel('이름',{exact:true}).fill('tags');await dialog.getByRole('button',{name:'변경 대기열에 추가',exact:true}).click();await expect(page.locator('.erd-table-node')).toHaveCount(3);
 const orders=page.locator('.erd-table-node').filter({has:page.locator('header strong',{hasText:'orders'})});
 await orders.locator('header').click({button:'right'});await page.getByRole('menuitem',{name:'컬럼 추가',exact:true}).click();await dialog.getByLabel('컬럼 이름 1',{exact:true}).fill('note');await dialog.getByRole('button',{name:'변경 대기열에 추가',exact:true}).click();await expect(orders.locator('[data-column="note"]')).toBeVisible();
 await orders.locator('[data-column="user_id"]').click({button:'right'});await page.getByRole('menuitem',{name:'인덱스 추가',exact:true}).click();await dialog.getByLabel('이름',{exact:true}).fill('orders_user_idx');await dialog.getByRole('button',{name:'변경 대기열에 추가',exact:true}).click();
 await page.locator('.erd-toolbar').getByRole('button',{name:'전체 보기',exact:true}).click();
 const users=page.locator('.erd-table-node').filter({has:page.locator('header strong',{hasText:'users'})});
 // Drag directly between column handles, not table-level endpoints.
 await orders.hover();const from=(await orders.locator('[data-handleid="out:user_id"]').boundingBox())!,to=(await users.locator('[data-handleid="in:id"]').boundingBox())!;
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:15});await page.mouse.up();
 await expect(dialog).toBeVisible();await dialog.getByLabel('이름',{exact:true}).fill('orders_user_fk');await dialog.getByRole('button',{name:'변경 대기열에 추가',exact:true}).click();
 await expect(page.locator('.erd-toolbar').getByRole('button',{name:'DB 변경 검토 (4)',exact:true})).toBeEnabled();expect(await page.evaluate(()=>(window as any).applied)).toEqual([]);
 await page.locator('.erd-inspector').getByRole('button',{name:'관계 추가',exact:true}).click();await dialog.getByLabel('이름',{exact:true}).fill('virtual_link');await chooseOption(dialog.getByLabel('관계 종류'),'virtual');
 for(const label of ['시작 컬럼','대상 컬럼']){await dialog.getByLabel(label,{exact:true}).click();await page.getByRole('checkbox',{name:'id',exact:true}).check();await page.keyboard.press('Escape');}
 await dialog.getByRole('button',{name:'관계 추가',exact:true}).click();await expect(page.locator('.react-flow__edge')).toHaveCount(2);
 await page.reload();await page.getByRole('button',{name:'다시 연결',exact:true}).click();await page.getByRole('button',{name:'연결하기',exact:true}).click();await expect(page.locator('.erd-toolbar').getByRole('button',{name:'DB 변경 검토 (4)',exact:true})).toBeEnabled();await expect(page.locator('.erd-table-node')).toHaveCount(3);await expect(page.locator('.react-flow__edge')).toHaveCount(2);
 await page.locator('.erd-toolbar').getByRole('button',{name:'DB 변경 검토 (4)',exact:true}).click();await expect(dialog.locator('pre')).toContainText('CREATE TABLE');expect(await page.evaluate(()=>(window as any).applied)).toEqual([]);await dialog.getByRole('button',{name:'취소',exact:true}).click();
 await page.locator('.erd-toolbar').getByRole('button',{name:'DB 변경 검토 (4)',exact:true}).click();await dialog.getByRole('button',{name:'DB에 적용',exact:true}).click();await expect(page.locator('.erd-toolbar').getByRole('button',{name:'DB 변경 검토',exact:true})).toBeDisabled();
 expect((await page.evaluate(()=>(window as any).applied)).map((op:any)=>op.kind)).toEqual(['createTable','addColumn','addIndex','addForeignKey']);await expect(page.locator('.react-flow__edge')).toHaveCount(2);await page.screenshot({path:'test-results/erd-editing.png',animations:'disabled'});
});
