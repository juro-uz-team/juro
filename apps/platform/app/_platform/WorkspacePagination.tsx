"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { PlatformLocale } from "../../lib/platform/routing";
import "./workspace-title.css";

export function useWorkspacePagination(total: number, size: number, filter = "", initialPage = 0) {
  const [selection, setSelection] = useState<{ page: number; filter: string }>();
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(selection?.filter === filter ? selection.page : initialPage, pages - 1);
  return { page, pages, from: page * size, to: (page + 1) * size,
    setPage: (next: number) => setSelection({ page: next, filter }) };
}

const labels = {
  ru: ["Страницы", "Назад", "Далее"],
  uz: ["Sahifalar", "Oldingi", "Keyingi"],
  en: ["Pages", "Previous", "Next"],
} as const;

export function WorkspacePagination({ locale, page, pages, setPage, label }: {
  locale: PlatformLocale; page: number; pages: number; setPage: (page: number) => void; label?: string;
}) {
  if (pages <= 1) return null;
  const [title, previous, next] = labels[locale];
  return <nav className="workspace-pagination" aria-label={label || title}>
    <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft aria-hidden="true" />{previous}</button>
    <span role="status">{page + 1} / {pages}</span>
    <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{next}<ChevronRight aria-hidden="true" /></button>
  </nav>;
}
