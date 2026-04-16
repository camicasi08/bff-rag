import type { ReactNode } from 'react';

export function WorkspaceHero({
  eyebrow,
  title,
  copy,
  meta,
  children,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="workspace-header workspace-hero">
      <div className="workspace-hero-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="page-title">{title}</h1>
        <p className="page-copy">{copy}</p>
      </div>
      <div className="workspace-hero-side">
        {meta ? <div className="pill-row">{meta}</div> : null}
        {children ? <div className="workspace-hero-panel">{children}</div> : null}
      </div>
    </header>
  );
}
