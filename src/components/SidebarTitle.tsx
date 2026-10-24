import type { LucideIcon } from 'lucide-react';
import './SidebarTitle.css';

export function SidebarTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return <header className="workspace-sidebar-title"><Icon size={18} aria-hidden="true"/><h2>{title}</h2></header>;
}
