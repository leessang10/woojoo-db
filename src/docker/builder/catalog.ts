import { patchProject, readProject } from './document';
import type { ComponentInput, ProjectDraft, Patch } from './types';

export interface CatalogEntry { id: string; title: string; role: string; image: string; port: number; protocol: string; data: string; docs: string; checked: string; platforms: string[]; defaults: Record<string, unknown>; note: string }
const health = (test: string[]) => ({test,interval:'10s',timeout:'5s',retries:10,start_period:'20s'});
export const catalog: CatalogEntry[] = [
  {id:'redis',title:'Redis',role:'Cache',image:'redis:7.4',port:6379,protocol:'redis',data:'/data',docs:'https://hub.docker.com/_/redis',checked:'2026-10-27',platforms:['linux/amd64','linux/arm64'],note:'Loopback only by default; configure authentication before sharing.',defaults:{command:['redis-server','--appendonly','yes'],healthcheck:health(['CMD','redis-cli','ping'])}},
  {id:'mysql',title:'MySQL',role:'SQL database',image:'mysql:8.4',port:3306,protocol:'mysql',data:'/var/lib/mysql',docs:'https://hub.docker.com/_/mysql',checked:'2026-10-27',platforms:['linux/amd64','linux/arm64'],note:'Initial account settings apply only to an empty data volume.',defaults:{environment:{MYSQL_DATABASE:'app',MYSQL_USER:'app',MYSQL_PASSWORD:'${MYSQL_PASSWORD:?Set MYSQL_PASSWORD}',MYSQL_ROOT_PASSWORD:'${MYSQL_ROOT_PASSWORD:?Set MYSQL_ROOT_PASSWORD}'},healthcheck:health(['CMD-SHELL','mysqladmin ping -h 127.0.0.1 --silent'])}},
  {id:'postgres',title:'PostgreSQL',role:'SQL database',image:'postgres:16',port:5432,protocol:'postgres',data:'/var/lib/postgresql/data',docs:'https://hub.docker.com/_/postgres',checked:'2026-10-27',platforms:['linux/amd64','linux/arm64'],note:'POSTGRES_USER is the initialization superuser. Use a separate application role for shared environments.',defaults:{environment:{POSTGRES_DB:'app',POSTGRES_USER:'app',POSTGRES_PASSWORD:'${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}'},healthcheck:health(['CMD-SHELL','pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"'])}},
  {id:'elasticsearch',title:'Elasticsearch',role:'Search',image:'docker.elastic.co/elasticsearch/elasticsearch:8.15.5',port:9200,protocol:'https',data:'/usr/share/elasticsearch/data',docs:'https://www.elastic.co/guide/en/elasticsearch/reference/8.15/docker.html',checked:'2026-10-27',platforms:['linux/amd64','linux/arm64'],note:'Pinned compatibility template (8.15 is no longer maintained). TLS/auth remain enabled. Configure a CA certificate and application credentials before connecting. Docker memory ≥ 4 GiB.',defaults:{environment:{'discovery.type':'single-node',ELASTIC_PASSWORD:'${ELASTIC_PASSWORD:?Set ELASTIC_PASSWORD}'},mem_limit:'1g'}},
];
export const templateFor = (image: string) => catalog.find(c=>image === c.image);
export function redisSettings(service:string,auth:boolean,persist:boolean):Patch[]{
  return [{path:['services',service,'command'],value:auth?['/bin/sh','-c',`exec redis-server --appendonly ${persist?'yes':'no'} --requirepass "` + '$${REDIS_PASSWORD}"']:['redis-server','--appendonly',persist?'yes':'no']},
    auth?{path:['services',service,'environment','REDIS_PASSWORD'],value:'${REDIS_PASSWORD:?Set REDIS_PASSWORD}'}:{path:['services',service,'environment','REDIS_PASSWORD'],remove:true},
    {path:['services',service,'healthcheck'],value:health(auth?['CMD-SHELL','REDISCLI_AUTH="$${REDIS_PASSWORD}" redis-cli ping']:['CMD','redis-cli','ping'])}];
}
export function configureRedis(draft:ProjectDraft,service:string,auth:boolean,persist:boolean){return patchProject(draft,redisSettings(service,auth,persist));}
export function addComponent(draft: ProjectDraft, input: ComponentInput): ProjectDraft {
  const v = readProject(draft.source), template = catalog.find(t=>t.id===input.template);
  const base = (input.name || template?.id || 'app').toLowerCase().replace(/[^a-z0-9_-]/g,'-') || 'app';
  let name=base; for(let n=2;v.services.some(s=>s.key===name);n++) name=`${base}-${n}`;
  const publish=input.publish ?? (template?.id==='redis' && v.services.length===0);
  const service: Record<string, unknown> = {...structuredClone(template?.defaults??{}),...(input.build?{build:input.build}:{image:input.image??template?.image??''}),...(input.platform?{platform:input.platform}:{}),networks:['default'],restart:'unless-stopped'};
  const patches = [{path:['services',name],value:service}];
  if (template) { service.expose=[String(template.port)]; service.volumes=[{type:'volume',source:`${name}-data`,target:template.data}]; patches.push({path:['volumes',`${name}-data`],value:{}}); if(publish) service.ports=[{target:template.port,published:String(template.port),host_ip:'127.0.0.1',protocol:'tcp'}]; }
  return patchProject(draft,patches);
}
