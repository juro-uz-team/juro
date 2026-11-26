"use client";

import { X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { PlatformLocale } from "../../../lib/platform/routing";

export function BuilderToolDialog({ icon: Icon, label, locale, children }: {
  icon: LucideIcon;
  label: string;
  locale: PlatformLocale;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  const close = () => dialog.current?.close();
  return <>
    <button ref={trigger} type="button" className="dbt-tool-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Icon size={17} aria-hidden="true" />{label}
    </button>
    {open && <dialog ref={dialog} className="dbt-tool-dialog" aria-labelledby={titleId} onClose={() => {
      setOpen(false);
      trigger.current?.focus();
    }}>
      <header>
        <h2 id={titleId}><Icon size={20} aria-hidden="true" />{label}</h2>
        <button type="button" className="dbt-tool-close" onClick={close} aria-label={{ ru: "Закрыть", uz: "Yopish", en: "Close" }[locale]}><X size={19} /></button>
      </header>
      <div className="dbt-tool-body">{children(close)}</div>
    </dialog>}
  </>;
}
