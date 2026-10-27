import { test, expect, type Page } from './fixtures';
async function setup(page:Page,scenario='normal'){
  await page.addInitScript(({scenario})=>{
    const w=window as any;w.builderCalls=[];w.builderOps=[];const callbacks=new Map<number,any>();let callbackId=0;
    Object.defineProperty(window,'isTauri',{value:true});Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{transformCallback:(callback:any)=>{callbacks.set(++callbackId,callback);return callbackId;},unregisterCallback:()=>{},invoke:async(command:string,args:any)=>{
      w.builderCalls.push({command,args});
      if(command==='docker_contexts')return [{name:'local',endpoint:'npipe://docker',current:true}];
      if(command==='docker_snapshot')return {context:'local',containers:[],images:[],volumes:[],networks:[],warnings:[],complete:true};
      // Native IPC returns a fresh deserialized value on every poll.
      if(command==='docker_builder_operations')return structuredClone(w.builderOps);
      if(command==='docker_builder_import'){if(args.paths)throw 'File does not exist';return [{path:'C:/example/compose.yml',original:'# preserved\nx-custom: {mode: hello}\nservices:\n  redis:\n    image: redis:7.4\n',source:'# preserved\nx-custom: {mode: hello}\nservices:\n  redis:\n    image: redis:7.4\n'}];}
      if(command==='docker_builder_destination')return 'C:/example/compose.yml';
      if(command==='docker_builder_review'){if(scenario==='slow')await new Promise(resolve=>{w.finishReview=resolve;});return {token:'review-token',effective:{services:{redis:{image:'redis:7.4'}}},files:args.input.files.map((f:any)=>({path:f.path,changed:true})),extraFiles:[],fingerprint:'fp',checked:1};}
      if(command==='docker_builder_start'){w.builderOps=[{id:'job-1',context:'local',project:args.project??'project-1',state:'running',started:1,lines:['Pulling redis…']}];return w.builderOps[0];}
      if(command==='docker_builder_cancel'){w.builderOps[0].state='unknown';return;}
      if(command==='compose_list')return [];
      if(command==='plugin:event|listen'){if(args.event==='close-requested')w.requestClose=()=>callbacks.get(args.handler)?.({event:'close-requested',id:1,payload:null});return 1;}
    }}});
  },{scenario});
  await page.goto('/');await page.getByRole('button',{name:'Docker',exact:true}).click();
}
test('imports without running and preserves unknown source through a GUI edit',async({page})=>{
  await setup(page);await page.getByRole('button',{name:'Compose 가져오기',exact:true}).click();
  await page.getByTestId('builder-service-redis').click();await page.getByLabel('이미지',{exact:true}).fill('redis:7.4-alpine');await page.getByLabel('이미지',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'Compose 원문',exact:true}).click();await expect(page.getByLabel('Compose YAML')).toHaveValue(/# preserved/);await expect(page.getByLabel('Compose YAML')).toHaveValue(/x-custom/);
  expect(await page.evaluate(()=>(window as any).builderCalls.filter((c:any)=>/builder_start|compose_action/.test(c.command)))).toHaveLength(0);
});
test('invalidates a pending review when the draft changes',async({page})=>{
  await setup(page,'slow');await page.getByRole('button',{name:'새 프로젝트',exact:true}).first().click();await page.getByRole('button',{name:'Redis 추가',exact:true}).click();
  await page.getByRole('button',{name:'구성 검사',exact:true}).first().click();
  await expect.poll(()=>page.evaluate(()=>!!(window as any).finishReview)).toBe(true);
  await page.getByLabel('프로젝트 이름').fill('changed-project');await page.evaluate(()=>(window as any).finishReview());
  await expect(page.getByRole('alert')).toContainText('초안이 변경');await expect(page.getByRole('button',{name:'저장하고 실행',exact:true})).toHaveCount(0);
});
test('requires reviewed apply and retains unknown outcome after cancellation',async({page})=>{
  await setup(page);await page.getByRole('button',{name:'새 프로젝트',exact:true}).first().click();await page.getByRole('button',{name:'Redis 추가',exact:true}).click();
  await page.getByRole('button',{name:'실행 검토',exact:true}).click();await page.getByRole('button',{name:'저장하고 실행',exact:true}).click();
  await expect(page.getByRole('button',{name:'CLI 작업 취소',exact:true})).toBeVisible();await page.getByRole('button',{name:'CLI 작업 취소',exact:true}).click();
  await expect(page.getByText('결과 미확정 · 실제 상태 확인 필요',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).builderCalls.filter((c:any)=>c.command==='docker_builder_start').length)).toBe(1);
});
test('closing during an operation can wait without cancelling the job',async({page})=>{
  await setup(page);await page.getByRole('button',{name:'새 프로젝트',exact:true}).first().click();await page.getByRole('button',{name:'Redis 추가',exact:true}).click();
  await page.getByRole('button',{name:'실행 검토',exact:true}).click();await page.getByRole('button',{name:'저장하고 실행',exact:true}).click();
  await expect(page.getByRole('button',{name:'CLI 작업 취소',exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).requestClose());await expect(page.getByRole('alertdialog')).toContainText('Docker CLI');
  await page.getByRole('button',{name:'작업 완료까지 기다리기',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).builderCalls.filter((c:any)=>c.command==='close_window'||c.command==='docker_builder_cancel'))).toHaveLength(0);
});
