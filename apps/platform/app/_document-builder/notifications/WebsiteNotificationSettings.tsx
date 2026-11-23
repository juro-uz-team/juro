"use client";

import { ChevronDown, LoaderCircle, Settings2 } from "lucide-react";
import { useState } from "react";
import type { PlatformLocale } from "../../../lib/platform/routing";
import type { WebsiteNotificationPreferences } from "../../../lib/platform/website-notifications";
import { apiFetch } from "../_components/api-client";
import { builderError } from "../builder-localization";

const settingsCopy = {
  ru: {
    title: "Уведомления на сайте", enabled: "Включены", paused: "Приостановлены",
    master: "Показывать непрочитанные уведомления", hint: "Настройки действуют в этом пространстве. Скрытые уведомления доступны во вкладке «Все».",
    documents: "Действия с документами", legislation: "Обновления законодательства", workspace: "Другие события пространства",
    save: "Сохранить настройки", saved: "Настройки сохранены.", error: "Не удалось сохранить настройки уведомлений.",
  },
  uz: {
    title: "Saytdagi bildirishnomalar", enabled: "Yoqilgan", paused: "To‘xtatilgan",
    master: "O‘qilmagan bildirishnomalarni ko‘rsatish", hint: "Sozlamalar shu ish maydoniga tegishli. Yashirilgan bildirishnomalar «Barchasi» bo‘limida qoladi.",
    documents: "Hujjatlar bo‘yicha faollik", legislation: "Qonunchilik yangiliklari", workspace: "Ish maydonidagi boshqa hodisalar",
    save: "Sozlamalarni saqlash", saved: "Sozlamalar saqlandi.", error: "Bildirishnoma sozlamalarini saqlab bo‘lmadi.",
  },
  en: {
    title: "Website notifications", enabled: "On", paused: "Paused",
    master: "Show unread alerts", hint: "These settings apply to this workspace. Muted notifications stay available in All.",
    documents: "Document activity", legislation: "Legislation updates", workspace: "Other workspace activity",
    save: "Save settings", saved: "Settings saved.", error: "We could not save your notification settings.",
  },
} as const;

const categories = ["documents", "legislation", "workspace"] as const;

export function WebsiteNotificationSettings({ locale, workspaceId, preferences, onSaved }: {
  locale: PlatformLocale;
  workspaceId: string;
  preferences: WebsiteNotificationPreferences | null;
  onSaved: (value: WebsiteNotificationPreferences) => void;
}) {
  const copy = settingsCopy[locale];
  const [draft, setDraft] = useState<WebsiteNotificationPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const value = draft ?? preferences;
  const dirty = value && preferences && (["enabled", ...categories] as const).some(key => value[key] !== preferences[key]);

  async function save() {
    if (!value || !dirty || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<{ preferences: WebsiteNotificationPreferences }>("/api/document-builder/notifications", {
        method: "PUT", headers: { "x-juro-workspace-id": workspaceId, "x-juro-locale": locale }, body: JSON.stringify(value),
      });
      setDraft(null);
      setMessage(copy.saved);
      onSaved(result.preferences);
    } catch (caught) {
      setError(builderError(locale, caught, copy.error));
    } finally {
      setSaving(false);
    }
  }

  const toggle = (key: keyof WebsiteNotificationPreferences, label: string, disabled = false) => <label className="notifications-switch" key={key}>
    <span>{label}</span>
    <input type="checkbox" role="switch" checked={value?.[key] ?? false} disabled={saving || disabled} onChange={event => {
      if (value) setDraft({ ...value, [key]: event.target.checked });
      setMessage("");
    }} />
    <span className="notifications-switch-track" aria-hidden="true" />
  </label>;

  return <details className="notifications-settings">
    <summary>
      <Settings2 aria-hidden="true" />
      <span>{copy.title}</span>
      {preferences && <span className="notifications-settings-state" data-enabled={preferences.enabled}>{preferences.enabled ? copy.enabled : copy.paused}</span>}
      <ChevronDown aria-hidden="true" className="notifications-settings-chevron" />
    </summary>
    <form aria-busy={saving} onSubmit={event => { event.preventDefault(); void save(); }}>
      <p>{copy.hint}</p>
      {value && <>
        {toggle("enabled", copy.master)}
        <fieldset aria-label={copy.title} className="notifications-settings-categories">
          {categories.map(key => toggle(key, copy[key], !value.enabled))}
        </fieldset>
        <div className="notifications-settings-actions">
          {error && <span role="alert">{error}</span>}
          <span role="status">{message}</span>
          <button type="submit" disabled={!dirty || saving}>
            {saving && <LoaderCircle aria-hidden="true" className="spin" />}{copy.save}
          </button>
        </div>
      </>}
    </form>
  </details>;
}
