"use client";

import { AccountDisclosure } from "./AccountArea";
import { accountSettingsCopy } from "./account-settings-copy";

import { Select } from "../_components/Select";

import { Brain, CircleAlert, LoaderCircle, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import type { PlatformLocale } from "../../lib/platform/routing";
import { usePlatformWorkspaceId } from "./PlatformRouteContext";

type Category = "profile_name" | "language" | "company" | "answer_style" | "user_instruction" | "counterparty" | "legal_context" | "typical_requisite";
type Memory = {
  id: string;
  category: Category;
  statement: string;
  scope: "global" | "workspace";
  workspaceId: string | null;
  sourceKind: "manual" | "automatic" | "profile";
  source: { type: "manual" | "chat" | "profile"; savedAt: string } | null;
  createdAt: string;
  updatedAt: string;
};

type MemoryResponse = {
  available: boolean;
  settings: { automaticEnabled: boolean };
  memories: Memory[];
  code?: string;
  error?: string;
};

const categories: Category[] = [
  "profile_name",
  "language",
  "company",
  "answer_style",
  "user_instruction",
  "counterparty",
  "legal_context",
  "typical_requisite",
];

const memoryCopy = {
  ru: {
    title: "Память JURO",
    loading: "Загрузка памяти…",
    loadError: "Память не загрузилась.",
    changeError: "Память не изменена.",
    updated: "Настройки памяти обновлены.",
    description: "JURO может учитывать только сохранённые здесь устойчивые факты и предпочтения. Пароли, коды и платёжные данные не сохраняются.",
    automatic: "Автоматически сохранять безопасные факты",
    unavailable: "Зашифрованная память сейчас недоступна. Автоматическое сохранение можно отключить; новые записи не принимаются. Если сохранённые записи не удаётся прочитать, AI-чат также временно недоступен.",
    add: "Добавить запись",
    category: "Категория",
    scope: "Область",
    wholeAccount: "Весь аккаунт",
    currentWorkspace: "Текущее пространство",
    thisWorkspace: "Это пространство",
    remember: "Что запомнить",
    sensitiveCreate: "Явно разрешаю сохранить эту запись, если она содержит чувствительные обстоятельства. Пароли и коды всё равно будут отклонены.",
    saveMemory: "Сохранить в память",
    savedEntries: "Сохранённые записи",
    empty: "Память пуста. JURO не переносит обстоятельства между чатами.",
    automaticSource: "Сохранено автоматически",
    manualSource: "Добавлено вами",
    statement: "Запись",
    sensitiveEdit: "Явно разрешаю сохранить чувствительные обстоятельства в этой редакции. Пароли и коды всё равно запрещены.",
    save: "Сохранить",
    remove: "Удалить",
    clear: "Очистить доступную память",
    clearAria: "Подтверждение очистки памяти",
    clearDescription: "Будут удалены глобальные и доступные записи текущего пространства.",
    confirmClear: "Подтвердить очистку",
    cancel: "Отмена",
  },
  uz: {
    title: "JURO xotirasi",
    loading: "Xotira yuklanmoqda…",
    loadError: "Xotira yuklanmadi.",
    changeError: "Xotira o‘zgartirilmadi.",
    updated: "Xotira sozlamalari yangilandi.",
    description: "JURO faqat shu yerda saqlangan barqaror ma’lumot va afzalliklarni hisobga oladi. Parollar, kodlar va to‘lov ma’lumotlari saqlanmaydi.",
    automatic: "Xavfsiz faktlarni avtomatik saqlash",
    unavailable: "Shifrlangan xotira hozir mavjud emas. Avtomatik saqlashni o‘chirish mumkin; yangi yozuvlar qabul qilinmaydi. Saqlangan yozuvlarni o‘qib bo‘lmasa, AI chat ham vaqtincha ishlamaydi.",
    add: "Yozuv qo‘shish",
    category: "Toifa",
    scope: "Doira",
    wholeAccount: "Butun hisob",
    currentWorkspace: "Joriy makon",
    thisWorkspace: "Shu makon",
    remember: "Nimani eslab qolish",
    sensitiveCreate: "Agar yozuv maxfiy holatlarni o‘z ichiga olsa, uni saqlashga aniq ruxsat beraman. Parol va kodlar baribir rad etiladi.",
    saveMemory: "Xotirada saqlash",
    savedEntries: "Saqlangan yozuvlar",
    empty: "Xotira bo‘sh. JURO holatlarni suhbatlar orasida ko‘chirmaydi.",
    automaticSource: "Avtomatik saqlandi",
    manualSource: "Siz qo‘shgansiz",
    statement: "Yozuv",
    sensitiveEdit: "Ushbu tahrirdagi maxfiy holatlarni saqlashga aniq ruxsat beraman. Parol va kodlar baribir taqiqlanadi.",
    save: "Saqlash",
    remove: "O‘chirish",
    clear: "Mavjud xotirani tozalash",
    clearAria: "Xotirani tozalashni tasdiqlash",
    clearDescription: "Global va joriy makondagi mavjud yozuvlar o‘chiriladi.",
    confirmClear: "Tozalashni tasdiqlash",
    cancel: "Bekor qilish",
  },
  en: {
    title: "JURO memory",
    loading: "Loading memory…",
    loadError: "Memory could not be loaded.",
    changeError: "Memory could not be updated.",
    updated: "Memory settings updated.",
    description: "JURO can use only the stable facts and preferences saved here. Passwords, verification codes and payment details are never stored.",
    automatic: "Automatically save safe facts",
    unavailable: "Encrypted memory is currently unavailable. You can turn off automatic saving; new entries will not be accepted. Chat is also temporarily unavailable if saved entries cannot be read.",
    add: "Add entry",
    category: "Category",
    scope: "Scope",
    wholeAccount: "Entire account",
    currentWorkspace: "Current workspace",
    thisWorkspace: "This workspace",
    remember: "What should JURO remember?",
    sensitiveCreate: "I explicitly allow this entry to be saved if it contains sensitive circumstances. Passwords and codes will still be rejected.",
    saveMemory: "Save to memory",
    savedEntries: "Saved entries",
    empty: "Memory is empty. JURO does not carry circumstances between chats.",
    automaticSource: "Saved automatically",
    manualSource: "Added by you",
    statement: "Entry",
    sensitiveEdit: "I explicitly allow sensitive circumstances in this revision to be saved. Passwords and codes remain prohibited.",
    save: "Save",
    remove: "Delete",
    clear: "Clear available memory",
    clearAria: "Confirm memory deletion",
    clearDescription: "Global entries and entries available in this workspace will be deleted.",
    confirmClear: "Confirm deletion",
    cancel: "Cancel",
  },
} as const;

export function MemoryPanel({ locale }: { locale: PlatformLocale }) {
  const workspaceId=usePlatformWorkspaceId();
  return <WorkspaceMemoryPanel key={workspaceId} locale={locale} workspaceId={workspaceId}/>;
}

function WorkspaceMemoryPanel({locale,workspaceId}:{locale:PlatformLocale;workspaceId:string}) {
  const t = memoryCopy[locale];
  const [data, setData] = useState<MemoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { category: Category; statement: string; confirmSensitive: boolean }>>({});
  const [create, setCreate] = useState<{ category: Category; statement: string; scope: "global" | "workspace"; confirmSensitive: boolean }>({
    category: "user_instruction",
    statement: "",
    scope: "global",
    confirmSensitive: false,
  });
  const [clearArmed, setClearArmed] = useState(false);

  const requestMemory = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/platform/ai/memory?locale=${locale}`, {
      cache: "no-store",
      headers: { "x-juro-workspace-id": workspaceId },
      signal,
    });
    const body = await response.json() as MemoryResponse;
    if (!response.ok) {
      throw new Error(body.error || t.loadError);
    }
    return body;
  }, [locale, workspaceId, t.loadError]);

  const load = useCallback(async () => {
    try {
      const body = await requestMemory();
      setData(body);
      setDrafts(draftsFor(body.memories));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [requestMemory]);

  useEffect(() => {
    const controller = new AbortController();
    requestMemory(controller.signal).then((body) => {
      setData(body);
      setDrafts(draftsFor(body.memories));
    }).catch((value: unknown) => {
      if (value instanceof DOMException && value.name === "AbortError") return;
      setError(value instanceof Error ? value.message : String(value));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [requestMemory]);

  async function mutate(body: Record<string, unknown>, busyId: string) {
    setBusy(busyId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/platform/ai/memory", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-workspace-id": workspaceId },
        body: JSON.stringify({ ...body, locale }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || t.changeError);
      setNotice(t.updated);
      await load();
      return true;
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function createMemory(event: FormEvent) {
    event.preventDefault();
    const saved = await mutate({ action: "create", ...create }, "create");
    if (saved) setCreate(current => ({ ...current, statement: "", confirmSensitive: false }));
  }

  async function updateMemory(memory: Memory) {
    const draft = drafts[memory.id];
    if (!draft) return;
    await mutate({
      action: "update",
      memoryId: memory.id,
      category: draft.category,
      statement: draft.statement,
      confirmSensitive: draft.confirmSensitive,
    }, memory.id);
  }

  if (loading) {
    return <section className="memory-panel" aria-labelledby="memory-heading">
      <h2 id="memory-heading"><Brain aria-hidden="true" />{t.title}</h2>
      <p role="status"><LoaderCircle className="spin" aria-hidden="true" />{t.loading}</p>
    </section>;
  }

  return <section className="memory-panel" aria-labelledby="memory-heading">
    <div className="memory-panel-heading">
      <div>
        <h2 id="memory-heading"><Brain aria-hidden="true" />{t.title}</h2>
        <p>{t.description}</p>
      </div>
      {data && <label className="memory-toggle">
        <input
          type="checkbox"
          checked={data.settings.automaticEnabled}
          disabled={Boolean(busy)}
          onChange={(event) => void mutate({ action: "settings", automaticEnabled: event.target.checked }, "settings")}
        />
        <span>{t.automatic}</span>
      </label>}
    </div>

    {error && <p className="profile-message error" role="alert"><CircleAlert aria-hidden="true" />{error}</p>}
    {notice && <p className="profile-message success" role="status"><ShieldCheck aria-hidden="true" />{notice}</p>}

    {data && !data.available && <p className="memory-unavailable" role="status">
      <CircleAlert aria-hidden="true" />
      <span>{t.unavailable}</span>
    </p>}

    {data?.available && <>
      <AccountDisclosure title={t.add} description={accountSettingsCopy[locale].memoryAddDescription} icon={Plus}><form className="memory-create" onSubmit={createMemory}>
        <div className="memory-fields">
          <label>{t.category}
            <Select value={create.category} onChange={(event) => setCreate(current => ({ ...current, category: event.target.value as Category }))}>
              {categories.map(category => <option value={category} key={category}>{categoryLabel(category, locale)}</option>)}
            </Select>
          </label>
          <label>{t.scope}
            <Select value={create.scope} onChange={(event) => setCreate(current => ({ ...current, scope: event.target.value as "global" | "workspace" }))}>
              <option value="global">{t.wholeAccount}</option>
              <option value="workspace">{t.currentWorkspace}</option>
            </Select>
          </label>
        </div>
        <label>{t.remember}
          <textarea required minLength={2} maxLength={500} value={create.statement} onChange={(event) => setCreate(current => ({ ...current, statement: event.target.value }))} />
        </label>
        <label className="memory-sensitive-confirmation">
          <input type="checkbox" checked={create.confirmSensitive} onChange={(event) => setCreate(current => ({ ...current, confirmSensitive: event.target.checked }))} />
          <span>{t.sensitiveCreate}</span>
        </label>
        <button type="submit" disabled={Boolean(busy) || create.statement.trim().length < 2} aria-busy={busy === "create"}>
          {busy === "create" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {t.saveMemory}
        </button>
      </form></AccountDisclosure>

      <div className="memory-list" aria-live="polite">
        <h3>{t.savedEntries}: {data.memories.length}</h3>
        {data.memories.length === 0 && <p className="memory-empty">{t.empty}</p>}
        {data.memories.map(memory => {
          const draft = drafts[memory.id] ?? { category: memory.category, statement: memory.statement, confirmSensitive: false };
          return <article className="memory-row" key={memory.id}>
            <div className="memory-row-meta">
              <span>{memory.scope === "global" ? t.wholeAccount : t.thisWorkspace}</span>
              <span>{memory.sourceKind === "automatic" ? t.automaticSource : t.manualSource}</span>
              <time dateTime={memory.updatedAt}>{formatDate(memory.updatedAt, locale)}</time>
            </div>
            <label className="memory-category">{t.category}
              <Select value={draft.category} onChange={(event) => setDrafts(current => ({ ...current, [memory.id]: { ...draft, category: event.target.value as Category } }))}>
                {categories.map(category => <option value={category} key={category}>{categoryLabel(category, locale)}</option>)}
              </Select>
            </label>
            <label className="memory-statement">{t.statement}
              <textarea maxLength={500} value={draft.statement} onChange={(event) => setDrafts(current => ({ ...current, [memory.id]: { ...draft, statement: event.target.value } }))} />
            </label>
            <label className="memory-sensitive-confirmation memory-row-confirmation">
              <input
                type="checkbox"
                checked={draft.confirmSensitive}
                onChange={(event) => setDrafts(current => ({
                  ...current,
                  [memory.id]: { ...draft, confirmSensitive: event.target.checked },
                }))}
              />
              <span>{t.sensitiveEdit}</span>
            </label>
            <div className="memory-row-actions">
              <button type="button" disabled={Boolean(busy) || draft.statement.trim().length < 2} onClick={() => void updateMemory(memory)}>
                {busy === memory.id ? <LoaderCircle className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}{t.save}
              </button>
              <button className="danger-outline" type="button" disabled={Boolean(busy)} onClick={() => void mutate({ action: "delete", memoryId: memory.id }, `delete:${memory.id}`)}>
                <Trash2 aria-hidden="true" />{t.remove}
              </button>
            </div>
          </article>;
        })}
      </div>

      {data.memories.length > 0 && <div className="memory-clear">
        {!clearArmed
          ? <button className="danger-outline" type="button" onClick={() => setClearArmed(true)}>{t.clear}</button>
          : <div role="group" aria-label={t.clearAria}>
            <p>{t.clearDescription}</p>
            <button className="danger-outline" type="button" disabled={Boolean(busy)} onClick={() => void mutate({ action: "clear", confirmation: "CLEAR" }, "clear")}>{t.confirmClear}</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => setClearArmed(false)}>{t.cancel}</button>
          </div>}
      </div>}
    </>}
  </section>;
}

function categoryLabel(category: Category, locale: PlatformLocale) {
  const labels = {
    profile_name: { ru: "Имя", uz: "Ism", en: "Name" },
    language: { ru: "Язык", uz: "Til", en: "Language" },
    company: { ru: "Компания", uz: "Kompaniya", en: "Company" },
    answer_style: { ru: "Стиль ответа", uz: "Javob uslubi", en: "Answer style" },
    user_instruction: { ru: "Инструкция", uz: "Ko‘rsatma", en: "Instruction" },
    counterparty: { ru: "Контрагент", uz: "Kontragent", en: "Counterparty" },
    legal_context: { ru: "Юридический контекст", uz: "Huquqiy kontekst", en: "Legal context" },
    typical_requisite: { ru: "Типовой реквизит", uz: "Doimiy rekvizit", en: "Standard detail" },
  } satisfies Record<Category, Record<PlatformLocale, string>>;
  return labels[category][locale];
}

function draftsFor(memories: Memory[]): Record<string, { category: Category; statement: string; confirmSensitive: boolean }> {
  return Object.fromEntries(memories.map((memory) => [memory.id, {
    category: memory.category,
    statement: memory.statement,
    confirmSensitive: false,
  }]));
}

function formatDate(value: string, locale: PlatformLocale) {
  return new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
}
