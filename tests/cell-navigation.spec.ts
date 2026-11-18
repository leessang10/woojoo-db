import { test, expect, type Page } from './fixtures';

async function connectRelations(page: Page, readOnly = false) {
  await page.addInitScript(({readOnly}) => {
    const child = {schema:'other',name:'children'}, parent = {schema:'app',name:'parents'};
    const col = (name:string,dataType:string,primary=false) => ({name,dataType,primary,editable:!primary});
    const childColumns = [col('id','bigint',true),col('tenant_id','varchar'),col('parent_id','bigint'),col('created_at','timestamp'),col('enabled','boolean'),col('text','varchar'),col('payload','jsonb')];
    const parentColumns = [col('tenant','varchar',true),col('id','bigint',true)];
    const childRows = [{id:'1',tenant_id:'team',parent_id:'7',created_at:'2026-11-18 09:00:00',enabled:'false',text:'NULL',payload:'{}'},
      {id:'2',tenant_id:null,parent_id:'7',created_at:null,enabled:'true',text:'00123',payload:null}];
    const result = (name:string) => ({columns:name==='children'?childColumns:parentColumns,rows:name==='children'?childRows:[{tenant:'team',id:'7'}],elapsedMs:2,affected:0,truncated:false});
    (window as any).dataPages=[];
    Object.defineProperty(window,'isTauri',{value:true});
    Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async(command:string,args:any)=>{
      if(command==='connect_db')return 'relations';
      if(command==='credential_status')return {supported:false,saved:false,available:false};
      if(command==='list_schemas')return ['app','other'];
      if(command==='list_tables')return [child,parent];
      if(command==='read_table')return result(args.table.name);
      if(command==='describe_table')return result(args.table.name).columns;
      if(command==='read_erd')return {tables:[{table:child,columns:childColumns},{table:parent,columns:parentColumns}],foreignKeys:[{id:'fk',name:'child_parent',source:child,target:parent,sourceColumns:['tenant_id','parent_id'],targetColumns:['tenant','id']}]};
      if(command==='data_page'){(window as any).dataPages.push(args);return result(args.table.name);}
      if(command==='execution_state')return {manual:false,inTransaction:false,running:false,readOnly,transactionStateKnown:true};
      if(command.startsWith('plugin:event|'))return 1;
      throw new Error(command);
    }}});
  }, {readOnly});
  await page.goto('/');
  await page.getByLabel('새 연결',{exact:true}).click();
  if(readOnly)await page.getByLabel('읽기 전용 연결',{exact:true}).check();
  await page.getByRole('button',{name:'연결하기',exact:true}).click();
  await page.locator('.tree-table').filter({hasText:'children'}).click();
  await expect(page.locator('.data-grid tbody tr')).toHaveCount(2);
}

test('typed cells and cross-schema composite relation links work in read-only mode',async({page})=>{
  await connectRelations(page,true);
  const rows=page.locator('.data-grid tbody tr');
  const cells=rows.first().locator('td.data-cell');
  await expect(cells).toHaveCount(7);
  expect(await cells.evaluateAll(elements=>elements.map(element=>element.getAttribute('data-value-type')))).toEqual(['number','text','number','temporal','boolean','text','json']);
  await expect(rows.nth(1).locator('[data-value-type="null"]')).toHaveCount(3);
  await expect(rows.nth(1).getByRole('button',{name:'parent_id 관계 이동',exact:true})).toHaveCount(0);
  await expect(rows.first().getByRole('button',{name:'parent_id 관계 이동',exact:true})).toBeEnabled();
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    const colors=await cells.evaluateAll(elements=>elements.map(element=>getComputedStyle(element).color));
    expect(new Set([colors[0],colors[1],colors[3],colors[4],colors[6]]).size).toBe(5);
  }
  await page.screenshot({path:'test-results/typed-cell-relations.png'});
  await rows.first().getByRole('button',{name:'parent_id 관계 이동',exact:true}).click();
  await expect(page.locator('.dw-grid')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).dataPages.at(-1))).toMatchObject({table:{schema:'app',name:'parents'},request:{filters:[{column:'tenant',operator:'eq',value:'team'},{column:'id',operator:'eq',value:'7'}]}});
  await page.locator('.dw-grid tbody tr').first().getByRole('button',{name:'id 관계 이동',exact:true}).click();
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  await page.getByRole('menuitem',{name:/참조하는 행 · other.children/}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).dataPages.at(-1))).toMatchObject({table:{schema:'other',name:'children'},request:{filters:[{column:'tenant_id',operator:'eq',value:'team'},{column:'parent_id',operator:'eq',value:'7'}]}});
  await expect(page.getByRole('textbox',{name:'1 parent_id',exact:true})).toHaveAttribute('readonly','');
});

test('pending row edits disable relation navigation',async({page})=>{
  await connectRelations(page);
  await page.locator('.data-grid tbody tr').first().getByRole('button',{name:'parent_id 관계 이동',exact:true}).click();
  const original=page.locator('.dw-grid tbody tr').first().getByRole('button',{name:'id 관계 이동',exact:true});
  await original.click();
  await page.getByRole('menuitem',{name:/참조하는 행 · other.children/}).click();
  const input=page.getByRole('textbox',{name:'1 text',exact:true});
  await input.fill('changed');
  await expect(page.locator('.dw-grid tbody tr').first().getByRole('button',{name:'parent_id 관계 이동',exact:true})).toBeDisabled();
});
