"use client";
import { useEffect, useState } from "react";
import { Select } from "../_components/Select";
import type { Locale } from "../../lib/practice/domain";
import { displayMoney, currencyScales } from "../../lib/practice/money";
import { ActionForm, RichEditor, RemoteSelect, type Field } from "./controls";
import { t } from "./copy";
import { message } from "../../lib/practice/localization";
type Row = Record<string, any>;
type Api = (path: string, payload?: unknown, form?: FormData) => Promise<any>;
const currencies = Object.keys(currencyScales).map((value) => ({
  value,
  label: value,
}));
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export const autoFields = [
  "client.name",
  "client.requisites",
  "provider.name",
  "provider.requisites",
  "case.title",
  "services",
  "amount",
  "currency",
  "deadline",
  "stages",
  "number",
  "date",
];
const fieldLabel = (locale: Locale, key: string) =>
  ({
    "client.name": `${t(locale, "client")} · ${t(locale, "name")}`,
    "client.requisites": `${t(locale, "client")} · ${t(locale, "requisites")}`,
    "provider.name": t(locale, "provider"),
    "provider.requisites": `${t(locale, "provider")} · ${t(locale, "requisites")}`,
    "case.title": t(locale, "caseId"),
    services: t(locale, "invoiceLines"),
    amount: t(locale, "amount"),
    currency: t(locale, "currency"),
    deadline: t(locale, "dueAt"),
    stages: t(locale, "stageId"),
    number: t(locale, "number"),
    date: t(locale, "issuedOn"),
  })[key] ?? key;

