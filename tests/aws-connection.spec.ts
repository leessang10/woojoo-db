import { chooseOption } from './select-control';
import {test,expect,type Page} from './fixtures';
async function mock(page:Page,scenario='normal'){
 await page.addInitScript(({scenario})=>{
  (window as any).calls=[];
  Object.defineProperty(window,'isTauri',{value:true});Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async(command:string,args:any)=>{
   (window as any).calls.push({command,args});
   if(command==='credential_status')return {supported:true,saved:false,available:false};
   if(command==='aws_cli_info')return {installed:scenario!=='missing',version:'aws-cli/2.0',profiles:scenario==='emptyProfiles'?[]:['default','prod']};
   if(command==='aws_environment'){if(scenario==='expired')throw 'AWS_AUTH_REQUIRED';return {account:'123456789012',arn:'arn:aws:iam::123456789012:user/test',region:'ap-northeast-2',regions:['ap-northeast-2','us-east-1'],regionsWarning:scenario==='regionDenied'?'AWS_ACCESS_DENIED':null};}
   if(command==='aws_rds_instances'){if(scenario==='denied')throw 'AWS_ACCESS_DENIED';if(args.region==='us-east-1')return [];return [{id:'app-db',engine:'aurora-postgresql',version:'17.4',status:'available',host:'app.example.rds.amazonaws.com',port:5432,database:'app',username:'admin',public:false,supported:true},{id:'unsupported',engine:'oracle-ee',version:'19',status:'available',host:'other.example',port:1521,database:'app',username:'admin',public:true,supported:false}];}
   if(command==='connect_db')return 'rds-session';if(command==='disconnect_db')return;
   if(command==='list_tables')return [];throw new Error(command);
  }}});
 },{scenario});
 await page.goto('/');await page.getByLabel('새 연결',{exact:true}).click();await page.getByRole('button',{name:'AWS RDS',exact:true}).click();
}
test('AWS profile and region selection fill DB fields and use the existing connection flow',async({page})=>{
 await mock(page);const d=page.getByRole('dialog');await expect(d.getByRole('button',{name:'연결하기',exact:true})).toBeDisabled();
 await chooseOption(d.getByLabel('AWS 프로필'), 'prod');await expect(d.getByText('123456789012',{exact:true})).toBeVisible();await expect(d.getByLabel('AWS 리전')).toHaveValue('ap-northeast-2');
 await d.getByRole('button',{name:'RDS 조회'}).click();await chooseOption(d.getByLabel('RDS 인스턴스'), 'app-db');
 await d.getByLabel('RDS 인스턴스').click();await expect(page.getByRole('option').and(page.locator('[data-value=unsupported]'))).toHaveAttribute('data-disabled','');await page.keyboard.press('Escape');await expect(d.getByLabel('호스트',{exact:true})).toHaveValue('app.example.rds.amazonaws.com');await expect(d.getByLabel('포트',{exact:true})).toHaveValue('5432');await expect(d.getByLabel('사용자',{exact:true})).toHaveValue('admin');await expect(d.getByText(/사설 RDS/)).toBeVisible();
 await d.getByRole('button',{name:'AWS RDS',exact:true}).click();await expect(d.getByLabel('호스트',{exact:true})).toBeVisible();
 await d.getByLabel('비밀번호',{exact:true}).fill('test-only');await d.getByRole('button',{name:'연결 테스트',exact:true}).click();await expect(d.getByRole('status')).toContainText('연결에 성공');
 const calls=await page.evaluate(()=>(window as any).calls);expect(calls.find((c:any)=>c.command==='aws_rds_instances').args).toEqual({profile:'prod',region:'ap-northeast-2'});expect(calls.find((c:any)=>c.command==='connect_db').args.profile).toMatchObject({engine:'postgres',database:'app',password:'test-only',tls:true});
 await d.getByLabel('AWS 리전').fill('us-east-1');await expect(d.getByLabel('비밀번호',{exact:true})).toHaveCount(0);await expect(d.getByRole('button',{name:'연결하기',exact:true})).toBeDisabled();await d.getByRole('button',{name:'RDS 조회'}).click();await expect(d.getByRole('status')).toContainText('인스턴스가 없습니다');
 await d.getByLabel('AWS 리전').fill('ap-northeast-2');await d.getByRole('button',{name:'RDS 조회'}).click();await chooseOption(d.getByLabel('RDS 인스턴스'), 'app-db');await expect(d.getByLabel('비밀번호',{exact:true})).toHaveValue('');await d.getByRole('button',{name:'연결하기',exact:true}).click();await expect(d).not.toBeVisible();await expect(page.locator('.connection-name')).toContainText('app-db (ap-northeast-2)');
});
for(const scenario of ['missing','emptyProfiles','expired','denied','regionDenied'])test(`AWS discovery handles ${scenario}`,async({page})=>{
 await mock(page,scenario);const d=page.getByRole('dialog');
 if(scenario==='missing'){await expect(d.getByRole('status')).toContainText('찾을 수 없습니다');return;}
 if(scenario==='emptyProfiles'){await expect(d.getByRole('status')).toContainText('프로필이 없습니다');return;}
 await chooseOption(d.getByLabel('AWS 프로필'), 'default');
 if(scenario==='expired'){await expect(d.getByRole('alert')).toContainText('인증이 만료');await expect(d.getByRole('button',{name:'인증 다시 확인'})).toBeEnabled();return;}
 await expect(d.getByLabel('AWS 리전')).toHaveValue('ap-northeast-2');
 if(scenario==='regionDenied'){await expect(d.getByText(/리전 코드를 직접/)).toBeVisible();await d.getByLabel('AWS 리전').fill('us-east-1');}
 await d.getByRole('button',{name:'RDS 조회'}).click();
 if(scenario==='denied')await expect(d.getByRole('alert')).toContainText('조회 권한이 없습니다');else await expect(d.getByRole('status')).toContainText('인스턴스가 없습니다');
});
