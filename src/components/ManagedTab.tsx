import { useState, type ReactNode, type MouseEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ModalSurface } from './ModalSurface';
import { ContextMenu, type MenuState } from '../ContextMenu';
import { useLanguage } from '../i18n';

export function reorderTabs<T extends { id: string }>(tabs: T[], source: string, target: string, after: boolean): T[] {
  const item = tabs.find(tab => tab.id === source);
  if (!item || source === target || !tabs.some(tab => tab.id === target)) return tabs;
  const rest = tabs.filter(tab => tab.id !== source);
  rest.splice(rest.findIndex(tab => tab.id === target) + (after ? 1 : 0), 0, item);
  return rest;
}

/** Pointer drag, keyboard menu and rename use the same tab identity. */
export function ManagedTab({ id, name, active, ids, onRename, onReorder, children }: {
  id: string; name: string; active: boolean; ids: string[]; children: ReactNode;
  onRename: (name: string) => void; onReorder: (source: string, target: string, after: boolean) => void;
}) {
  const { language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState(false), [draft, setDraft] = useState(name);
  const [drop, setDrop] = useState<'before' | 'after'>();
  function open(event: MouseEvent<HTMLElement>) {
    event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
    const index = ids.indexOf(id);
    setMenu({ x: rect.left, y: rect.bottom, trigger: event.currentTarget, items: [
      { label: tr('이름 바꾸기', 'Rename'), action: () => { setDraft(name); setRenaming(true); } },
      { label: tr('왼쪽으로 이동', 'Move left'), disabled: index <= 0, action: () => onReorder(id, ids[index - 1], false) },
      { label: tr('오른쪽으로 이동', 'Move right'), disabled: index >= ids.length - 1, action: () => onReorder(id, ids[index + 1], true) },
    ] });
  }
  return <div className={`tab-item ${active ? 'active' : ''} ${drop ? `drop-${drop}` : ''}`} data-managed-tab={id} draggable onContextMenu={open}
    onDragStart={event => { event.dataTransfer.setData('application/woojoo-tab', id); event.dataTransfer.effectAllowed = 'move'; }}
    onDragOver={event => { if (!event.dataTransfer.types.includes('application/woojoo-tab')) return; event.preventDefault(); setDrop(event.clientX > event.currentTarget.getBoundingClientRect().left + event.currentTarget.clientWidth / 2 ? 'after' : 'before'); }}
    onDragLeave={() => setDrop(undefined)} onDragEnd={() => setDrop(undefined)}
    onDrop={event => { event.preventDefault(); onReorder(event.dataTransfer.getData('application/woojoo-tab'), id, drop === 'after'); setDrop(undefined); }}>
    {children}
    <Button variant="ghost" size="bare" className="tab-more" aria-label={`${name} · ${tr('탭 메뉴', 'Tab menu')}`} onClick={open}><MoreHorizontal size={13}/></Button>
    {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)}/>}
    {renaming && <ModalSurface title={tr('탭 이름 변경', 'Rename tab')} onClose={() => setRenaming(false)}>
      <form className="modal" style={{width:360,maxWidth:'calc(100vw - 32px)'}} onSubmit={event => { event.preventDefault(); if (draft.trim()) { onRename(draft.trim()); setRenaming(false); } }}>
        <h2>{tr('탭 이름 변경', 'Rename tab')}</h2><label>{tr('이름', 'Name')}<Input autoFocus maxLength={200} value={draft} onChange={event => setDraft(event.target.value)}/></label>
        <div className="modal-actions"><Button type="button" variant="outline" onClick={() => setRenaming(false)}>{tr('취소', 'Cancel')}</Button><Button type="submit" disabled={!draft.trim()}>{tr('저장', 'Save')}</Button></div>
      </form>
    </ModalSurface>}
  </div>;
}
