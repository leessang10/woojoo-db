import { cloneElement, useRef, type ReactElement, type ReactNode } from 'react';
import { Dialog as Primitive } from 'radix-ui';
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '@/components/ui/dialog';

// Preserve form semantics and existing localized headings while Radix owns focus and dismissal.
export function ModalSurface({children,title,onClose,locked=false}:{children:ReactElement<{children?:ReactNode;className?:string}>;title:string;onClose:()=>void;locked?:boolean}) {
 const trigger=useRef(document.activeElement instanceof HTMLElement?document.activeElement:null);
 return <Dialog open onOpenChange={open=>{if(!open&&!locked)onClose();}}><DialogPortal><DialogOverlay/>
  <Primitive.Content asChild aria-describedby={undefined} onOpenAutoFocus={event=>{
    const auto=document.querySelector<HTMLElement>('[data-modal-content] [autofocus]');if(auto){event.preventDefault();auto.focus();}
  }} onCloseAutoFocus={event=>{event.preventDefault();if(trigger.current?.isConnected)trigger.current.focus({preventScroll:true});}}
  onEscapeKeyDown={event=>{if(locked)event.preventDefault();}}
  onInteractOutside={event=>event.preventDefault()} data-modal-content data-slot="dialog-content"
  className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none">
   {cloneElement(children,{},<><DialogTitle asChild><span className="sr-only">{title}</span></DialogTitle>{children.props.children}</>)}
  </Primitive.Content>
 </DialogPortal></Dialog>;
}
