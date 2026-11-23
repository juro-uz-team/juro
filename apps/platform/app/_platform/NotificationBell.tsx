"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { platformLocaleValue } from "../../content/platform-ui";
import type { PlatformLocale } from "../../lib/platform/routing";
import { apiFetch } from "../_document-builder/_components/api-client";

export const notificationsChanged = "juro:notifications-changed";

export function refreshNotifications() {
  window.dispatchEvent(new Event(notificationsChanged));
}

export function NotificationBell({ locale, workspaceId, href, active }: {
  locale: PlatformLocale;
  workspaceId: string;
  href: string;
  active: boolean;
}) {
  const [unread, setUnread] = useState<number | null>(null);
  useEffect(() => {
    let pending: AbortController | undefined;
    const load = () => {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      void apiFetch<{ unreadCount: number }>("/api/document-builder/notifications?view=count", {
        cache: "no-store", headers: { "x-juro-workspace-id": workspaceId }, signal: controller.signal,
      }).then(result => {
        if (!controller.signal.aborted) setUnread(result.unreadCount);
      }).catch(() => {});
    };
    const refreshVisible = () => { if (!document.hidden) load(); };
    load();
    const timer = window.setInterval(refreshVisible, 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener(notificationsChanged, load);
    return () => {
      pending?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener(notificationsChanged, load);
    };
  }, [workspaceId]);

  const label = platformLocaleValue(locale, { ru: "Уведомления", uz: "Bildirishnomalar", en: "Notifications" });
  const description = unread === null ? "" : platformLocaleValue(locale, {
    ru: `Непрочитанные уведомления: ${unread}`,
    uz: `O‘qilmagan bildirishnomalar: ${unread}`,
    en: `Unread notifications: ${unread}`,
  });

  return <span className="platform-notification-bell">
    <Link href={href} aria-label={description || label} aria-current={active ? "page" : undefined}>
      <Bell aria-hidden="true" />
      {unread !== null && unread > 0 && <span className="platform-notification-count" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
    </Link>
    <span className="platform-notification-tooltip" aria-hidden="true">{description || label}</span>
    <span className="sr-only" role="status" aria-atomic="true">{description}</span>
  </span>;
}
