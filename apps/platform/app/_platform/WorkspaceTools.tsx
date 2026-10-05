"use client";

import Link from "next/link";
import { ArrowUpRight, Search, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { platformLocaleValue } from "../../content/platform-ui";
import type { PlatformLocale } from "../../lib/platform/routing";
import { activateDialogFocus } from "../../lib/platform/dialog-focus";

type Tool = readonly [string, LucideIcon, string, string, string];
type Group = {
  key: string;
  ru: string;
  uz: string;
  en: string;
  items: readonly Tool[];
};

export function WorkspaceTools({
  locale,
  base,
  groups,
  onClose,
  isActive,
}: {
  locale: PlatformLocale;
  base: string;
  groups: readonly Group[];
  onClose: () => void;
  isActive: (slug: string) => boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  const [query, setQuery] = useState("");
  const text = (copy: { ru: string; uz: string; en: string }) =>
    platformLocaleValue(locale, copy);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    const release = activateDialogFocus(dialog, {
      close: () => closeRef.current(),
      initialFocus: inputRef.current,
      returnFocus: previous,
    });
    return () => {
      dialog.close();
      release();
      document.body.style.overflow = overflow;
    };
  }, []);
  const filtered = groups
    .map((group) => ({
      ...group,
      items: group.items.filter(([, , ru, uz, en]) =>
        `${text(group)} ${ru} ${uz} ${en}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      ),
    }))
    .filter((group) => group.items.length);
  return (
    <dialog
      ref={dialogRef}
      className="workspace-tools"
      aria-labelledby="workspace-tools-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <div>
          <small>JURO</small>
          <h2 id="workspace-tools-title">
            {text({
              ru: "Все инструменты",
              uz: "Barcha vositalar",
              en: "All tools",
            })}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={text({ ru: "Закрыть", uz: "Yopish", en: "Close" })}
        >
          <X />
        </button>
      </header>
      <label className="workspace-tools-search">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={text({
            ru: "Что вы хотите сделать?",
            uz: "Nima qilmoqchisiz?",
            en: "What would you like to do?",
          })}
          aria-label={text({
            ru: "Найти инструмент",
            uz: "Vosita qidirish",
            en: "Find a tool",
          })}
        />
      </label>
      <div className="workspace-tools-groups">
        {filtered.map((group) => (
          <section key={group.key}>
            <h3>{text(group)}</h3>
            {group.items.map(([slug, Icon, ru, uz, en]) => (
              <Link
                key={slug}
                href={`${base}/${slug}`}
                onClick={onClose}
                aria-current={isActive(slug) ? "page" : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{text({ ru, uz, en })}</span>
                <ArrowUpRight aria-hidden="true" />
              </Link>
            ))}
          </section>
        ))}
      </div>
      {!filtered.length && (
        <p className="workspace-tools-empty" role="status">
          {text({
            ru: "Ничего не найдено. Попробуйте другое название.",
            uz: "Hech narsa topilmadi. Boshqa nom bilan qidiring.",
            en: "No tools found. Try another name.",
          })}
        </p>
      )}
    </dialog>
  );
}
