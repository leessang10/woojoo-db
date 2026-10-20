import { useRef, useState, type ReactElement } from 'react';
import { Popover } from 'radix-ui';
import { Check, Database, Plus, Search } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { useLanguage } from './i18n';
import type { Profile } from './model';

type Connection = { profile: Profile; session: string };
export function ConnectionSwitcher({ connections, active, onSelect, onAdd, children }: {
  connections: Connection[]; active: string; onSelect: (session: string) => void;
  onAdd: () => void; children: ReactElement;
}) {
  const {language}=useLanguage();
  const tr=(ko:string,en:string)=>language==='ko'?ko:en;
  const [open,setOpen]=useState(false),[search,setSearch]=useState('');
  const input=useRef<HTMLInputElement>(null);
  const filtered=connections.filter(({profile})=>[profile.name,profile.group,profile.environment,profile.engine,profile.host,profile.database].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  return <Popover.Root open={open} onOpenChange={value=>{setOpen(value);setSearch('');}}>
    <Popover.Trigger asChild>{children}</Popover.Trigger>
    <Popover.Portal><Popover.Content className="connection-picker" align="start" sideOffset={6} collisionPadding={12}
      aria-label={tr('연결 전환','Switch connection')}
      onOpenAutoFocus={event=>{event.preventDefault();input.current?.focus();}}
      onKeyDown={event=>{
        if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
        const rows=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-connection-option]'));
        if(!rows.length)return;
        event.preventDefault();
        const index=rows.indexOf(document.activeElement as HTMLButtonElement);
        const next=index<0?(event.key==='ArrowDown'?0:rows.length-1):(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;
        rows[next].focus();
      }}>
      <div className="connection-picker-search"><Search size={15}/><Input ref={input} aria-label={tr('연결 검색','Search connections')} placeholder={tr('이름, 그룹, 주소 검색','Search name, group, or host')} value={search} onChange={event=>setSearch(event.target.value)}/></div>
      <div className="connection-picker-list">
        {filtered.map(c=><Button key={c.session} variant="ghost" size="bare" data-connection-option aria-pressed={active===c.session} className="connection-picker-option" onClick={()=>{setOpen(false);setSearch('');onSelect(c.session);}}>
          <Database size={16}/><span className="connection-picker-description"><strong>{c.profile.name}</strong><small>{[c.profile.group,c.profile.environment,c.profile.engine,c.profile.readOnly?'RO':null].filter(Boolean).join(' · ')}</small></span>
          <span className={`live-dot ${c.session.startsWith('saved:')?'offline':''}`}/>{active===c.session?<Check size={15}/>:<span className="connection-picker-check"/>}
        </Button>)}
        {!filtered.length&&<p className="connection-picker-empty">{tr('일치하는 연결이 없습니다.','No matching connections.')}</p>}
      </div>
      <div className="connection-picker-footer"><Button variant="ghost" size="sm" onClick={()=>{setOpen(false);onAdd();}}><Plus size={14}/>{tr('연결 추가','Add connection')}</Button></div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
