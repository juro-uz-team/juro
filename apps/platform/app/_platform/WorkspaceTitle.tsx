import type { ReactNode, Ref } from "react";
import "./workspace-title.css";

export function WorkspaceTitle({ icon, title, description, actions, id, headerRef }: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  headerRef?: Ref<HTMLElement>;
}) {
  return <header className="workspace-title" ref={headerRef}>
    <span className="workspace-title-mark" aria-hidden="true">{icon}</span>
    <div className="workspace-title-copy">
      <h1 id={id}>{title}</h1>
      {description && <div className="workspace-title-description">{description}</div>}
    </div>
    {actions && <div className="workspace-title-actions">{actions}</div>}
  </header>;
}
