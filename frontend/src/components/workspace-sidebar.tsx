'use client';

import Link from 'next/link';

export type WorkspaceSidebarItem = {
  href: string;
  label: string;
  icon: string;
  disabled?: boolean;
};

export type WorkspaceSidebarUtilityItem = {
  href: string;
  label: string;
  icon: string;
  external?: boolean;
};

export function WorkspaceSidebar({
  tenantLabel,
  items,
  activePath,
}: {
  tenantLabel: string;
  items: WorkspaceSidebarItem[];
  activePath: string;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-kicker">BFF RAG Studio</span>
        <div className="sidebar-brand-row">
          <div className="sidebar-brand-mark">
            <span className="material-symbols-outlined">architecture</span>
          </div>
          <div className="sidebar-brand-copy">
            <div className="sidebar-brand-name">BFF RAG Studio</div>
            <div className="sidebar-brand-meta">
              TENANT: {tenantLabel.replaceAll('_', '-').toUpperCase()}
            </div>
          </div>
        </div>
      </div>

      <nav className="nav-list" aria-label="Primary">
        {items.map((item) => {
          const isActive = item.href !== '#' && activePath.startsWith(item.href);
          const className = `nav-link${isActive ? ' active' : ''}${item.disabled ? ' disabled' : ''}`;

          if (item.disabled) {
            return (
              <span key={item.label} className={className} aria-disabled="true">
                <span className="nav-icon material-symbols-outlined" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="nav-title">{item.label}</span>
              </span>
            );
          }

          return (
            <Link key={item.href} href={item.href} className={className}>
              <span className="nav-icon material-symbols-outlined" aria-hidden="true">
                {item.icon}
              </span>
              <span className="nav-title">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
