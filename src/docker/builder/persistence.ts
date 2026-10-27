import { stringify,parseDocument } from 'yaml';
import { createProject, readProject } from './document';
import { catalog, templateFor } from './catalog';
import type { ProjectDraft,ConnectionHint,ConnectionIntent } from './types';

export interface PersistedDraft { version: 1; id: string; name: string; context: string; files: string[]; positions: ProjectDraft['positions']; structure?: Record<string, unknown>; templates?: Record<string,string>; connections?:ConnectionHint[]; needsInput: boolean }
const safeName = (s: string) => /^[a-zA-Z0-9_.\-/]+$/.test(s);
export function safeDraft(d: ProjectDraft): PersistedDraft {
  const base: PersistedDraft = {version:1,id:d.id,name:d.name,context:d.context,files:d.files.map(f=>f.path),positions:d.positions,needsInput:true};
  base.connections=d.connections.length?d.connections.map(c=>({id:c.id,consumer:c.consumer,provider:c.provider,origin:c.origin,injection:c.injection,network:c.network,condition:c.condition,endpoint:c.endpoint,ownsDependency:c.owned.some(o=>o.path[2]==='depends_on'&&o.previous===undefined),mappings:c.mappings.filter(m=>m.reference).map(m=>({key:m.key,reference:m.reference!,secret:!!m.secret,owned:c.owned.some(o=>o.path.at(-1)===m.key&&o.previous===undefined)}))})):d.connectionHints??[];
  if (d.files.length) return base;
  const v = readProject(d.source);
  base.templates=Object.fromEntries(v.services.flatMap(s=>{const t=templateFor(s.image);return t&&JSON.stringify(s.command)===JSON.stringify(t.defaults.command)&&JSON.stringify(s.healthcheck)===JSON.stringify(t.defaults.healthcheck)?[[s.key,t.id]]:[];}));
  base.structure = {
    services:Object.fromEntries(v.services.map(s => [s.key, {
      ...(safeName(s.image) || /^[\w./-]+:[\w.-]+$/.test(s.image) ? {image:s.image} : {}),
      ...(s.build && typeof s.build.context==='string' && !s.build.context.includes('://') ? {build:{context:s.build.context,dockerfile:s.build.dockerfile}} : {}),
      networks:s.networks, ports:s.ports.filter(p=>Number.isInteger(p.target)).map(p=>({target:p.target,...(p.published?{published:p.published}:{}),...(p.hostIp?{host_ip:p.hostIp}:{}),protocol:p.protocol})),
      volumes:s.mounts.map(m=>({type:m.type,...(m.source?{source:m.source}:{}),target:m.target,read_only:m.readOnly})),
      environment:Object.fromEntries(Object.keys(s.environment).map(k=>[k,''])),
      ...(Object.keys(s.depends).length ? {depends_on:Object.fromEntries(Object.entries(s.depends).map(([key,dep])=>[key,{condition:['service_started','service_healthy','service_completed_successfully'].includes(dep.condition)?dep.condition:'service_started'}]))} : {}), restart:['no','always','unless-stopped','on-failure'].includes(s.restart)?s.restart:'no',
    }])),
    networks:Object.fromEntries(v.networks.map(n=>[n.key,n.external?{external:true,name:n.name??n.key}:{}])),
    volumes:Object.fromEntries(v.volumes.map(n=>[n.key,n.external?{external:true,name:n.name??n.key}:{}])),
  };
  return base;
}
export function restoreDraft(s: PersistedDraft): ProjectDraft {
  const structure=structuredClone(s.structure);
  if(structure)for(const [key,id]of Object.entries(s.templates??{})){const t=catalog.find(t=>t.id===id);const services=structure.services as Record<string,Record<string,unknown>>;if(t&&services?.[key]){const original=services[key];services[key]={...structuredClone(t.defaults),...original,command:structuredClone(t.defaults.command),healthcheck:structuredClone(t.defaults.healthcheck),environment:{...recordEnv(t.defaults.environment),...Object.fromEntries(Object.entries(recordEnv(original.environment)).filter(([,v])=>v!==''))}};}}
  return restoreConnections({...createProject(structure ? stringify(structure) : undefined),id:s.id,name:s.name,context:s.context,positions:s.positions??{},needsInput:s.needsInput,files:s.files.map(path=>({path,original:null,source:''})),connectionHints:s.connections});
}
const recordEnv=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};
export function restoreConnections(d:ProjectDraft):ProjectDraft{
  if(!d.connectionHints?.length||d.files.length>1||d.files.length&&d.files[0].original===null)return d;
  const doc=parseDocument(d.source),view=readProject(d.source);let changed=false;const connections:ConnectionIntent[]=[];
  for(const hint of d.connectionHints){const consumer=view.services.find(s=>s.key===hint.consumer),provider=view.services.find(s=>s.key===hint.provider);if(!consumer||!provider)continue;
    const owned:ConnectionIntent['owned']=[];const mappings=hint.mappings.map(m=>{
      const ref=m.reference;const target=view.services.find(s=>s.key===ref.service);const value=ref.field==='host'?ref.service:ref.field==='port'?String(target?.ports[0]?.target??hint.endpoint):target?.environment[ref.key!]??'';
      const path=['services',hint.consumer,...(hint.injection==='build'?['build','args']:['environment']),m.key];let current=doc.getIn(path);
      if(!d.files.length&&m.owned&&hint.injection==='runtime'&&(current===''||current===undefined)&&value){doc.setIn(path,value);current=value;changed=true;}
      const managed=m.owned&&current===value;if(managed)owned.push({path,value});
      return {key:m.key,value:typeof current==='string'?current:value,reference:managed?ref:undefined,enabled:true,replace:false,secret:m.secret};
    });
    if(hint.ownsDependency&&consumer.depends[hint.provider]?.condition===hint.condition)owned.push({path:['services',hint.consumer,'depends_on',hint.provider],value:consumer.depends[hint.provider]});
    connections.push({...hint,mappings,owned,publicUrl:''});
  }
  return {...d,source:changed?doc.toString():d.source,connections};
}
