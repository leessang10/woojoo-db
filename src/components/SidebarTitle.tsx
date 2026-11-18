import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import './SidebarTitle.css';

export function SidebarTitle({ icon: Icon, title, action }: { icon: LucideIcon; title: string; action?: ReactNode }) {
  return <header className="workspace-sidebar-title"><Icon size={18} aria-hidden="true"/><h2>{title}</h2>{action}</header>;
}
