import { stringify } from 'yaml';
import { createProject, readProject } from './document';
import type { ProjectDraft } from './types';

export interface PersistedDraft { version: 1; id: string; name: string; context: string; files: string[]; positions: ProjectDraft['positions']; structure?: Record<string, unknown>; needsInput: boolean }
const safeName = (s: string) => /^[a-zA-Z0-9_.\-/]+$/.test(s);
export function safeDraft(d: ProjectDraft): PersistedDraft {
  const base: PersistedDraft = {version:1,id:d.id,name:d.name,context:d.context,files:d.files.map(f=>f.path),positions:d.positions,needsInput:true};
  if (d.files.length) return base;
  const v = readProject(d.source);
  base.structure = {
    services:Object.fromEntries(v.services.map(s => [s.key, {
      ...(safeName(s.image) || /^[\w./-]+:[\w.-]+$/.test(s.image) ? {image:s.image} : {}),
      ...(s.build ? {build:{context:s.build.context,dockerfile:s.build.dockerfile}} : {}),
      networks:s.networks, ports:s.ports.filter(p=>Number.isInteger(p.target)).map(p=>({target:p.target,...(p.published?{published:p.published}:{}),...(p.hostIp?{host_ip:p.hostIp}:{}),protocol:p.protocol})),
      volumes:s.mounts.map(m=>({type:m.type,...(m.source?{source:m.source}:{}),target:m.target,read_only:m.readOnly})),
      environment:Object.fromEntries(Object.keys(s.environment).map(k=>[k,''])),
      ...(Object.keys(s.depends).length ? {depends_on:s.depends} : {}), restart:s.restart,
    }])),
    networks:Object.fromEntries(v.networks.map(n=>[n.key,n.external?{external:true,name:n.name??n.key}:{}])),
    volumes:Object.fromEntries(v.volumes.map(n=>[n.key,n.external?{external:true,name:n.name??n.key}:{}])),
  };
  return base;
}
export function restoreDraft(s: PersistedDraft): ProjectDraft {
  return {...createProject(s.structure ? stringify(s.structure) : undefined),id:s.id,name:s.name,context:s.context,positions:s.positions??{},needsInput:s.needsInput,files:s.files.map(path=>({path,original:'',source:''}))};
}
