import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertDialog } from 'radix-ui';
import { Button } from './ui/button';
import { useLanguage } from '../i18n';

export type ConfirmOptions = { title?: string; confirmLabel?: string; destructive?: boolean };
type Request = ConfirmOptions & { message: string; resolve: (accepted: boolean) => void; trigger: HTMLElement | null };
type Confirmation = { requestConfirm: (message: string, options?: ConfirmOptions) => Promise<boolean>; confirming: boolean };
const Context = createContext<Confirmation | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [request, setRequest] = useState<Request | null>(null);
  const current = useRef<Request | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  function finish(accepted: boolean) {
    const pending = current.current;
    current.current = null;
    setRequest(null);
    pending?.resolve(accepted);
  }
  useEffect(() => () => { current.current?.resolve(false); current.current = null; }, []);
  function requestConfirm(message: string, options: ConfirmOptions = {}) {
    // Repeated shortcuts must not queue the same destructive operation.
    if (current.current) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const next = { ...options, message, resolve, trigger: trigger.current };
      current.current = next;
      setRequest(next);
    });
  }
  return <Context.Provider value={{ requestConfirm, confirming: !!request }}>
    {children}
    <AlertDialog.Root open={!!request} onOpenChange={open => { if (!open) finish(false); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-black/50" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[80] grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5 rounded-lg border bg-background p-6 text-foreground shadow-lg outline-none"
          onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }}>
          <div className="grid gap-2">
            <AlertDialog.Title className="text-base font-semibold">{request?.title ?? t('확인')}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{request?.message}</AlertDialog.Description>
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild><Button variant="outline" onClick={() => finish(false)}>{t('취소')}</Button></AlertDialog.Cancel>
            <AlertDialog.Action asChild><Button variant={request?.destructive ? 'destructive' : 'default'} onClick={() => finish(true)}>{request?.confirmLabel ?? t('확인')}</Button></AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </Context.Provider>;
}
export function useConfirm() {
  const value = useContext(Context);
  if (!value) throw new Error('ConfirmProvider is required');
  return value;
}
