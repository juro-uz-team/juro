"use client";

import { WorkspacePagination, useWorkspacePagination } from "../../_platform/WorkspacePagination";
import { WorkspaceTitle } from "../../_platform/WorkspaceTitle";
import { notificationsChanged, refreshNotifications } from "../../_platform/NotificationBell";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Check, CheckCheck, ChevronRight, FileCheck2, Inbox, LoaderCircle, MessageSquareText, Scale, UserRoundCheck } from "lucide-react";
import type { NotificationRecord } from "../../../lib/document-builder/types";
import type { WebsiteNotificationPreferences } from "../../../lib/platform/website-notifications";
import { builderNavigationPaths } from "../../../lib/platform/builder-paths";
import { workspaceCopy } from "../../../lib/platform/builder-workspace-copy";
import { usePlatformBasePath, usePlatformWorkspaceId } from "../../_platform/PlatformRouteContext";
import { apiFetch } from "../_components/api-client";
import { builderError, builderIntlLocale, builderText, builderUiLocale } from "../builder-localization";
import { WebsiteNotificationSettings } from "./WebsiteNotificationSettings";
import "./notifications.css";

const EN_NOTIFICATION_COPY: Readonly<Record<string, { title: string; body: string }>> = {
  invitation: { title: "Document invitation", body: "You were invited to review a document." },
  invitation_opened: { title: "Invitation opened", body: "The invited participant opened the document." },
  comment_added: { title: "New comment", body: "A participant added a comment to the document." },
  change_proposed: { title: "Change proposed", body: "A participant proposed a document change." },
  change_confirmed: { title: "Change reviewed", body: "A participant reviewed the proposed change." },
  agreement_rejected: { title: "Change declined", body: "A participant declined the proposed change." },
  agreement_completed: { title: "Document details confirmed", body: "The other party confirmed the document details." },
  lawyer_document_requested: { title: "Document requested", body: "Your lawyer requested a document." },
  lawyer_document_provided: { title: "Document shared", body: "A client shared a requested document." },
  lawyer_task_created: { title: "New lawyer task", body: "Your lawyer added a task." },
  lawyer_task_completed: { title: "Lawyer task completed", body: "A lawyer task was marked as completed." },
};

function notificationPresentation(item: NotificationRecord, locale: string | null) {
  if (locale !== "en") return { title: item.title, body: item.body };
  if (item.type === "legislation_monitor") return { title: "Lex.uz legislation update", body: item.body };
  const translated = EN_NOTIFICATION_COPY[item.type];
  if (translated) return translated;
  const containsLegacyCopy = /[А-Яа-яЁёЎўҚқҒғҲҳ]/.test(`${item.title} ${item.body}`);
  return containsLegacyCopy
    ? { title: "Workspace update", body: "Open the related item to view the latest activity." }
    : { title: item.title, body: item.body };
}

export function NotificationsClient() {
  const workspaceId = usePlatformWorkspaceId();
  return <NotificationsInbox key={workspaceId} workspaceId={workspaceId} />;
}

