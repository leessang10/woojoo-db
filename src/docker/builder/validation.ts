import { readProject } from './document';
import { hasCycle } from './connections';
import { templateFor } from './catalog';
import type { ProjectDraft, ValidationIssue } from './types';

export function validateProject(d:ProjectDraft):ValidationIssue[] {
  const v=readProject(d.source),issues=[...v.issues];
  const add=(code:string,severity:ValidationIssue['severity'],message:string,service?:string,field?:string)=>issues.push({code,severity,message,service,field});
  if(!v.services.length)add('empty','error','Add a component / 컴포넌트를 추가하세요');
  if(!/^[a-z0-9][a-z0-9_-]*$/.test(d.name))add('project-name','error','Project name: lowercase letters, digits, - or _ / 프로젝트 이름 형식을 확인하세요');
  if(hasCycle(v.services))add('cycle','error','Startup dependencies contain a cycle / 시작 조건이 순환합니다');
  const bindings=new Map<string,string>();
  for(const s of v.services) {
    if(!s.image&&!s.build)add('image','error','Select an image or Dockerfile / 이미지 또는 Dockerfile을 선택하세요',s.key,'image');
    if(s.image&&!s.image.includes('@sha256:'))add('mutable-tag','info','Image tags can change; pin a digest for reproducibility / 태그는 변경될 수 있습니다',s.key,'image');
    for(const n of s.networks)if(!v.networks.some(x=>x.key===n))add('network','error',`Missing network / 없는 네트워크: ${n}`,s.key,'networks');
    for(const [name,dep] of Object.entries(s.depends)) {const target=v.services.find(x=>x.key===name);if(!target)add('dependency','error',`Missing service / 없는 서비스: ${name}`,s.key,'depends_on');else if(dep.condition==='service_healthy'&&(!target.healthcheck||target.healthcheck.disable))add('healthcheck','error',`Healthcheck required / 준비 검사 필요: ${name}`,s.key,'depends_on');}
    for(const p of s.ports) {
      if(!Number.isInteger(p.target)||p.target<1||p.target>65535)add('port','error','Invalid container port / 컨테이너 포트 확인 필요',s.key,'ports');
      if(p.published) {if(!/^\d+$/.test(p.published)||Number(p.published)>65535||Number(p.published)<1)add('published','warning','Port range or expression: verify with Compose / 범위·표현식은 Compose 검사 필요',s.key,'ports');const key=`${p.hostIp??'0.0.0.0'}:${p.published}/${p.protocol}`;if(bindings.has(key))add('port-conflict','error',`Duplicate host binding / 중복 호스트 포트: ${key}`,s.key,'ports');bindings.set(key,s.key);if(!['127.0.0.1','::1'].includes(p.hostIp??''))add('exposure','warning','Published beyond loopback / 외부 접속에 공개된 포트',s.key,'ports');}
    }
    for(const m of s.mounts) {
      if(!m.target.startsWith('/'))add('mount','error','Container mount path must be absolute / 컨테이너 경로는 절대 경로여야 합니다',s.key,'volumes');
      if(m.type==='volume'&&m.source&&!v.volumes.some(x=>x.key===m.source))add('volume','error',`Missing volume / 없는 볼륨: ${m.source}`,s.key,'volumes');
      if(m.type==='bind')add('bind','warning','Bind path belongs to the selected Docker host / 선택한 Docker 호스트의 경로입니다',s.key,'volumes');
      if(templateFor(s.image)?.data===m.target&&v.services.some(other=>other.key!==s.key&&other.mounts.some(x=>x.source===m.source&&x.type===m.type)))add('shared-data','warning','Database data volume is shared; verify compatibility / DB 데이터 공유와 버전 호환성을 확인하세요',s.key,'volumes');
    }
    if(s.envFiles.length)add('env-file','info','env_file values are preserved; explicit environment overrides them / env_file보다 직접 지정 환경 변수가 우선합니다',s.key,'environment');
    if(templateFor(s.image)?.id==='elasticsearch')add('tls','warning','Configure CA certificate and application credentials; template version is unmaintained / CA 인증서·앱 인증 설정과 버전 검토 필요',s.key,'environment');
    for(const [key,val] of Object.entries(s.environment))if(val===''||val===null)add('env-empty','warning',`Confirm environment value / 환경 변수 확인: ${key}`,s.key,'environment');
  }
  for(const c of d.connections) {
    const a=v.services.find(s=>s.key===c.consumer),b=v.services.find(s=>s.key===c.provider);
    if(!a||!b)add('connection','error','Connected service was removed / 연결 서비스가 삭제되었습니다',c.consumer);
    else if(c.origin==='container'&&!a.networks.some(n=>b.networks.includes(n)))add('connection-network','error','Connected services do not share a network / 연결 서비스의 공유망이 없습니다',a.key,'networks');
    add('communication','info','Configured · communication unverified / 구성됨 · 통신 미확인',c.consumer);
  }
  return issues;
}
