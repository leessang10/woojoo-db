import { parseDocument } from 'yaml';
import { changeProject, patchProject, readProject, uid } from './document';
import { templateFor } from './catalog';
import type { ConnectionIntent, ConnectionProposal, Mapping, Patch, ProjectDraft, SourcePath } from './types';

const eq = (a:unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b);
const valueAt = (source:string,path:SourcePath): unknown => { let value: unknown = parseDocument(source).toJS(); for(const key of path) value = value && typeof value==='object' ? (value as Record<string, unknown>)[key] : undefined; return value; };
export function proposeConnection(d:ProjectDraft, consumer:string, provider:string): ConnectionProposal {
  const v=readProject(d.source), a=v.services.find(s=>s.key===consumer), b=v.services.find(s=>s.key===provider);
  if(!a||!b||a===b) throw new Error('Choose two services');
  const t=templateFor(b.image), endpoint=t?.port ?? b.ports[0]?.target ?? (Number((b.raw.expose as string[]|undefined)?.[0]) || 3000);
  const prefix=t?.id==='redis'?'REDIS':t?.id==='elasticsearch'?'ELASTICSEARCH':t?'DB':'API';
  const map=(key:string,value:string,reference?:Mapping['reference'],secret=false):Mapping=>({key,value,reference,secret,existing:a.environment[key],enabled:!a.envFiles.length,replace:false});
  const mappings:Mapping[]=[map(`${prefix}_HOST`,provider,{service:provider,field:'host'}),map(`${prefix}_PORT`,String(endpoint),{service:provider,field:'port'})];
  for (const [key, from] of t?.id==='mysql' ? [['DB_NAME','MYSQL_DATABASE'],['DB_USER','MYSQL_USER'],['DB_PASSWORD','MYSQL_PASSWORD']] : t?.id==='postgres' ? [['DB_NAME','POSTGRES_DB'],['DB_USER','POSTGRES_USER'],['DB_PASSWORD','POSTGRES_PASSWORD']] : []) {
    mappings.push(map(key,b.environment[from]??'',{service:provider,field:'environment',key:from},key.endsWith('PASSWORD')));
  }
  if(t?.id==='elasticsearch') { mappings.length=0; mappings.push(map('ELASTICSEARCH_URL',`https://${provider}:${endpoint}`),map('ELASTICSEARCH_CA',''),map('ELASTICSEARCH_API_KEY','',undefined,true)); }
  if(t?.id==='redis'&&b.environment.REDIS_PASSWORD)mappings.push(map('REDIS_PASSWORD',b.environment.REDIS_PASSWORD,{service:provider,field:'environment',key:'REDIS_PASSWORD'},true));
  return {id:uid(),consumer,provider,origin:'container',injection:'runtime',endpoint,network:a.networks.find(n=>b.networks.includes(n))??a.networks[0]??'default',condition:b.healthcheck&&!b.healthcheck.disable?'service_healthy':'service_started',mappings,publicUrl:'',healthcheck:b.healthcheck};
}
export function applyConnection(d:ProjectDraft,p:ConnectionProposal):ProjectDraft {
  const v=readProject(d.source), a=v.services.find(s=>s.key===p.consumer), b=v.services.find(s=>s.key===p.provider);
  if(!a||!b||a===b) throw new Error('Choose two different services');
  if(p.origin==='browser') {
    if(['mysql','postgres','redis'].includes(templateFor(b.image)?.id??''))throw new Error('Browser / 브라우저 연결은 HTTP API를 대상으로 설정하세요.');
    const endpoint=p.publicUrl.trim(); const host=(()=>{try{return new URL(endpoint).hostname;}catch{return '';}})();
    if(p.mappings.some(m=>m.enabled&&m.secret)||(!endpoint.startsWith('/')&&!/^https?:\/\//.test(endpoint))||v.services.some(s=>s.key===host)) throw new Error('Browser / 브라우저 연결에는 공개 HTTP 주소가 필요하며 비밀값을 넣을 수 없습니다.');
  }
  if(p.condition==='service_healthy'&&(!b.healthcheck||b.healthcheck.disable)) throw new Error('Healthcheck required / 준비 검사가 필요합니다');
  const patches:Patch[]=[], owned:ConnectionIntent['owned']=[];
  const add=(path:SourcePath,value:unknown)=>{ const previous=valueAt(d.source,path); if(eq(previous,value))return; patches.push({path,value}); owned.push({path,value,previous}); };
  if(p.origin==='container') {
    if(!v.networks.some(n=>n.key===p.network)) add(['networks',p.network],{});
    for(const s of [a,b]) if(!s.networks.includes(p.network)) add(['services',s.key,'networks',p.network],{});
  }
  for(const m of p.mappings.filter(m=>m.enabled)) {
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.key)) throw new Error('Invalid environment variable name');
    const path=p.injection==='build'?['services',a.key,'build','args',m.key]:['services',a.key,'environment',m.key];
    if(p.injection==='build'&&!a.build) throw new Error('Build configuration required');
    const existing=p.injection==='runtime'?a.environment[m.key]:valueAt(d.source,path);
    if(existing!==undefined&&!m.replace) continue;
    if(a.envFiles.length&&!m.replace&&p.injection==='runtime') continue;
    add(path,p.origin==='browser'?p.publicUrl:m.value);
  }
  if(p.condition) {
    const existing=a.depends[b.key];
    if(!existing) add(['services',a.key,'depends_on',b.key],{condition:p.condition});
  }
  const intent={...structuredClone(p),owned};
  const next=patchProject(d,patches,[...d.connections,intent]);
  if(hasCycle(readProject(next.source).services)) throw new Error('Startup dependency cycle / 시작 조건 순환');
  return next;
}
export function hasCycle(services:ReturnType<typeof readProject>['services']):boolean {
  const active=new Set<string>(),done=new Set<string>(), byKey=new Map(services.map(s=>[s.key,s]));
  const visit=(key:string):boolean=>{if(active.has(key))return true;if(done.has(key))return false;active.add(key);for(const dep of Object.keys(byKey.get(key)?.depends??{})) if(visit(dep))return true;active.delete(key);done.add(key);return false;};
  return services.some(s=>visit(s.key));
}
export function removeConnection(d:ProjectDraft,id:string):ProjectDraft {
  const c=d.connections.find(c=>c.id===id);if(!c)return d;
  const patches:Patch[]=[];
  for(const o of c.owned) {
    if(o.path[0]==='networks'||o.path[2]==='networks')continue;
    if(!eq(valueAt(d.source,o.path),o.value))continue;
    if(d.connections.some(other=>other.id!==id&&other.owned.some(x=>eq(x.path,o.path))))continue;
    patches.push(o.previous===undefined?{path:o.path,remove:true}:{path:o.path,value:o.previous});
  }
  return patchProject(d,patches,d.connections.filter(c=>c.id!==id));
}
export function renameService(d:ProjectDraft,oldKey:string,newKey:string):ProjectDraft {
  const v=readProject(d.source);if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(newKey)||v.services.some(s=>s.key===newKey))throw new Error('Invalid or duplicate service name');
  if(v.services.find(s=>s.key===oldKey)?.editable===false||d.files.length>1)throw new Error('Edit source');
  const doc=parseDocument(d.source,{merge:true}); const node=doc.getIn(['services',oldKey],true);if(!node)throw new Error('Service missing');
  doc.setIn(['services',newKey],node);doc.deleteIn(['services',oldKey]);
  for(const s of v.services) if(s.depends[oldKey]) {const path=['services',s.key===oldKey?newKey:s.key,'depends_on'];doc.setIn(path,{...Object.fromEntries(Object.entries(s.depends).filter(([k])=>k!==oldKey)),[newKey]:s.depends[oldKey]});}
  const connections=structuredClone(d.connections);
  for(const c of connections) {
    for(const m of c.mappings) if(m.reference?.service===oldKey) {
      const field=c.injection==='build'?['build','args']:['environment']; const path=['services',c.consumer===oldKey?newKey:c.consumer,...field,m.key];
      if(m.reference.field==='host'&&doc.getIn(path)===m.value) {doc.setIn(path,newKey);for(const o of c.owned)if(eq(o.path,['services',c.consumer,...field,m.key]))o.value=newKey;m.value=newKey;}
      m.reference.service=newKey;
    }
    for(const o of c.owned) {if(o.path[0]==='services'&&o.path[1]===oldKey)o.path[1]=newKey;if(o.path[2]==='depends_on'&&o.path[3]===oldKey)o.path[3]=newKey;}
    if(c.consumer===oldKey)c.consumer=newKey;if(c.provider===oldKey)c.provider=newKey;
  }
  return changeProject(d,doc.toString(),connections);
}
