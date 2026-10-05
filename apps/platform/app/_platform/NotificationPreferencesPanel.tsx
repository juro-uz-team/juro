"use client";

/* eslint-disable react-hooks/set-state-in-effect -- preferences must hydrate after authenticated browser render. */

import { accountSettingsCopy } from "./account-settings-copy";

import { BellRing, LoaderCircle, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { PlatformLocale } from "../../lib/platform/routing";

const keys = [
  "marketing_email",
  "weekly_case_summary",
  "unfinished_document",
  "comments",
  "lawyer_request_updates",
] as const;

type PreferenceKey = typeof keys[number];
type Preferences = Record<PreferenceKey, boolean>;

const emptyPreferences: Preferences = {
  marketing_email: false,
  weekly_case_summary: false,
  unfinished_document: false,
  comments: false,
  lawyer_request_updates: false,
};

const preferenceCopy = {
  ru: {
    marketing_email: { title: "Новости и предложения", description: "Обновления продукта, юридические материалы и специальные предложения." },
    weekly_case_summary: { title: "Еженедельная сводка по делам", description: "Напоминание об открытых делах, задачах и ближайших сроках." },
    unfinished_document: { title: "Незавершённые документы", description: "Напоминания о черновиках, которые ещё не отправлены или не подписаны." },
    comments: { title: "Комментарии и предложения", description: "Email-уведомления о новых комментариях и предложениях в общих документах." },
    lawyer_request_updates: { title: "Заявки юристам", description: "Изменения статуса заявки, предложения и сообщения от выбранного юриста." },
  },
  uz: {
    marketing_email: { title: "Yangiliklar va takliflar", description: "Mahsulot yangiliklari, yuridik materiallar va maxsus takliflar." },
    weekly_case_summary: { title: "Ishlar bo‘yicha haftalik xulosa", description: "Ochiq ishlar, vazifalar va yaqin muddatlar haqida eslatma." },
    unfinished_document: { title: "Tugallanmagan hujjatlar", description: "Hali yuborilmagan yoki imzolanmagan qoralamalar haqida eslatma." },
    comments: { title: "Izohlar va takliflar", description: "Umumiy hujjatlardagi yangi izoh va takliflar haqida email xabarlari." },
    lawyer_request_updates: { title: "Yuristga so‘rovlar", description: "So‘rov holati, takliflar va tanlangan yurist xabarlari o‘zgarishi." },
  },
  en: {
    marketing_email: { title: "News and offers", description: "Product updates, legal materials and occasional special offers." },
    weekly_case_summary: { title: "Weekly matter summary", description: "A digest of open matters, tasks and approaching deadlines." },
    unfinished_document: { title: "Unfinished documents", description: "Reminders about drafts that have not yet been sent or signed." },
    comments: { title: "Comments and suggestions", description: "Email updates about new comments and suggestions in shared documents." },
    lawyer_request_updates: { title: "Lawyer requests", description: "Status changes, proposals and messages from your selected lawyer." },
  },
} as const;

const panelCopy = {
  ru: { loadFailed: "Не удалось загрузить настройки уведомлений.", saveFailed: "Настройки не сохранены.", saved: "Настройки уведомлений сохранены.", title: "Email-уведомления", description: "Выберите только необязательные письма. Коды входа, сообщения о безопасности, доступе юриста, анализе и критических сроках остаются включёнными.", loading: "Загрузка настроек…", legend: "Необязательные email-уведомления", save: "Сохранить уведомления" },
  uz: { loadFailed: "Bildirishnoma sozlamalarini yuklab bo‘lmadi.", saveFailed: "Sozlamalar saqlanmadi.", saved: "Bildirishnoma sozlamalari saqlandi.", title: "Email bildirishnomalari", description: "Faqat ixtiyoriy xatlarni tanlang. Kirish kodlari, xavfsizlik, yurist ruxsati, tahlil va muhim muddatlar haqidagi xatlar yoqilgan holda qoladi.", loading: "Sozlamalar yuklanmoqda…", legend: "Ixtiyoriy email bildirishnomalari", save: "Bildirishnomalarni saqlash" },
  en: { loadFailed: "We could not load your notification settings.", saveFailed: "We could not save your notification settings.", saved: "Notification settings saved.", title: "Email notifications", description: "Choose only optional emails. Sign-in codes and essential security, lawyer-access, analysis and critical-deadline messages always remain enabled.", loading: "Loading notification settings…", legend: "Optional email notifications", save: "Save notifications" },
} as const;

export function NotificationPreferencesPanel({ locale }: { locale: PlatformLocale }) {
  const copy = panelCopy[locale];
  const ui = accountSettingsCopy[locale];
  const [savedPreferences, setSavedPreferences] = useState<Preferences | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(emptyPreferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dirty = savedPreferences !== null && keys.some(key => savedPreferences[key] !== preferences[key]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/platform/notification-preferences", {
        cache: "no-store",
        headers: { "x-juro-locale": locale },
      });
      const body = await response.json() as { preferences?: Preferences; error?: string };
      if (!response.ok || !body.preferences) throw new Error(body.error || copy.loadFailed);
      setPreferences(body.preferences);
      setSavedPreferences(body.preferences);
    } catch (value) {
      setError(value instanceof Error ? value.message : copy.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailed, locale]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/platform/notification-preferences", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-juro-csrf": "1",
          "x-juro-locale": locale,
        },
        body: JSON.stringify({ preferences }),
      });
      const body = await response.json() as { preferences?: Preferences; error?: string };
      if (!response.ok || !body.preferences) throw new Error(body.error || copy.saveFailed);
      setPreferences(body.preferences);
      setSavedPreferences(body.preferences);
      setMessage(copy.saved);
    } catch (value) {
      setError(value instanceof Error ? value.message : copy.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return <section className="notification-preferences-panel" aria-busy={loading || saving}>
    <h2><BellRing aria-hidden="true" />{copy.title}</h2>
    <p>{copy.description}</p>
    {loading ? <p className="notification-preferences-state" role="status"><LoaderCircle className="spin" aria-hidden="true" />{copy.loading}</p> : <fieldset className="notification-preferences-list">
      <legend className="sr-only">{copy.legend}</legend>
      {keys.map((key) => <label key={key}>
        <input type="checkbox" checked={preferences[key]} onChange={(event) => { setPreferences(current => ({ ...current, [key]: event.target.checked })); setMessage(""); }} disabled={saving || savedPreferences === null} />
        <span><strong>{preferenceCopy[locale][key].title}</strong><small>{preferenceCopy[locale][key].description}</small></span>
      </label>)}
    </fieldset>}
    {error && <p className="notification-preferences-state error" role="alert">{error} <button type="button" className="account-button secondary" onClick={() => void load()} disabled={loading || saving}>{ui.retry}</button></p>}
    {message && <p className="notification-preferences-state success" role="status">{message}</p>}
    <footer className="account-save-bar"><span>{dirty ? ui.unsaved : ui.saved}</span><div>
      {dirty && <button type="button" className="account-button secondary" disabled={saving} onClick={() => { if (savedPreferences) setPreferences(savedPreferences); setError(""); setMessage(""); }}>{ui.discard}</button>}
      <button type="button" className="account-button" onClick={() => void save()} disabled={loading || saving || !dirty} aria-busy={saving}>{saving ? <LoaderCircle className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}{copy.save}</button>
    </div></footer>
  </section>;
}
