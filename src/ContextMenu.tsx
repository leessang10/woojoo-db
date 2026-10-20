import { useLayoutEffect, useRef, useState } from 'react';
import { useLanguage } from './i18n';

export type MenuItem = { label: string; action: () => void; disabled?: boolean; divider?: boolean };
export type MenuState = { x: number; y: number; items: MenuItem[]; trigger: HTMLElement };

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });
  useLayoutEffect(() => {
    const element = ref.current!;
    const bounds = element.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8)),
    });
    (element.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? element).focus();
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close.current();
    };
    const dismiss = () => close.current();
    const scroll = (event: Event) => { if (!element.contains(event.target as Node)) dismiss(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    document.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      document.removeEventListener('scroll', scroll, true);
      if (menu.trigger.isConnected) menu.trigger.focus({ preventScroll: true });
    };
  }, [menu]);
  return <div ref={ref} tabIndex={-1} className="context-menu" role="menu" aria-label={t('컨텍스트 메뉴')}
    style={{ left: position.x, top: position.y }} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      event.stopPropagation();
      const items = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
    {menu.items.map((item, index) => <div key={index}>
      {item.divider && <div role="separator"/>}
      <button role="menuitem" disabled={item.disabled} onClick={() => { onClose(); item.action(); }}>{item.label}</button>
    </div>)}
  </div>;
}