export function InvoiceDialog({
  locale,
  cases,
  caseId,
  provider,
  submit,
  api,
}: {
  locale: Locale;
  api: Api;
  cases: Row[];
  caseId: string;
  provider: Row;
  submit: (values: Row) => Promise<void>;
}) {
  const [lines, setLines] = useState([
    { description: "", quantity: "1", unitPrice: "" },
  ]);
  const [selectedCase, setSelectedCase] = useState(
      caseId || cases[0]?.id || "",
    ),
    [contracts, setContracts] = useState<Row[]>([]),
    [contractId, setContractId] = useState(""),
    [stages, setStages] = useState<Row[]>([]),
    [stageId, setStageId] = useState("");
  useEffect(() => {
    if (selectedCase) {
      api(`invoice-contracts?caseId=${encodeURIComponent(selectedCase)}`)
        .then((result) => setContracts(result.items))
        .catch(() => setContracts([]));
      api(`invoice-stages?caseId=${encodeURIComponent(selectedCase)}`)
        .then((result) => setStages(result.items))
        .catch(() => setStages([]));
    }
  }, [api, selectedCase]);
  return (
    <div>
      <p>{t(locale, "manualPayment")}</p>
      {!caseId && (
        <label>
          {t(locale, "caseId")}
          <RemoteSelect
            locale={locale}
            value={selectedCase}
            initial={cases.map((row) => ({ value: row.id, label: row.title }))}
            load={async (q) =>
              (
                await api(`finance-matters?q=${encodeURIComponent(q)}`)
              ).items.map((row: Row) => ({ value: row.id, label: row.title }))
            }
            onChange={(value) => {
              setSelectedCase(value);
              setContractId("");
            }}
          />
        </label>
      )}
      <label>
        {t(locale, "documents")}
        <Select
          value={contractId}
          onChange={(event) => setContractId(event.target.value)}
        >
          <option value="">—</option>
          {contracts.map((row) => (
            <option key={row.id} value={row.id}>
              {row.title}
            </option>
          ))}
        </Select>
      </label>
      <label>
        {t(locale, "stageId")}
        <Select
          value={stageId}
          onChange={(event) => setStageId(event.target.value)}
        >
          <option value="">—</option>
          {stages.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="practice-invoice-lines">
        <h3>{t(locale, "invoiceLines")}</h3>
        {lines.map((line, index) => (
          <div className="practice-invoice-line" key={index}>
            {["description", "quantity", "unitPrice"].map((key) => (
              <label key={key}>
                {t(locale, key)}
                <input
                  type={key === "description" ? "text" : "number"}
                  min={key === "quantity" ? 1 : 0}
                  step={key === "unitPrice" ? "0.001" : "1"}
                  value={line[key as keyof typeof line]}
                  onChange={(event) =>
                    setLines(
                      lines.map((item, i) =>
                        i === index
                          ? { ...item, [key]: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
            ))}
            {lines.length > 1 && (
              <button
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
              >
                {t(locale, "remove")}
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setLines([
              ...lines,
              { description: "", quantity: "1", unitPrice: "" },
            ])
          }
        >
          {t(locale, "addLine")}
        </button>
      </div>
      <ActionForm
        locale={locale}
        fields={[
          { key: "number" },
          {
            key: "language",
            type: "select",
            options: [
              { value: "ru", label: "Русский" },
              { value: "uz", label: "O‘zbekcha" },
              { value: "en", label: "English" },
            ],
          },
          { key: "issuedOn", type: "date" },
          { key: "dueOn", type: "date" },
          { key: "currency", type: "select", options: currencies },
          { key: "providerName", label: t(locale, "provider") },
          {
            key: "providerDetails",
            label: t(locale, "requisites"),
            type: "textarea",
          },
        ]}
        initial={{
          language: locale,
          issuedOn: today(),
          dueOn: today(),
          currency: "UZS",
          providerName: provider.name ?? "",
          providerDetails: provider.details ?? "",
        }}
        submit={async (values) => {
          if (
            lines.some(
              (line) =>
                !line.description.trim() ||
                !line.unitPrice ||
                Number(line.quantity) < 1,
            )
          )
            throw new Error(t(locale, "invoiceLines"));
          await submit({
            language: values.language,
            caseId: selectedCase,
            ...(contractId ? { documentId: contractId } : {}),
            ...(stageId ? { stageId } : {}),
            number: values.number,
            issuedOn: values.issuedOn,
            dueOn: values.dueOn,
            currency: values.currency,
            lines: lines.map((line) => ({
              ...line,
              quantity: Number(line.quantity),
            })),
            provider: {
              name: values.providerName,
              details: values.providerDetails,
            },
          });
        }}
      />
    </div>
  );
}

export function NewDocumentDialog({
  locale,
  cases,
  caseId,
  provider,
  api,
  submit,
}: {
  locale: Locale;
  cases: Row[];
  caseId: string;
  provider: Row;
  api: Api;
  submit: (values: Row) => Promise<void>;
}) {
  const [language, setLanguage] = useState<Locale>(locale),
    [templates, setTemplates] = useState<Row[]>([]),
    [template, setTemplate] = useState<Row | null>(null),
    [html, setHtml] = useState("<p></p>"),
    [title, setTitle] = useState(""),
    [selectedCase, setSelectedCase] = useState(caseId),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [fill, setFill] = useState(false);
  useEffect(() => {
    api(`templates?language=${language}`)
      .then((result) => setTemplates(result.items))
      .catch((error) => setError(error.message));
  }, [api, language]);
  const fields = [
    ...new Set(
      [...html.matchAll(/\{\{([\w.]+)\}\}/g)].map((match) => match[1]),
    ),
  ];
  const selected = cases.find((row) => row.id === selectedCase);
  return (
    <div className="practice-stack">
      <label>
        {t(locale, "caseId")}
        <RemoteSelect
          locale={locale}
          value={selectedCase}
          initial={cases.map((row) => ({ value: row.id, label: row.title }))}
          load={async (q) =>
            (await api(`cases?q=${encodeURIComponent(q)}`)).items.map(
              (row: Row) => ({ value: row.id, label: row.title }),
            )
          }
          onChange={setSelectedCase}
        />
      </label>
      <label>
        {t(locale, "language")}
        <Select
          value={language}
          onChange={(event) => setLanguage(event.target.value as Locale)}
        >
          <option value="ru">Русский</option>
          <option value="uz">O‘zbekcha</option>
          <option value="en">English</option>
        </Select>
      </label>
      <label>
        {t(locale, "templates")}
        <Select
          value={template?.id ?? ""}
          onChange={(event) => {
            const row = templates.find(
              (item) => item.id === event.target.value,
            );
            if (row) {
              setTemplate(row);
              setHtml(row.content.html);
              setTitle(row.name);
            }
          }}
        >
          <option value="">{t(locale, "choose")}</option>
          {templates.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name} · {row.language}
            </option>
          ))}
        </Select>
      </label>
      <label>
        {t(locale, "title")}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </label>
      <p>{t(locale, "draftNote")}</p>
      <RichEditor
        locale={locale}
        html={html}
        onChange={setHtml}
        fields={autoFields.map((value) => ({
          value,
          label: fieldLabel(locale, value),
        }))}
      />
      {fields.length > 0 && (
        <>
          <button type="button" onClick={() => setFill(!fill)}>
            {t(locale, "fill")} ({fields.length})
          </button>
          {fill && (
            <ActionForm
              locale={locale}
              fields={fields.map((key) => ({
                key,
                label: fieldLabel(locale, key),
                required: false,
              }))}
              initial={{
                "client.name": selected?.client_name ?? "",
                "provider.name": provider.name ?? "",
                "provider.requisites": provider.details ?? "",
                "case.title": selected?.title ?? "",
                amount:
                  selected?.expected_minor != null
                    ? displayMoney(selected.expected_minor, selected.currency)
                    : "",
                currency: selected?.currency ?? "UZS",
                date: today(),
              }}
              submit={async (values) => {
                setHtml(
                  html.replace(/\{\{([\w.]+)\}\}/g, (match, key) =>
                    values[key] !== undefined && values[key] !== ""
                      ? esc(String(values[key]))
                      : match,
                  ),
                );
                setFill(false);
              }}
            />
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="practice-primary"
        disabled={busy || !selectedCase || !title.trim()}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await submit({
              caseId: selectedCase,
              title,
              language,
              content: html,
            });
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t(locale, "create")}
      </button>
    </div>
  );
}

export function TemplateDialog({
  locale,
  api,
  template,
  submit,
}: {
  locale: Locale;
  api: Api;
  template?: Row;
  submit: (values: Row) => Promise<void>;
}) {
  const [html, setHtml] = useState(template?.content?.html ?? "<p></p>"),
    [importedId, setImportedId] = useState<string | undefined>(undefined),
    [warning, setWarning] = useState(""),
    [error, setError] = useState("");
  return (
    <div className="practice-stack">
      <p>{t(locale, "private")}</p>
      <p>{t(locale, "docxWarning")}</p>
      <label>
        {t(locale, "upload")} DOCX
        <input
          type="file"
          accept=".docx"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const form = new FormData();
            form.set("file", file);
            form.set("language", template?.language ?? locale);
            try {
              const result = await api("templates/import", undefined, form);
              setHtml(result.html);
              setImportedId(result.id);
              setWarning(t(locale, "docxWarning"));
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        />
      </label>
      {warning && <p role="status">{warning}</p>}
      {error && <p role="alert">{error}</p>}
      <RichEditor
        locale={locale}
        html={html}
        onChange={setHtml}
        fields={autoFields.map((value) => ({
          value,
          label: fieldLabel(locale, value),
        }))}
      />
      <ActionForm
        locale={locale}
        fields={[
          { key: "name" },
          {
            key: "kind",
            type: "select",
            options: ["document", "proposal", "other"].map((value) => ({
              value,
              label: t(locale, value),
            })),
          },
          {
            key: "language",
            type: "select",
            options: [
              { value: "ru", label: "Русский" },
              { value: "uz", label: "O‘zbekcha" },
              { value: "en", label: "English" },
            ],
          },
        ]}
        initial={{
          name: template?.name ?? "",
          kind: ["document", "proposal", "other"].includes(template?.kind)
            ? template?.kind
            : "document",
          language: template?.language ?? locale,
        }}
        submit={async (values) => {
          await submit({
            ...values,
            content: html,
            fields: [
              ...new Set(
                [...html.matchAll(/\{\{([\w.]+)\}\}/g)].map(
                  (match) => match[1],
                ),
              ),
            ],
            ...(importedId || template?.workspace_id
              ? { templateId: importedId ?? template!.id }
              : {}),
          });
        }}
      />
    </div>
  );
}

export function ImportDialog({
  locale,
  kind,
  api,
  boot,
  done,
}: {
  locale: Locale;
  kind: "contacts" | "cases";
  api: Api;
  boot: Row;
  done: () => void;
}) {
  const [preview, setPreview] = useState<Row | null>(null),
    [result, setResult] = useState<Row | null>(null),
    [error, setError] = useState("");
  const fields =
    kind === "contacts"
      ? ["name", "email", "phone", "companyName", "requisites"]
      : ["name", "contactId", "description", "expected", "currency"];
  return (
    <div className="practice-stack">
      <p>{t(locale, "importHelp")}</p>
      <label>
        {t(locale, "upload")}
        <input
          type="file"
          accept=".csv,.xlsx"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setError("");
            const form = new FormData();
            form.set("file", file);
            try {
              setPreview(await api("imports/preview", undefined, form));
              setResult(null);
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <>
          <h3>
            {t(locale, "preview")} · {preview.rowCount}
          </h3>
          <div className="practice-table-wrap">
            <table className="practice-table">
              <thead>
                <tr>
                  {preview.columns.map((column: string, i: number) => (
                    <th key={i}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((row: string[], i: number) => (
                  <tr key={i}>
                    {row.map((cell: string, j: number) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ActionForm
            locale={locale}
            fields={[
              ...fields.map((key) => ({
                key,
                label:
                  key === "contactId"
                    ? `${t(locale, "contactId")} · ID`
                    : t(locale, key),
                type: "select" as const,
                required: key === "name" || key === "contactId",
                options: preview.columns.map(
                  (column: string, index: number) => ({
                    value: String(index),
                    label: column,
                  }),
                ),
              })),
              {
                key: "duplicate",
                type: "select",
                options: [
                  { value: "skip", label: t(locale, "skip") },
                  { value: "create", label: t(locale, "createNew") },
                ],
              },
              ...(kind === "cases"
                ? [
                    {
                      key: "pipelineId",
                      type: "select" as const,
                      options: boot.pipelines.map((p: Row) => ({
                        value: p.id,
                        label: p.name,
                      })),
                    },
                    {
                      key: "stageId",
                      type: "select" as const,
                      options: (values: Row) =>
                        (
                          boot.pipelines.find(
                            (p: Row) => p.id === values.pipelineId,
                          )?.stages ?? []
                        ).map((stage: Row) => ({
                          value: stage.id,
                          label: stage.name,
                        })),
                    },
                    { key: "source" },
                  ]
                : []),
            ]}
            initial={{ duplicate: "skip", name: "0" }}
            label={t(locale, "confirmImport")}
            submit={async (values) => {
              const mapping = Object.fromEntries(
                fields
                  .filter(
                    (key) => values[key] !== undefined && values[key] !== "",
                  )
                  .map((key) => [key, Number(values[key])]),
              );
              setResult(
                await api("imports/confirm", {
                  importId: preview.id,
                  kind,
                  mapping,
                  duplicate: values.duplicate,
                  ...(kind === "cases"
                    ? {
                        pipelineId: values.pipelineId,
                        stageId: values.stageId,
                        source: values.source,
                      }
                    : {}),
                }),
              );
              done();
            }}
          />
        </>
      )}
      {result && (
        <div role="status">
          <p>
            {t(locale, "created")}: {result.created} · {t(locale, "skipped")}:{" "}
            {result.skipped} · {t(locale, "failed")}: {result.failed}
          </p>
          {result.errors.map((error: Row) => (
            <p key={error.row}>
              {t(locale, "row")} {error.row}:{" "}
              {error.field ? t(locale, error.field) + " · " : ""}
              {message(locale, error.code)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({
  locale,
  boot,
  api,
  command,
}: {
  locale: Locale;
  boot: Row;
  api: Api;
  command: (input: Row, close?: boolean) => Promise<any>;
}) {
  const manager = ["owner", "admin"].includes(boot.actor.role),
    legal = ["owner", "admin", "lawyer", "assistant"].includes(boot.actor.role);
  const [calendars, setCalendars] = useState<Row[]>([]),
    [sync, setSync] = useState<Row | null>(null),
    [error, setError] = useState("");
  const [blocks, setBlocks] = useState<Row[]>(
    boot.preferences?.blocks ??
      ["tasks", "cases", "calendar", "finance", "leads"].map((id) => ({
        id,
        visible: true,
      })),
  );
  const [custom, setCustom] = useState<Row[]>([]);
  async function run(fn: () => Promise<any>) {
    setError("");
    try {
      await fn();
    } catch (error) {
      setError((error as Error).message);
    }
  }
  return (
    <div className="practice-settings-grid">
      {manager && (
        <section className="practice-panel">
          <h2>{t(locale, "settings")}</h2>
          <ActionForm
            locale={locale}
            fields={[
              { key: "providerName", label: t(locale, "provider") },
              {
                key: "providerDetails",
                label: t(locale, "requisites"),
                type: "textarea",
              },
              { key: "baseCurrency", type: "select", options: currencies },
              { key: "reminders", type: "checkbox" },
              { key: "reminderHours", type: "number", min: 1 },
              { key: "email", type: "checkbox" },
              { key: "sources", type: "textarea", required: false },
              { key: "aiConsent", type: "checkbox" },
            ]}
            initial={{
              providerName: boot.provider?.name ?? "",
              providerDetails: boot.provider?.details ?? "",
              reminders: boot.settings?.reminders !== false,
              reminderHours: String(boot.settings?.reminderHours ?? 24),
              email: boot.settings?.email !== false,
              aiConsent: boot.settings?.aiConsent === true,
              baseCurrency: boot.settings?.baseCurrency ?? "UZS",
              sources: (boot.settings?.sources ?? []).join("\n"),
            }}
            submit={async (values) => {
              await command(
                {
                  action: "settings.save",
                  providerDetails: {
                    name: values.providerName,
                    details: values.providerDetails,
                  },
                  settings: {
                    reminders: Boolean(values.reminders),
                    email: Boolean(values.email),
                    reminderHours: Number(values.reminderHours),
                    sources: (values.sources ?? "")
                      .split("\n")
                      .map((value: string) => value.trim())
                      .filter(Boolean),
                    aiConsent: Boolean(values.aiConsent),
                    baseCurrency: values.baseCurrency,
                  },
                },
                false,
              );
            }}
          />
        </section>
      )}
      {legal && (
        <section className="practice-panel">
          <h2>Google Calendar</h2>
          <p>
            {t(
              locale,
              boot.integrations.google.state === "connected"
                ? "connected"
                : "not_connected",
            )}
          </p>
          {boot.integrations.google.last_error && (
            <p role="alert">{t(locale, "failed")}</p>
          )}
          <div className="practice-actions">
            <button
              disabled={!boot.actor.writable}
              onClick={() =>
                run(async () => {
                  const result = await api("google/connect", {});
                  window.location.href = result.url;
                })
              }
            >
              {t(locale, "connect")}
            </button>
            <button
              onClick={() =>
                run(async () => {
                  setCalendars((await api("google/calendars")).items);
                })
              }
            >
              {t(locale, "choose")}
            </button>
            <button
              disabled={!boot.actor.writable}
              onClick={() =>
                run(async () => {
                  setSync(await api("google/sync", {}));
                })
              }
            >
              {t(locale, "synchronize")}
            </button>
            <button
              onClick={() =>
                run(async () => {
                  await api("google/disconnect", {});
                  setSync(null);
                  setCalendars([]);
                })
              }
            >
              {t(locale, "disconnect")}
            </button>
          </div>
          {calendars.length > 0 && (
            <ActionForm
              locale={locale}
              fields={[
                {
                  key: "calendarId",
                  label: t(locale, "events"),
                  type: "select",
                  options: calendars.map((calendar) => ({
                    value: calendar.id,
                    label: calendar.name,
                  })),
                },
              ]}
              submit={async (values) => {
                await api("google/select", { calendarId: values.calendarId });
              }}
            />
          )}
          {sync && (
            <>
              <p>
                {t(locale, "receivedOn")}: {sync.received} · {t(locale, "sent")}
                : {sync.pushed}
              </p>
              {sync.conflicts?.map((conflict: Row) => (
                <div className="practice-review" key={conflict.eventId}>
                  <p>{t(locale, "conflict")}</p>
                  {["local", "remote"].map((choice) => (
                    <button
                      key={choice}
                      onClick={() =>
                        run(async () => {
                          await api("google/resolve", {
                            eventId: conflict.eventId,
                            choice,
                          });
                          setSync(await api("google/sync", {}));
                        })
                      }
                    >
                      {t(locale, choice)}
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
          {error && (
            <p className="practice-error" role="alert">
              {error}
            </p>
          )}
          <h3>{t(locale, "ai")}</h3>
          <p>
            {t(
              locale,
              boot.integrations.ai === "not_connected"
                ? "not_connected"
                : "connected",
            )}
          </p>
        </section>
      )}
      <section className="practice-panel">
        <h2>{t(locale, "customize")}</h2>
        {blocks.map((block, index) => (
          <div className="practice-dashboard-row" key={block.id}>
            <label>
              <input
                type="checkbox"
                checked={block.visible}
                onChange={(event) =>
                  setBlocks(
                    blocks.map((item) =>
                      item.id === block.id
                        ? { ...item, visible: event.target.checked }
                        : item,
                    ),
                  )
                }
              />
              {t(locale, block.id === "calendar" ? "events" : block.id)}
            </label>
            <button
              disabled={!index}
              onClick={() => {
                const next = [...blocks];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                setBlocks(next);
              }}
            >
              {t(locale, "moveUp")}
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            run(() => command({ action: "preferences.save", blocks }, false))
          }
        >
          {t(locale, "save")}
        </button>
      </section>
      {manager && (
        <section className="practice-panel">
          <h2>{t(locale, "filter")}</h2>
          {boot.pipelines.map((pipeline: Row) => (
            <details key={pipeline.id}>
              <summary>{pipeline.name}</summary>
              <ActionForm
                locale={locale}
                fields={[
                  { key: "name" },
                  {
                    key: "stages",
                    label: t(locale, "stagesTemplate"),
                    type: "textarea",
                  },
                ]}
                initial={{
                  name: pipeline.name,
                  stages: pipeline.stages
                    .map((stage: Row) => stage.name)
                    .join("\n"),
                }}
                submit={async (values) => {
                  await command(
                    {
                      action: "pipeline.save",
                      pipelineId: pipeline.id,
                      name: values.name,
                      stages: values.stages
                        .split("\n")
                        .filter((value: string) => value.trim())
                        .map((name: string, index: number) => ({
                          id: pipeline.stages[index]?.id ?? crypto.randomUUID(),
                          name: name.trim(),
                        })),
                    },
                    false,
                  );
                }}
              />
            </details>
          ))}
          <ActionForm
            locale={locale}
            fields={[
              { key: "name" },
              {
                key: "stages",
                label: t(locale, "stagesTemplate"),
                type: "textarea",
              },
            ]}
            submit={async (values) => {
              await command(
                {
                  action: "pipeline.save",
                  name: values.name,
                  stages: values.stages
                    .split("\n")
                    .filter((value: string) => value.trim())
                    .map((name: string) => ({
                      id: crypto.randomUUID(),
                      name: name.trim(),
                    })),
                },
                false,
              );
            }}
          />
        </section>
      )}
      {manager && (
        <section className="practice-panel">
          <h2>{t(locale, "caseTemplates")}</h2>
          <div className="practice-stack">
            {custom.map((field, index) => (
              <div className="practice-inline-form" key={field.key}>
                <input
                  aria-label={t(locale, "title")}
                  value={field.label}
                  onChange={(event) =>
                    setCustom(
                      custom.map((item, i) =>
                        i === index
                          ? { ...item, label: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <Select
                  aria-label={t(locale, "kind")}
                  value={field.type}
                  onChange={(event) =>
                    setCustom(
                      custom.map((item, i) =>
                        i === index
                          ? { ...item, type: event.target.value }
                          : item,
                      ),
                    )
                  }
                >
                  <option value="text">{t(locale, "body")}</option>
                  <option value="number">{t(locale, "amount")}</option>
                  <option value="date">{t(locale, "issuedOn")}</option>
                  <option value="boolean">{t(locale, "confirm")}</option>
                </Select>
                <button
                  onClick={() =>
                    setCustom(custom.filter((_, i) => i !== index))
                  }
                >
                  {t(locale, "remove")}
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setCustom([
                  ...custom,
                  { key: crypto.randomUUID(), label: "", type: "text" },
                ])
              }
            >
              {t(locale, "customFields")} +
            </button>
          </div>
          <ActionForm
            locale={locale}
            fields={[
              { key: "name" },
              {
                key: "tasks",
                label: t(locale, "tasksTemplate"),
                type: "textarea",
                required: false,
              },
              {
                key: "stages",
                label: t(locale, "stagesTemplate"),
                type: "textarea",
                required: false,
              },
            ]}
            submit={async (values) => {
              await command(
                {
                  action: "case-template.save",
                  name: values.name,
                  fields: custom,
                  tasks: (values.tasks ?? "").split("\n").filter(Boolean),
                  stages: (values.stages ?? "").split("\n").filter(Boolean),
                },
                false,
              );
            }}
          />
        </section>
      )}
      {manager && (
        <section className="practice-panel">
          <h2>{t(locale, "rate")}</h2>
          <p>{t(locale, "noMix")}</p>
          <ActionForm
            locale={locale}
            fields={[
              { key: "currency", type: "select", options: currencies },
              { key: "baseCurrency", type: "select", options: currencies },
              { key: "rate", type: "number", min: 0, step: "0.000000000001" },
              { key: "rateOn", type: "date" },
            ]}
            initial={{
              baseCurrency: boot.settings?.baseCurrency ?? "UZS",
              rateOn: today(),
            }}
            submit={async (values) => {
              await command({ action: "fx.save", ...values }, false);
            }}
          />
        </section>
      )}
    </div>
  );
}