function NotificationsInbox({ workspaceId }: { workspaceId: string }) {
  const paths = builderNavigationPaths(usePathname());
  const base = usePlatformBasePath();
  const locale = builderUiLocale(paths.locale);
  const copy = workspaceCopy(locale).notifications;
  const inline = <T,>(ru: T, uz: T, en: T) => builderText(locale, { ru, uz, en });
  const loadError = inline("Не удалось загрузить уведомления.", "Bildirishnomalarni yuklab bo‘lmadi.", "We could not load your notifications.");
  const dateLocale = builderIntlLocale(locale);
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferences, setPreferences] = useState<WebsiteNotificationPreferences | null>(null);
  const [loadedView, setLoadedView] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<string | "all" | null>(null);
  const [notice, setNotice] = useState("");
  const requestSequence = useRef(0);
  const load = useCallback(async (background = false) => {
    const sequence = ++requestSequence.current;
    if (!background) setLoading(true);
    try {
      const result = await apiFetch<{ notifications: NotificationRecord[]; unreadCount: number; preferences: WebsiteNotificationPreferences }>(`/api/document-builder/notifications?view=${unreadOnly ? "unread" : "all"}`, {
        cache: "no-store", headers: { "x-juro-workspace-id": workspaceId },
      });
      if (sequence !== requestSequence.current) return;
      setItems(result.notifications);
      setUnreadCount(result.unreadCount);
      setPreferences(result.preferences);
      setLoadedView(unreadOnly);
      setError("");
    } catch (caught) {
      if (sequence === requestSequence.current) setError(builderError(locale, caught, loadError));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [locale, loadError, unreadOnly, workspaceId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const refresh = () => { if (!document.hidden) void load(true); };
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(notificationsChanged, refresh);
    return () => {
      requestSequence.current += 1;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(notificationsChanged, refresh);
    };
  }, [load]);
  const mark = async (id?: string) => {
    if (marking !== null) return;
    const target = id ?? "all";
    setMarking(target);
    try {
      await apiFetch("/api/document-builder/notifications", {
        method: "PATCH", headers: { "x-juro-workspace-id": workspaceId }, keepalive: true,
        body: JSON.stringify(id ? { id } : { all: true }),
      });
      setNotice(id
        ? inline("Уведомление прочитано.", "Bildirishnoma o‘qildi.", "Notification marked as read.")
        : inline("Все уведомления прочитаны.", "Barcha bildirishnomalar o‘qildi.", "All notifications marked as read."));
      refreshNotifications();
    } catch (caught) {
      setError(builderError(locale, caught, inline("Не удалось обновить уведомление.", "Bildirishnomani yangilab bo‘lmadi.", "We could not update the notification.")));
    } finally {
      setMarking(null);
    }
  };
  const visible = loadedView === unreadOnly ? items : [];
  const pendingView = loading || (loadedView !== unreadOnly && !error);
  const pagination = useWorkspacePagination(visible.length, 6, unreadOnly ? "unread" : "all");
  const dateFormat = new Intl.DateTimeFormat(dateLocale, { dateStyle: "medium", timeStyle: "short" });
  const allLabel = inline("Все", "Barchasi", "All");
  const unreadLabel = inline("Непрочитанные", "O‘qilmaganlar", "Unread");
  return <section className="notifications-workspace workspace-page">
    <WorkspaceTitle icon={<Bell />} title={copy.title} />
    <p className="sr-only" aria-live="polite">{notice}</p>
    <WebsiteNotificationSettings locale={locale} workspaceId={workspaceId} preferences={preferences} onSaved={value => {
      setPreferences(value);
      refreshNotifications();
    }} />
    <section className="notifications-inbox" aria-label={copy.title} aria-busy={pendingView || marking !== null}>
      <div className="notifications-toolbar">
        <div className="notifications-filters" role="group" aria-label={inline("Фильтр уведомлений", "Bildirishnoma filtri", "Filter notifications")}>
          <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>{allLabel}</button>
          <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>
            {unreadLabel}{unreadCount > 0 && <span className="notifications-count">{unreadCount}</span>}
          </button>
        </div>
        {(unreadCount > 0 || visible.some(item => !item.readAt)) && <button type="button" className="notifications-mark-all" disabled={pendingView || marking !== null} onClick={() => void mark()}>
          {marking === "all" ? <LoaderCircle aria-hidden="true" className="spin" /> : <CheckCheck aria-hidden="true" />}
          {copy.readAll}
        </button>}
      </div>
      {error && <div className="notifications-feedback" role="alert"><span>{error}</span>
        <button type="button" onClick={() => void load()} disabled={loading}>{inline("Повторить", "Qayta urinish", "Try again")}</button>
      </div>}
      {pendingView ? <p className="notifications-feedback" role="status"><LoaderCircle aria-hidden="true" className="spin" />{inline("Загружаем уведомления…", "Bildirishnomalar yuklanmoqda…", "Loading notifications…")}</p>
        : visible.length ? <>
          <ul className="notifications-list">
            {visible.slice(pagination.from, pagination.to).map(item => {
              const isMonitoring = item.type === "legislation_monitor";
              const Icon = isMonitoring ? Scale : item.type.includes("comment") ? MessageSquareText
                : item.type.includes("confirm") || item.type.includes("agreement") ? UserRoundCheck : FileCheck2;
              const content = notificationPresentation(item, locale);
              const markOnOpen = () => { if (!item.readAt) void mark(item.id); };
              return <li key={item.id} data-unread={!item.readAt}>
                <span className="notifications-icon"><Icon aria-hidden="true" /></span>
                <div className="notifications-entry">
                  <h2>{!item.readAt && <span className="sr-only">{unreadLabel}. </span>}{content.title}</h2>
                  {content.body && <p>{content.body}</p>}
                  <time dateTime={item.createdAt}>{dateFormat.format(new Date(item.createdAt))}</time>
                </div>
                <div className="notifications-entry-actions">
                  {item.documentId && <Link href={paths.document(item.documentId)} onClick={markOnOpen}>{copy.openDocument}<ChevronRight aria-hidden="true" /></Link>}
                  {isMonitoring && <Link href={`${base}/monitoring`} onClick={markOnOpen}>{inline("Открыть мониторинг", "Monitoringni ochish", "Open monitoring")}<ChevronRight aria-hidden="true" /></Link>}
                  {!item.readAt && <button type="button" aria-label={`${copy.markRead} · ${content.title}`} title={copy.markRead}
                    disabled={marking !== null} onClick={() => void mark(item.id)}>
                    {marking === item.id ? <LoaderCircle aria-hidden="true" className="spin" /> : <Check aria-hidden="true" />}
                    <span>{copy.markRead}</span>
                  </button>}
                </div>
              </li>;
            })}
          </ul>
          {pagination.pages > 1 && <div className="notifications-pagination"><WorkspacePagination locale={locale} {...pagination} /></div>}
        </> : !error && <div className="notifications-empty">
          <span className="notifications-icon">{unreadOnly ? <CheckCheck aria-hidden="true" /> : <Inbox aria-hidden="true" />}</span>
          <div>
            <h2>{unreadOnly
              ? preferences?.enabled === false
                ? inline("Уведомления на сайте приостановлены", "Saytdagi bildirishnomalar to‘xtatilgan", "Website notifications are paused")
                : inline("Нет непрочитанных уведомлений", "O‘qilmagan bildirishnomalar yo‘q", "No unread notifications")
              : copy.emptyTitle}</h2>
            {unreadOnly ? <button type="button" onClick={() => setUnreadOnly(false)}>
              {inline("Показать все уведомления", "Barcha bildirishnomalarni ko‘rish", "Show all notifications")}
            </button> : <p>{inline("Здесь появятся действия по документам и обновления законодательства, на которые вы подписались.", "Hujjatlar bo‘yicha hodisalar va siz obuna bo‘lgan qonunchilik yangiliklari shu yerda ko‘rinadi.", "Document activity and legislation updates you follow will appear here.")}</p>}
          </div>
        </div>}
    </section>
  </section>;
}
