import { Fragment, useEffect, useRef } from 'react';
import { useLanguage } from './i18n';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
export type MenuItem = { label: string; action: () => void; disabled?: boolean; divider?: boolean };
export type MenuState = { x: number; y: number; items: MenuItem[]; trigger: HTMLElement };
export function ContextMenu({menu,onClose}:{menu:MenuState;onClose:()=>void}) {
 const {t}=useLanguage();const ref=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const dismiss=()=>close.current();const scroll=(e:Event)=>{if(!ref.current?.contains(e.target as Node))dismiss();};window.addEventListener('resize',dismiss);window.addEventListener('blur',dismiss);document.addEventListener('scroll',scroll,true);return()=>{window.removeEventListener('resize',dismiss);window.removeEventListener('blur',dismiss);document.removeEventListener('scroll',scroll,true);};},[]);
 return <DropdownMenu open modal={false} onOpenChange={open=>{if(!open)onClose();}}>
  <DropdownMenuTrigger aria-hidden tabIndex={-1} style={{position:'fixed',left:menu.x,top:menu.y,width:1,height:1,padding:0,opacity:0,pointerEvents:'none'}}/>
  <DropdownMenuContent ref={ref} align="start" sideOffset={0} collisionPadding={8} aria-label={t('컨텍스트 메뉴')} className="min-w-48 max-w-[calc(100vw-16px)] text-xs"
   onContextMenu={event=>event.preventDefault()}
   onCloseAutoFocus={event=>{event.preventDefault();if(menu.trigger.isConnected&&!document.querySelector('[role="alertdialog"]'))menu.trigger.focus({preventScroll:true});}}
   onFocusCapture={event=>{if(event.target===ref.current){const first=ref.current.querySelector<HTMLElement>('[role=menuitem]:not([data-disabled])');first?.focus();}}}
   onKeyDown={event=>{event.stopPropagation();if(event.key==='Tab'){event.preventDefault();onClose();}}}>
    {menu.items.map((item,index)=><Fragment key={index}>{item.divider&&<DropdownMenuSeparator/>}<DropdownMenuItem className="text-xs py-2" disabled={item.disabled} onSelect={()=>{onClose();menu.trigger.focus({preventScroll:true});item.action();}}>{item.label}</DropdownMenuItem></Fragment>)}
  </DropdownMenuContent>
 </DropdownMenu>;
}
