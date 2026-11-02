"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { parseZonedDateTime, parseAbsolute } from "@internationalized/date";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Select } from "../_components/Select";
import type { Locale } from "../../lib/practice/domain";
import {
  displayMoney,
  invoiceStatus,
  currencyScales,
} from "../../lib/practice/money";
import { t } from "./copy";
import { ActionForm, Modal, RichEditor, type Field } from "./controls";
import { DocumentEditor } from "./DocumentEditor";
import {
  ImportDialog,
  InvoiceDialog,
  NewDocumentDialog,
  SettingsPanel,
  TemplateDialog,
} from "./panels";
import "./practice.css";

type Row = Record<string, any>;
const dateToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const currencies = Object.keys(currencyScales).map((value) => ({
  value,
  label: value,
}));
const icons: Record<string, typeof Users> = {
  overview: LayoutDashboard,
  contacts: Users,
  cases: BriefcaseBusiness,
  events: CalendarDays,
  documents: FileText,
  invoices: Wallet,
  settings: Settings,
};

export function PracticeApp({
  workspaceId,
  locale,
  todayLabel,
  embedded = false,
  initialCaseId,
  invitationToken,
}: {
  workspaceId: string;
  locale: Locale;
  todayLabel: string;
  embedded?: boolean;
  initialCaseId?: string;
  invitationToken?: string;
}) {
  const [boot, setBoot] = useState<Row | null>(null),
    [tab, setTab] = useState("overview"),
    [data, setData] = useState<Row>({ items: [] }),
    [caseId, setCaseId] = useState(initialCaseId ?? ""),
    [caseRow, setCaseRow] = useState<Row | null>(null),
    [caseTab, setCaseTab] = useState("tasks"),
    [selectedDocument, setSelectedDocument] = useState("");
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [board, setBoard] = useState(false),
    [pipeline, setPipeline] = useState(""),
    [sort, setSort] = useState("updated"),
    [tick, setTick] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [modal, setModal] = useState<ReactNode>(null),
    [notice, setNotice] = useState(""),
    [selectedTime, setSelectedTime] = useState<string[]>([]);
  const keys = useRef(new Map<string, string>());
  const api = useCallback(
    async (path: string, payload?: unknown, form?: FormData) => {
      const separator = path.includes("?") ? "&" : "?",
        url = `/api/practice/${path}${separator}workspaceId=${encodeURIComponent(workspaceId)}&locale=${locale}`;
      const write = payload !== undefined || form !== undefined;
      const signature =
        path +
        (form
          ? [...form.entries()]
              .map(
                ([key, value]) =>
                  key +
                  (value instanceof File
                    ? `${value.name}:${value.size}:${value.lastModified}`
                    : value),
              )
              .join("|")
          : JSON.stringify(payload));
      let key = keys.current.get(signature);
      if (!key) {
        key = crypto.randomUUID();
        keys.current.set(signature, key);
      }
      const response = await fetch(url, {
        method: write ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "x-juro-locale": locale,
          ...(write ? { "x-juro-csrf": "1", "idempotency-key": key } : {}),
          ...(!form && write ? { "content-type": "application/json" } : {}),
        },
        ...(write ? { body: form ?? JSON.stringify(payload) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t(locale, "failed"));
      if (write) keys.current.delete(signature);
      return result;
    },
    [workspaceId, locale],
  );
  const refresh = () => setTick((value) => value + 1);
  const actor = boot?.actor,
    manager = ["owner", "admin"].includes(actor?.role),
    legal = ["owner", "admin", "lawyer", "assistant"].includes(actor?.role),
    finance = ["owner", "admin", "lawyer", "accountant"].includes(actor?.role),
    client = actor?.role === "client",
    writable = actor?.writable;
  useEffect(() => {
    let current = true;
    api(
      invitationToken
        ? `invitation/preview?token=${encodeURIComponent(invitationToken)}`
        : "bootstrap",
    )
      .then((result) => {
        if (current) setBoot(result);
      })
      .catch((error) => {
        if (current) setError(error.message);
      });
    return () => {
      current = false;
    };
  }, [api, tick, invitationToken]);
  useEffect(() => {
    if (!boot || invitationToken) return;
    let current = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ q: query, page: String(page), sort });
    if (caseId && tab === "cases") params.set("caseId", caseId);
    if (pipeline) params.set("pipelineId", pipeline);
    if (tab === "leads") params.set("leads", "true");
    const resource =
      caseId && tab === "cases"
        ? caseTab === "detail"
          ? "cases"
          : caseTab
        : tab === "leads"
          ? "cases"
          : tab;
    const load =
      resource === "overview"
        ? api("overview")
        : resource === "settings"
          ? Promise.resolve({ items: [] })
          : resource === "ai"
            ? api(`documents?${params}`)
            : api(`${resource}?${params}`);
    load
      .then((result) => {
        if (current) setData(result);
      })
      .catch((error) => {
        if (current) setError(error.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    if (caseId && tab === "cases")
      api(`cases?caseId=${encodeURIComponent(caseId)}`)
        .then((result) => {
          if (current) setCaseRow(result.items[0] ?? null);
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [
    api,
    tab,
    caseId,
    caseTab,
    page,
    query,
    sort,
    pipeline,
    tick,
    Boolean(boot),
    finance,
    invitationToken,
  ]);
  function navigate(next: string) {
    setSelectedTime([]);
    setTab(next);
    setPage(1);
    setQuery("");
    setSelectedDocument("");
    if (next !== "cases") setCaseId("");
  }
  async function command(input: Row, close = true) {
    const result = await api("commands", input);
    if (close) setModal(null);
    setNotice(t(locale, "saved"));
    refresh();
    return result;
  }
  async function perform(run: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await run();
      refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : t(locale, "failed"));
    } finally {
      setBusy(false);
    }
  }
  function dialog(title: string, children: ReactNode) {
    setModal(
      <Modal locale={locale} title={title} close={() => setModal(null)}>
        {children}
      </Modal>,
    );
  }
  const options = (items: Row[], key = "id", label = "name") =>
    items.map((item) => ({
      value: String(item[key]),
      label: String(item[label] || item[key]),
    }));
  const enumOptions = (values: string[]) =>
    values.map((value) => ({ value, label: t(locale, value) }));
  const memberOptions = () =>
    options(
      (boot?.members ?? []).filter((row: Row) => row.role !== "accountant"),
      "user_id",
    );
  const caseField = (items: Row[]): Field => ({
    key: "caseId",
    type: "remote",
    options: options(items, "id", "title"),
    loadOptions: async (q) =>
      options(
        (
          await api(
            `${actor?.role === "accountant" ? "finance-matters" : "cases"}?q=${encodeURIComponent(q)}`,
          )
        ).items,
        "id",
        "title",
      ),
  });
  function openForm(
    title: string,
    fields: Field[],
    initial: Row,
    save: (values: Row) => Promise<void>,
  ) {
    dialog(
      title,
      <ActionForm
        locale={locale}
        fields={fields}
        initial={initial}
        submit={save}
      />,
    );
  }
  async function contactForm(row?: Row) {
    openForm(
      t(locale, row ? "edit" : "contacts"),
      [
        { key: "name" },
        ...(!row
          ? [
              {
                key: "kind",
                type: "select" as const,
                options: enumOptions(["person", "company"]),
              },
              { key: "companyName", required: false },
            ]
          : []),
        { key: "email", required: false },
        { key: "phone", required: false },
        { key: "requisites", type: "textarea", required: false },
      ],
      row
        ? {
            ...row,
            requisites:
              row.requisites?.details ??
              Object.values(row.requisites ?? {}).join("\n"),
          }
        : { kind: "person" },
      async (values) => {
        await command(
          row
            ? {
                action: "contact.update",
                contactId: row.id,
                name: values.name,
                email: values.email ?? "",
                phone: values.phone ?? "",
                requisites: { details: values.requisites ?? "" },
              }
            : {
                action: "contact.create",
                ...values,
                email: values.email ?? "",
                phone: values.phone ?? "",
                companyName: values.companyName ?? "",
                requisites: { details: values.requisites ?? "" },
              },
        );
      },
    );
  }
  async function caseForm(contactId?: string) {
    await perform(async () => {
      const contacts = await api(
          `contacts${contactId ? `?contactId=${encodeURIComponent(contactId)}` : ""}`,
        ),
        juroCases = await api("juro-cases"),
        pipelines = boot?.pipelines ?? [],
        selected = pipelines[0];
      const sources = [
        { value: "own_client", label: t(locale, "ownClient") },
        { value: "recommendation", label: t(locale, "recommendation") },
        { value: "website", label: t(locale, "website") },
        { value: "social", label: t(locale, "social") },
        { value: "juro_marketplace", label: "JURO" },
        ...(boot?.settings?.sources ?? []).map((value: string) => ({
          value,
          label: value,
        })),
      ];
      openForm(
        t(locale, "cases"),
        [
          {
            key: "existingCaseId",
            label: t(locale, "juroCases"),
            type: "remote",
            required: false,
            options: options(juroCases.items, "id", "title"),
            loadOptions: async (q) =>
              options(
                (await api(`juro-cases?q=${encodeURIComponent(q)}`)).items,
                "id",
                "title",
              ),
            help: t(locale, "juroCaseHelp"),
          },
          { key: "title", required: false },
          { key: "description", type: "textarea", required: false },
          {
            key: "contactId",
            type: "remote",
            options: options(contacts.items, "id", "name"),
            loadOptions: async (q) =>
              options(
                (await api(`contacts?q=${encodeURIComponent(q)}`)).items,
                "id",
                "name",
              ),
          },
          { key: "pipelineId", type: "select", options: options(pipelines) },
          {
            key: "stageId",
            type: "select",
            options: (values) =>
              options(
                pipelines.find((p: Row) => p.id === values.pipelineId)
                  ?.stages ?? [],
              ),
          },
          { key: "source", type: "select", options: sources },
          {
            key: "responsibleUserId",
            type: "select",
            options: memberOptions(),
          },
          { key: "expected", type: "number", min: 0, step: "0.01" },
          { key: "currency", type: "select", options: currencies },
          { key: "nextAction", required: false },
        ],
        {
          contactId: contactId ?? "",
          pipelineId: selected?.id ?? "",
          stageId: selected?.stages?.[0]?.id ?? "",
          source: "own_client",
          responsibleUserId: actor.userId,
          expected: "0",
          currency: "UZS",
        },
        async (values) => {
          if (!values.existingCaseId && !values.title?.trim())
            throw new Error(t(locale, "title"));
          const { existingCaseId, ...data } = values;
          const result = await command({
            action: "case.create",
            ...data,
            title: values.title || "JURO",
            ...(existingCaseId ? { existingCaseId } : {}),
            description: values.description ?? "",
            nextAction: values.nextAction ?? "",
          });
          setCaseId(result.id);
          setTab("cases");
        },
      );
    });
  }
  async function withCases(run: (items: Row[]) => void) {
    await perform(async () => {
      const result = await api(
        actor?.role === "accountant"
          ? "finance-matters"
          : `cases${caseId ? `?caseId=${encodeURIComponent(caseId)}` : ""}`,
      );
      run(result.items);
    });
  }
  async function taskForm() {
    await withCases((items) =>
      openForm(
        t(locale, "tasks"),
        [
          ...(!caseId ? [caseField(items)] : []),
          { key: "title" },
          { key: "description", type: "textarea", required: false },
          { key: "assigneeUserId", type: "select", options: memberOptions() },
          {
            key: "dueAt",
            type: "datetime-local",
            required: false,
            help: "Asia/Tashkent",
          },
          {
            key: "priority",
            type: "select",
            options: enumOptions(["low", "normal", "high", "urgent"]),
          },
          { key: "clientVisible", type: "checkbox" },
        ],
        { assigneeUserId: actor.userId, priority: "normal" },
        async (values) => {
          await command({
            action: "task.create",
            ...values,
            caseId: caseId || values.caseId,
            description: values.description ?? "",
            clientVisible: Boolean(values.clientVisible),
            dueAt: values.dueAt
              ? parseZonedDateTime(`${values.dueAt}[Asia/Tashkent]`, "reject")
                  .toDate()
                  .toISOString()
              : null,
          });
        },
      ),
    );
  }
  async function entryForm() {
    if (!caseId) return;
    openForm(
      t(locale, "entries"),
      [
        ...(!client
          ? [
              {
                key: "kind",
                type: "select" as const,
                options: enumOptions(["message", "note", "milestone"]),
              },
            ]
          : []),
        { key: "body", type: "textarea" },
      ],
      { kind: "message" },
      async (values) => {
        await command({
          action: "entry.create",
          caseId,
          kind: values.kind ?? "message",
          body: values.body,
          clientVisible: values.kind !== "note",
        });
      },
    );
  }
  async function eventForm(row?: Row) {
    await withCases((items) =>
      openForm(
        t(locale, "events"),
        [
          ...(!caseId ? [caseField(items)] : []),
          { key: "title" },
          { key: "organizerUserId", type: "select", options: memberOptions() },
          { key: "startsAt", type: "datetime-local" },
          { key: "endsAt", type: "datetime-local" },
          { key: "timezone" },
          { key: "clientVisible", type: "checkbox" },
        ],
        {
          title: row?.title ?? (client ? t(locale, "events") : ""),
          organizerUserId:
            row?.organizer_user_id ??
            (client ? boot?.members[0]?.user_id : actor.userId),
          timezone: row?.timezone ?? "Asia/Tashkent",
          clientVisible: row?.client_visible ?? true,
          startsAt: row?.starts_at
            ? parseAbsolute(new Date(row.starts_at).toISOString(), row.timezone)
                .toString()
                .slice(0, 16)
            : "",
          endsAt: row?.ends_at
            ? parseAbsolute(new Date(row.ends_at).toISOString(), row.timezone)
                .toString()
                .slice(0, 16)
            : "",
        },
        async (values) => {
          await command({
            action: "event.save",
            ...values,
            ...(row ? { eventId: row.id } : {}),
            caseId: caseId || values.caseId,
            clientVisible: Boolean(values.clientVisible),
            startsAt: parseZonedDateTime(
              `${values.startsAt}[${values.timezone}]`,
              "reject",
            )
              .toDate()
              .toISOString(),
            endsAt: parseZonedDateTime(
              `${values.endsAt}[${values.timezone}]`,
              "reject",
            )
              .toDate()
              .toISOString(),
          });
        },
      ),
    );
  }
  async function invoiceForm() {
    await withCases((items) =>
      dialog(
        t(locale, "invoices"),
        <InvoiceDialog
          locale={locale}
          api={api}
          cases={items}
          caseId={caseId}
          provider={boot?.provider ?? {}}
          submit={async (values) => {
            await command({ action: "invoice.create", ...values });
          }}
        />,
      ),
    );
  }
  function paymentForm(row: Row) {
    openForm(
      t(locale, "recordPayment"),
      [
        { key: "amount", type: "number", min: 0, step: "0.01" },
        { key: "receivedOn", type: "date" },
        {
          key: "method",
          type: "select",
          options: enumOptions(["bank", "cash", "other"]),
        },
        { key: "note", type: "textarea", required: false },
      ],
      { receivedOn: dateToday(), method: "bank", amount: "" },
      async (values) => {
        await command({
          action: "payment.confirm",
          invoiceId: row.id,
          ...values,
          note: values.note ?? "",
        });
      },
    );
  }
  function billTime(ids: string[]) {
    openForm(
      t(locale, "billTime"),
      [
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
        { key: "providerName", label: t(locale, "provider") },
        {
          key: "providerDetails",
          label: t(locale, "requisites"),
          type: "textarea",
        },
      ],
      {
        language: locale,
        issuedOn: dateToday(),
        dueOn: dateToday(),
        providerName: boot?.provider?.name ?? "",
        providerDetails: boot?.provider?.details ?? "",
      },
      async (values) => {
        await command({
          action: "time.invoice",
          timeEntryIds: ids,
          language: values.language,
          number: values.number,
          issuedOn: values.issuedOn,
          dueOn: values.dueOn,
          provider: {
            name: values.providerName,
            details: values.providerDetails,
          },
        });
        setSelectedTime([]);
      },
    );
  }
  async function financeForm(kind: string) {
    await withCases((items) => {
      const shared: Field[] = [
        ...(!caseId ? [caseField(items)] : []),
        ...(kind === "recurring"
          ? [
              {
                key: "language",
                type: "select" as const,
                options: [
                  { value: "ru", label: "Русский" },
                  { value: "uz", label: "O‘zbekcha" },
                  { value: "en", label: "English" },
                ],
              },
            ]
          : []),
      ];
      const fields: Field[] =
        kind === "time"
          ? [
              { key: "minutes", type: "number", min: 1 },
              { key: "hourlyRate", type: "number", min: 0, step: "0.01" },
              { key: "currency", type: "select", options: currencies },
              { key: "workedOn", type: "date" },
              { key: "description" },
            ]
          : [
              { key: "amount", type: "number", min: 0, step: "0.01" },
              { key: "currency", type: "select", options: currencies },
              {
                key: kind === "expenses" ? "incurredOn" : "nextOn",
                type: "date",
              },
              ...(kind === "expenses"
                ? [{ key: "paid", type: "checkbox" as const }]
                : [{ key: "intervalMonths", type: "number" as const, min: 1 }]),
              { key: "description" },
            ];
      openForm(
        t(locale, kind),
        [...shared, ...fields],
        {
          currency: "UZS",
          ...(kind === "recurring" ? { language: locale } : {}),
          incurredOn: dateToday(),
          nextOn: dateToday(),
          workedOn: dateToday(),
          intervalMonths: "1",
        },
        async (values) => {
          await command({
            action:
              kind === "expenses"
                ? "expense.create"
                : kind === "time"
                  ? "time.create"
                  : "recurring.create",
            ...values,
            caseId: caseId || values.caseId,
            ...(kind === "time"
              ? { minutes: Number(values.minutes) }
              : kind === "recurring"
                ? { intervalMonths: Number(values.intervalMonths) }
                : { paid: Boolean(values.paid) }),
          });
        },
      );
    });
  }
  async function documentForm() {
    await withCases((items) => {
      dialog(
        t(locale, "documents"),
        <NewDocumentDialog
          locale={locale}
          cases={items}
          caseId={caseId}
          api={api}
          provider={boot?.provider ?? {}}
          submit={async (values) => {
            const result = await command({
              action: "document.create",
              ...values,
            });
            setSelectedDocument(result.id);
            if (!caseId) setTab("documents");
            else setCaseTab("documents");
          }}
        />,
      );
    });
  }
  async function uploadForm() {
    if (!caseId) return;
    dialog(
      t(locale, "upload"),
      <UploadDialog
        locale={locale}
        caseId={caseId}
        api={api}
        done={() => {
          setModal(null);
          refresh();
        }}
      />,
    );
  }
  function openCase(row: Row) {
    setCaseId(row.id);
    setCaseRow(row);
    setCaseTab("tasks");
    setTab("cases");
    setPage(1);
    setQuery("");
  }
  function createCurrent() {
    const current = caseId && tab === "cases" ? caseTab : tab;
    if (current === "contacts") return contactForm();
    if (["cases", "leads"].includes(current)) return caseForm();
    if (current === "tasks") return taskForm();
    if (current === "entries") return entryForm();
    if (current === "events") return eventForm();
    if (current === "documents") return documentForm();
    if (current === "invoices") return invoiceForm();
    if (["expenses", "time", "recurring"].includes(current))
      return financeForm(current);
    if (current === "files") return uploadForm();
    if (current === "templates")
      dialog(
        t(locale, "templates"),
        <TemplateDialog
          locale={locale}
          api={api}
          submit={async (values) => {
            await command({ action: "template.save", ...values });
          }}
        />,
      );
  }
  const current = caseId && tab === "cases" ? caseTab : tab;
  const href = (path: string) =>
    `/api/practice/${path}${path.includes("?") ? "&" : "?"}workspaceId=${encodeURIComponent(workspaceId)}&locale=${locale}`;
  const nav = [
    "overview",
    ...(legal ? ["leads", "contacts"] : finance ? ["contacts"] : []),
    ...(actor?.role !== "accountant"
      ? ["cases", "tasks", "events", "documents"]
      : []),
    ...(legal ? ["templates"] : []),
    ...(finance ? ["time"] : []),
    ...(finance || client ? ["invoices", "payments"] : []),
    ...(finance ? ["expenses", "recurring", "reports"] : []),
    ...(manager ? ["team"] : []),
    ...(legal ? ["settings"] : []),
    "notifications",
  ];
  const items = (data.items ?? []).filter(
    (item: Row) =>
      !["cases", "leads"].includes(current) ||
      !pipeline ||
      item.pipeline_id === pipeline,
  );
  const createAllowed =
    writable &&
    !(current === "time" && actor?.role === "accountant") &&
    ![
      "overview",
      "payments",
      "reports",
      "team",
      "settings",
      "notifications",
      "ai",
      "detail",
      "plan",
      "materials",
    ].includes(current) &&
    (!client || ["entries", "events", "files"].includes(current));
  if (invitationToken)
    return (
      <div className="practice-invite">
        <img src="/brand/juro-logo-on-light.png" alt="JURO" />
        <h1>JURO Practice</h1>
        <h2>{boot?.workspaceName}</h2>
        <p>{t(locale, "clientConsent")}</p>
        <p>{t(locale, "inviteHelp")}</p>
        <button
          disabled={busy}
          onClick={() =>
            perform(async () => {
              await api("invitation/accept", { token: invitationToken });
              setNotice(t(locale, "pending"));
            })
          }
        >
          {t(locale, "accept")}
        </button>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    );
  return (
    <div className={`practice-app ${embedded ? "practice-embedded" : ""}`}>
      <aside className="practice-sidebar">
        <a className="practice-brand" href="/practice">
          <img src="/brand/juro-logo-on-dark.png" alt="JURO" />
          <span>Practice</span>
        </a>
        <small className="practice-pilot">{t(locale, "pilot")}</small>
        <label className="practice-workspace">
          {t(locale, "workspace")}
          <Select
            value={workspaceId}
            onChange={(event) => {
              window.location.href = `/practice?workspaceId=${encodeURIComponent(event.target.value)}&locale=${locale}`;
            }}
          >
            {(
              boot?.workspaces ?? [
                { id: workspaceId, name: t(locale, "loading") },
              ]
            ).map((workspace: Row) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </Select>
        </label>
        <nav aria-label="Practice">
          {nav.map((item) => {
            const Icon = icons[item] ?? FileText;
            return (
              <button
                key={item}
                className={tab === item ? "selected" : ""}
                onClick={() => navigate(item)}
              >
                <Icon size={17} />
                <span>{t(locale, item)}</span>
                {item === "overview" && <span className="nav-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="practice-sidebar-bottom">
          <span>{actor ? t(locale, actor.role) : "JURO"}</span>
          <Select
            aria-label={t(locale, "language")}
            value={locale}
            onChange={(event) => {
              window.location.href = `/practice?workspaceId=${encodeURIComponent(workspaceId)}&locale=${event.target.value}`;
            }}
          >
            <option value="ru">Русский</option>
            <option value="uz">O‘zbekcha</option>
            <option value="en">English</option>
          </Select>
          <a href={`/${locale}/dashboard`}>
            JURO <ArrowRight size={14} />
          </a>
        </div>
      </aside>
      <main className="practice-main">
        <header className="practice-topbar">
          <span>{boot?.workspace?.name ?? "JURO Practice"}</span>
          <span>{todayLabel}</span>
        </header>
        <div className="practice-content">
          <div className="practice-page-heading">
            <div>
              <p className="practice-eyebrow">JURO PRACTICE</p>
              <h1>
                {caseId && tab === "cases"
                  ? (caseRow?.title ?? t(locale, "cases"))
                  : tab === "overview"
                    ? t(locale, "homeTitle")
                    : t(locale, tab)}
              </h1>
              {tab === "overview" && (
                <p>{t(locale, "today")} · Asia/Tashkent</p>
              )}
            </div>
            <div className="practice-actions">
              {createAllowed && (
                <button
                  className="practice-primary"
                  disabled={busy}
                  onClick={createCurrent}
                >
                  <Plus size={17} />
                  {t(locale, "create")}
                </button>
              )}
              {current === "time" &&
                selectedTime.length > 0 &&
                writable &&
                finance && (
                  <button onClick={() => billTime(selectedTime)}>
                    {t(locale, "billTime")} ({selectedTime.length})
                  </button>
                )}
              {[
                "contacts",
                "cases",
                "leads",
                "invoices",
                "payments",
                "expenses",
                "time",
              ].includes(current) && (
                <a
                  className="practice-button"
                  href={href(
                    `${current === "leads" ? "cases" : current}?format=csv${caseId ? `&caseId=${encodeURIComponent(caseId)}` : ""}`,
                  )}
                >
                  {t(locale, "export")}
                </a>
              )}
              {legal &&
                ["contacts", "cases", "leads"].includes(current) &&
                writable && (
                  <button
                    onClick={() =>
                      dialog(
                        t(locale, "import"),
                        <ImportDialog
                          locale={locale}
                          kind={current === "contacts" ? "contacts" : "cases"}
                          api={api}
                          boot={boot!}
                          done={refresh}
                        />,
                      )
                    }
                  >
                    {t(locale, "import")}
                  </button>
                )}
            </div>
          </div>
          {actor && !writable && (
            <p className="practice-banner">{t(locale, "readonly")}</p>
          )}
          {error && (
            <div className="practice-error" role="alert">
              {error}
              <button onClick={refresh}>{t(locale, "retry")}</button>
            </div>
          )}
          {notice && (
            <div className="practice-toast" role="status">
              <Check size={15} />
              {notice}
              <button
                onClick={() => setNotice("")}
                aria-label={t(locale, "close")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {caseId && tab === "cases" && (
            <>
              <button
                className="practice-back"
                onClick={() => {
                  setCaseId("");
                  setSelectedDocument("");
                }}
              >
                <ArrowLeft size={15} />
                {t(locale, "cases")}
              </button>
              <div className="practice-case-meta">
                <span>{caseRow?.client_name}</span>
                <span>{caseRow?.client_status}</span>
                {legal && <span>{caseRow?.next_action}</span>}
              </div>
              <div className="practice-tabs">
                {[
                  "detail",
                  "plan",
                  "tasks",
                  "documents",
                  "materials",
                  "events",
                  "entries",
                  "files",
                  ...(finance || client ? ["invoices"] : []),
                  ...(finance ? ["payments", "expenses", "recurring"] : []),
                  ...(finance ? ["time"] : []),
                  ...(legal ? ["ai"] : []),
                ].map((item) => (
                  <button
                    key={item}
                    className={caseTab === item ? "selected" : ""}
                    onClick={() => {
                      setCaseTab(item);
                      setSelectedDocument("");
                      setPage(1);
                      setQuery("");
                    }}
                  >
                    {t(locale, item === "plan" ? "casePlan" : item)}
                  </button>
                ))}
              </div>
            </>
          )}
          {selectedDocument && (
            <DocumentEditor
              key={selectedDocument}
              id={selectedDocument}
              locale={locale}
              api={api}
              href={href}
              actor={actor}
              close={() => setSelectedDocument("")}
            />
          )}
          {!selectedDocument &&
            (loading ? (
              <p className="practice-loading" role="status">
                {t(locale, "loading")}
              </p>
            ) : tab === "overview" ? (
              <Overview
                locale={locale}
                data={data}
                boot={boot}
                navigate={navigate}
                openCase={openCase}
              />
            ) : current === "settings" ? (
              <SettingsPanel
                locale={locale}
                boot={boot!}
                api={api}
                command={command}
              />
            ) : current === "reports" ? (
              <Reports locale={locale} api={api} />
            ) : current === "team" ? (
              <Team
                locale={locale}
                data={data}
                command={command}
                api={api}
                workspaceId={workspaceId}
              />
            ) : current === "ai" ? (
              <AiPanel
                locale={locale}
                api={api}
                caseId={caseId}
                documents={items}
              />
            ) : current === "detail" ? (
              <CaseDetails
                locale={locale}
                row={caseRow!}
                boot={boot!}
                writable={writable && legal}
                manager={manager}
                api={api}
                command={command}
                openForm={openForm}
              />
            ) : (
              <>
                <div className="practice-list-tools">
                  <label className="practice-search">
                    <Search size={17} />
                    <input
                      placeholder={t(locale, "search")}
                      aria-label={t(locale, "search")}
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                  {["cases", "leads"].includes(current) && (
                    <>
                      <Select
                        aria-label={t(locale, "filter")}
                        value={pipeline}
                        onChange={(event) => setPipeline(event.target.value)}
                      >
                        <option value="">{t(locale, "all")}</option>
                        {(boot?.pipelines ?? []).map((p: Row) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                      <button onClick={() => setBoard(!board)}>
                        {t(locale, board ? "table" : "board")}
                      </button>
                    </>
                  )}
                  <Select
                    aria-label={t(locale, "status")}
                    value={sort}
                    onChange={(event) => setSort(event.target.value)}
                  >
                    <option value="updated">{t(locale, "today")}</option>
                    <option value="title">{t(locale, "title")}</option>
                  </Select>
                  <span>
                    {t(locale, "total")}: {data.total ?? items.length}
                  </span>
                </div>
                {items.length === 0 ? (
                  <div className="practice-empty">
                    <BriefcaseBusiness size={30} />
                    <h2>{t(locale, "empty")}</h2>
                    <p>{t(locale, client ? "awaitMaterials" : "emptyHelp")}</p>
                    {createAllowed && (
                      <button onClick={createCurrent}>
                        {t(locale, "create")}
                      </button>
                    )}
                  </div>
                ) : board && ["cases", "leads"].includes(current) ? (
                  <div className="practice-board">
                    {(pipeline
                      ? boot?.pipelines.filter((p: Row) => p.id === pipeline)
                      : (boot?.pipelines ?? [])
                    ).flatMap((p: Row) =>
                      p.stages.map((stage: Row) => (
                        <section key={`${p.id}:${stage.id}`}>
                          <header>
                            <span>
                              {p.name} · {stage.name}
                            </span>
                            <b>
                              {
                                items.filter(
                                  (row: Row) =>
                                    row.pipeline_id === p.id &&
                                    row.stage_id === stage.id,
                                ).length
                              }
                            </b>
                          </header>
                          {items
                            .filter(
                              (row: Row) =>
                                row.pipeline_id === p.id &&
                                row.stage_id === stage.id,
                            )
                            .map((row: Row) => (
                              <button
                                className="practice-board-card"
                                key={row.id}
                                onClick={() => openCase(row)}
                              >
                                <b>{row.title}</b>
                                <span>{row.client_name}</span>
                                {row.expected_minor !== null && (
                                  <span>
                                    {displayMoney(
                                      row.expected_minor,
                                      row.currency,
                                    )}
                                  </span>
                                )}
                                <small>{row.next_action}</small>
                              </button>
                            ))}
                        </section>
                      )),
                    )}
                  </div>
                ) : (
                  <div className="practice-table-wrap">
                    <table className="practice-table">
                      <thead>
                        <tr>
                          <th>
                            {t(
                              locale,
                              ["contacts", "templates"].includes(current)
                                ? "name"
                                : current === "invoices"
                                  ? "number"
                                  : "title",
                            )}
                          </th>
                          <th>
                            {t(
                              locale,
                              [
                                "invoices",
                                "payments",
                                "expenses",
                                "recurring",
                                "time",
                              ].includes(current)
                                ? "amount"
                                : "status",
                            )}
                          </th>
                          <th>{t(locale, "detail")}</th>
                          <th>
                            <span className="sr-only">{t(locale, "open")}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((row: Row) => (
                          <tr key={row.id ?? row.file_id}>
                            <td>
                              {current === "time" &&
                                !row.invoice_id &&
                                writable && (
                                  <input
                                    style={{ width: 17, marginRight: 10 }}
                                    type="checkbox"
                                    aria-label={`${t(locale, "billTime")}: ${row.description}`}
                                    checked={selectedTime.includes(row.id)}
                                    onChange={(event) =>
                                      setSelectedTime(
                                        event.target.checked
                                          ? [...selectedTime, row.id]
                                          : selectedTime.filter(
                                              (id) => id !== row.id,
                                            ),
                                      )
                                    }
                                  />
                                )}
                              <strong>
                                {row.title ??
                                  row.name ??
                                  row.number ??
                                  row.file_name ??
                                  row.description ??
                                  row.body ??
                                  t(locale, row.kind)}
                              </strong>
                              {(row.client_name || row.email) && (
                                <small>{row.client_name ?? row.email}</small>
                              )}
                            </td>
                            <td>
                              {[
                                "invoices",
                                "payments",
                                "expenses",
                                "recurring",
                                "time",
                              ].includes(current) ? (
                                <>
                                  <strong>
                                    {displayMoney(
                                      current === "time"
                                        ? (
                                            (BigInt(row.hourly_minor) *
                                              BigInt(row.minutes) +
                                              30n) /
                                            60n
                                          ).toString()
                                        : (row.total_minor ??
                                            row.amount_minor ??
                                            0),
                                      row.currency,
                                    )}
                                  </strong>
                                  {current === "templates" &&
                                    row.workspace_id &&
                                    manager &&
                                    writable && (
                                      <>
                                        <button
                                          onClick={() =>
                                            perform(() =>
                                              command({
                                                action: "template.publication",
                                                templateId: row.id,
                                                requested: true,
                                              }),
                                            )
                                          }
                                        >
                                          {t(locale, "requestPublication")}
                                        </button>
                                        <button
                                          onClick={() =>
                                            perform(() =>
                                              command({
                                                action: "template.publication",
                                                templateId: row.id,
                                                requested: false,
                                              }),
                                            )
                                          }
                                        >
                                          {t(locale, "revokePublication")}
                                        </button>
                                      </>
                                    )}
                                  {current === "invoices" && (
                                    <small>
                                      {t(
                                        locale,
                                        invoiceStatus(
                                          row.total_minor,
                                          row.paid_minor,
                                          String(row.due_on).slice(0, 10),
                                          dateToday(),
                                        ),
                                      )}{" "}
                                      · {t(locale, "outstanding")}:{" "}
                                      {displayMoney(
                                        Math.max(
                                          0,
                                          row.total_minor - row.paid_minor,
                                        ),
                                        row.currency,
                                      )}
                                    </small>
                                  )}
                                </>
                              ) : (
                                <span className="practice-badge">
                                  {t(
                                    locale,
                                    row.state ??
                                      (row.status === "open"
                                        ? "open_status"
                                        : row.status) ??
                                      row.priority ??
                                      row.kind ??
                                      "draft",
                                  )}
                                </span>
                              )}
                            </td>
                            <td>
                              {current === "cases" || current === "leads"
                                ? (boot?.pipelines
                                    .find((p: Row) => p.id === row.pipeline_id)
                                    ?.stages.find(
                                      (stage: Row) => stage.id === row.stage_id,
                                    )?.name ?? "")
                                : current === "tasks"
                                  ? row.due_at
                                    ? new Date(row.due_at).toLocaleString(
                                        locale,
                                        { timeZone: "Asia/Tashkent" },
                                      )
                                    : "—"
                                  : current === "events"
                                    ? new Date(row.starts_at).toLocaleString(
                                        locale,
                                        { timeZone: row.timezone },
                                      )
                                    : current === "notifications"
                                      ? t(
                                          locale,
                                          row.email_state === "retry"
                                            ? "retrying"
                                            : row.email_state,
                                        )
                                      : current === "payments" &&
                                          !client &&
                                          row.commission_minor != null
                                        ? `${t(locale, "commission")}: ${displayMoney(row.commission_minor, row.currency)}`
                                        : current === "time"
                                          ? `${row.minutes} ${t(locale, "minutes")}`
                                          : current === "entries"
                                            ? row.client_visible
                                              ? t(locale, "clientVisible")
                                              : t(locale, "note")
                                            : ""}
                            </td>
                            <td>
                              <div className="practice-row-actions">
                                {["cases", "leads"].includes(current) && (
                                  <button onClick={() => openCase(row)}>
                                    {t(locale, "open")} <ArrowRight size={14} />
                                  </button>
                                )}
                                {current === "contacts" && (
                                  <>
                                    {writable && legal && (
                                      <button onClick={() => contactForm(row)}>
                                        {t(locale, "edit")}
                                      </button>
                                    )}
                                    {writable && legal && (
                                      <button onClick={() => caseForm(row.id)}>
                                        {t(locale, "cases")}
                                      </button>
                                    )}
                                    {manager && writable && (
                                      <button
                                        onClick={() =>
                                          perform(async () => {
                                            const result = await command(
                                              {
                                                action: "invitation.create",
                                                contactId: row.id,
                                              },
                                              false,
                                            );
                                            dialog(
                                              t(locale, "inviteClient"),
                                              <>
                                                <p>{t(locale, "inviteHelp")}</p>
                                                <input
                                                  readOnly
                                                  aria-label={t(
                                                    locale,
                                                    "invite",
                                                  )}
                                                  value={`${window.location.origin}/practice?invite=${result.token}&locale=${locale}`}
                                                  onFocus={(event) =>
                                                    event.target.select()
                                                  }
                                                />
                                              </>,
                                            );
                                          })
                                        }
                                      >
                                        {t(locale, "invite")}
                                      </button>
                                    )}
                                  </>
                                )}
                                {current === "tasks" &&
                                  legal &&
                                  writable &&
                                  row.status !== "completed" && (
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        perform(() =>
                                          command({
                                            action: "task.update",
                                            caseId: row.case_id,
                                            taskId: row.id,
                                            status: "completed",
                                          }),
                                        )
                                      }
                                    >
                                      {t(locale, "complete")}
                                    </button>
                                  )}
                                {current === "documents" && (
                                  <button
                                    onClick={() => setSelectedDocument(row.id)}
                                  >
                                    {t(locale, "open")}
                                  </button>
                                )}
                                {current === "templates" &&
                                  writable &&
                                  legal && (
                                    <button
                                      onClick={() =>
                                        dialog(
                                          t(locale, "templates"),
                                          <TemplateDialog
                                            locale={locale}
                                            api={api}
                                            template={row}
                                            submit={async (values) => {
                                              await command({
                                                action: "template.save",
                                                ...values,
                                              });
                                            }}
                                          />,
                                        )
                                      }
                                    >
                                      {t(locale, "edit")}
                                    </button>
                                  )}
                                {current === "invoices" && (
                                  <>
                                    <a
                                      href={href(
                                        `export/invoice/${row.id}?format=pdf`,
                                      )}
                                    >
                                      PDF
                                    </a>
                                    <a
                                      href={href(
                                        `export/invoice/${row.id}?format=docx`,
                                      )}
                                    >
                                      DOCX
                                    </a>
                                    {finance && writable && (
                                      <button onClick={() => paymentForm(row)}>
                                        {t(locale, "recordPayment")}
                                      </button>
                                    )}
                                  </>
                                )}
                                {current === "payments" &&
                                  finance &&
                                  writable &&
                                  row.amount_minor > 0 && (
                                    <>
                                      <button
                                        onClick={() =>
                                          openForm(
                                            t(locale, "reverse"),
                                            [
                                              {
                                                key: "reason",
                                                type: "textarea",
                                              },
                                              {
                                                key: "receivedOn",
                                                type: "date",
                                              },
                                            ],
                                            { receivedOn: dateToday() },
                                            async (values) => {
                                              await command({
                                                action: "payment.reverse",
                                                paymentId: row.id,
                                                ...values,
                                              });
                                            },
                                          )
                                        }
                                      >
                                        {t(locale, "reverse")}
                                      </button>
                                      <button
                                        onClick={() =>
                                          openForm(
                                            t(locale, "refund"),
                                            [
                                              {
                                                key: "amount",
                                                type: "number",
                                                min: 0,
                                                step: "0.01",
                                              },
                                              {
                                                key: "reason",
                                                type: "textarea",
                                              },
                                              {
                                                key: "receivedOn",
                                                type: "date",
                                              },
                                            ],
                                            { receivedOn: dateToday() },
                                            async (values) => {
                                              await command({
                                                action: "payment.refund",
                                                paymentId: row.id,
                                                ...values,
                                              });
                                            },
                                          )
                                        }
                                      >
                                        {t(locale, "refund")}
                                      </button>
                                    </>
                                  )}
                                {current === "time" &&
                                  writable &&
                                  !row.invoice_id && (
                                    <button onClick={() => billTime([row.id])}>
                                      {t(locale, "billTime")}
                                    </button>
                                  )}
                                {current === "time" && row.invoice_id && (
                                  <a
                                    href={href(
                                      `export/invoice/${row.invoice_id}?format=pdf`,
                                    )}
                                  >
                                    {t(locale, "invoices")}
                                  </a>
                                )}
                                {current === "recurring" && writable && (
                                  <button
                                    onClick={() =>
                                      perform(() =>
                                        command({
                                          action: "recurring.toggle",
                                          serviceId: row.id,
                                          active: !row.active,
                                        }),
                                      )
                                    }
                                  >
                                    {t(locale, row.active ? "pause" : "resume")}
                                  </button>
                                )}
                                {current === "events" &&
                                  writable &&
                                  ["confirmed", "proposed"].includes(
                                    row.status,
                                  ) &&
                                  (row.source !== "juro" ||
                                    row.organizer_user_id === actor.userId) && (
                                    <button onClick={() => eventForm(row)}>
                                      {t(locale, "edit")}
                                    </button>
                                  )}
                                {current === "events" &&
                                  writable &&
                                  client &&
                                  row.source === "juro" &&
                                  row.status === "proposed" && (
                                    <button
                                      onClick={() =>
                                        perform(() =>
                                          command({
                                            action: "event.confirm",
                                            eventId: row.id,
                                          }),
                                        )
                                      }
                                    >
                                      {t(locale, "confirm")}
                                    </button>
                                  )}
                                {current === "events" &&
                                  writable &&
                                  row.status !== "cancelled" &&
                                  (row.source !== "juro" ||
                                    row.organizer_user_id === actor.userId ||
                                    client) && (
                                    <button
                                      onClick={() =>
                                        perform(() =>
                                          command({
                                            action: "event.cancel",
                                            eventId: row.id,
                                          }),
                                        )
                                      }
                                    >
                                      {t(locale, "cancel")}
                                    </button>
                                  )}
                                {current === "entries" &&
                                  row.kind === "milestone" &&
                                  client &&
                                  !row.confirmed_by &&
                                  writable && (
                                    <button
                                      onClick={() =>
                                        perform(() =>
                                          command({
                                            action: "entry.confirm",
                                            caseId,
                                            entryId: row.id,
                                          }),
                                        )
                                      }
                                    >
                                      {t(locale, "confirm")}
                                    </button>
                                  )}
                                {current === "materials" && (
                                  <>
                                    <a
                                      href={href(
                                        `export/material/${row.id}?format=pdf`,
                                      )}
                                    >
                                      PDF
                                    </a>
                                    <a
                                      href={href(
                                        `export/material/${row.id}?format=docx`,
                                      )}
                                    >
                                      DOCX
                                    </a>
                                    <button
                                      onClick={() =>
                                        perform(async () => {
                                          const files = await api(
                                            `source-files?documentId=${row.id}`,
                                          );
                                          dialog(
                                            t(locale, "files"),
                                            <div>
                                              {files.items.map((file: Row) => (
                                                <p key={file.id}>
                                                  <a
                                                    href={href(
                                                      `source-files/${file.id}`,
                                                    )}
                                                  >
                                                    {file.file_name}
                                                  </a>
                                                </p>
                                              ))}
                                            </div>,
                                          );
                                        })
                                      }
                                    >
                                      {t(locale, "files")}
                                    </button>
                                  </>
                                )}
                                {current === "files" && (
                                  <>
                                    <a href={href(`files/${row.id}`)}>
                                      {t(locale, "open")}
                                    </a>
                                    {legal && writable && (
                                      <button
                                        onClick={() =>
                                          perform(() =>
                                            command({
                                              action: "file.visibility",
                                              fileId: row.id,
                                              clientVisible:
                                                !row.client_visible,
                                            }),
                                          )
                                        }
                                      >
                                        {t(
                                          locale,
                                          row.client_visible
                                            ? "private"
                                            : "clientVisible",
                                        )}
                                      </button>
                                    )}
                                  </>
                                )}
                                {current === "notifications" &&
                                  !row.read_at && (
                                    <button
                                      onClick={() =>
                                        perform(() =>
                                          command({
                                            action: "notification.read",
                                            notificationId: row.id,
                                          }),
                                        )
                                      }
                                    >
                                      {t(locale, "markRead")}
                                    </button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.pageSize && (
                  <div className="practice-pagination">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      {t(locale, "previous")}
                    </button>
                    <span>{page}</span>
                    <button
                      disabled={page * data.pageSize >= data.total}
                      onClick={() => setPage(page + 1)}
                    >
                      {t(locale, "next")}
                    </button>
                  </div>
                )}
              </>
            ))}
        </div>
      </main>
      {modal}
    </div>
  );
}

function Overview({
  locale,
  data,
  boot,
  navigate,
  openCase,
}: {
  locale: Locale;
  data: Row;
  boot: Row | null;
  navigate: (tab: string) => void;
  openCase: (row: Row) => void;
}) {
  const blocks =
    boot?.preferences?.blocks ??
    ["tasks", "cases", "calendar", "finance", "leads"].map((id) => ({
      id,
      visible: true,
    }));
  return (
    <>
      <div className="practice-summary">
        {[
          ["cases", data.cases?.total],
          ["tasks", data.tasks?.total],
          ["events", data.events?.total],
        ]
          .filter(([, value]) => value != null)
          .map(([label, value]) => (
            <button key={label} onClick={() => navigate(String(label))}>
              <span>{t(locale, String(label))}</span>
              <strong>{value}</strong>
              <ArrowRight size={18} />
            </button>
          ))}
      </div>
      <div className="practice-dashboard-grid">
        {blocks
          .filter((block: Row) => block.visible)
          .map((block: Row) => {
            if (block.id === "finance" && !data.report) return null;
            if (boot?.actor?.role === "accountant" && block.id !== "finance")
              return null;
            const rows =
              block.id === "tasks"
                ? (data.tasks?.items ?? [])
                : block.id === "calendar"
                  ? (data.events?.items ?? [])
                  : block.id === "leads"
                    ? (data.leads?.items ?? [])
                    : (data.cases?.items ?? []);
            return (
              <section
                className={`practice-panel ${block.id === "cases" ? "wide" : ""}`}
                key={block.id}
              >
                <header>
                  <h2>
                    {t(
                      locale,
                      block.id === "calendar"
                        ? "events"
                        : block.id === "finance"
                          ? "invoices"
                          : block.id,
                    )}
                  </h2>
                  <button
                    onClick={() =>
                      navigate(
                        block.id === "calendar"
                          ? "events"
                          : block.id === "finance"
                            ? "invoices"
                            : block.id,
                      )
                    }
                  >
                    {t(locale, "all")} <ArrowRight size={14} />
                  </button>
                </header>
                {block.id === "finance" ? (
                  data.report.groups.length ? (
                    data.report.groups.map((row: Row) => (
                      <div
                        className="practice-dashboard-row"
                        key={row.currency}
                      >
                        <div>
                          <b>
                            {displayMoney(row.received_minor, row.currency)}
                          </b>
                          <small>{t(locale, "payments")}</small>
                        </div>
                        <div>
                          <b>
                            {displayMoney(row.outstanding_minor, row.currency)}
                          </b>
                          <small>{t(locale, "outstanding")}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="practice-muted">{t(locale, "emptyHelp")}</p>
                  )
                ) : (
                  rows.slice(0, 6).map((row: Row) => (
                    <button
                      className="practice-dashboard-row"
                      key={row.id}
                      onClick={() =>
                        block.id === "cases" || block.id === "leads"
                          ? openCase(row)
                          : navigate(
                              block.id === "calendar" ? "events" : block.id,
                            )
                      }
                    >
                      <span className="practice-small-icon">
                        {block.id === "tasks" ? (
                          <Check size={15} />
                        ) : (
                          <BriefcaseBusiness size={15} />
                        )}
                      </span>
                      <div>
                        <b>{row.title}</b>
                        <small>
                          {row.next_action ??
                            row.client_name ??
                            (row.due_at
                              ? new Date(row.due_at).toLocaleDateString(
                                  locale,
                                  { timeZone: "Asia/Tashkent" },
                                )
                              : "")}
                        </small>
                      </div>
                      <ArrowRight size={14} />
                    </button>
                  ))
                )}
                {block.id !== "finance" && rows.length === 0 && (
                  <p className="practice-muted">{t(locale, "emptyHelp")}</p>
                )}
              </section>
            );
          })}
      </div>
    </>
  );
}
function Reports({
  locale,
  api,
}: {
  locale: Locale;
  api: (path: string, payload?: unknown) => Promise<any>;
}) {
  const [report, setReport] = useState<Row | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("reports")
      .then(setReport)
      .catch((error) => setError(error.message));
  }, [api]);
  return (
    <section className="practice-panel">
      <ActionForm
        locale={locale}
        fields={[
          { key: "from", type: "date" },
          { key: "to", type: "date" },
          {
            key: "group",
            type: "select",
            options: ["currency", "client", "lawyer", "case"].map((value) => ({
              value,
              label: t(locale, value === "case" ? "caseId" : value),
            })),
          },
        ]}
        initial={{
          from: `${new Date().getUTCFullYear()}-01-01`,
          to: dateToday(),
          group: "currency",
        }}
        label={t(locale, "reports")}
        submit={async (values) => {
          setReport(await api(`reports?${new URLSearchParams(values)}`));
        }}
      />
      <p>{t(locale, "noMix")}</p>
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <p>
            {report.from} — {report.to}
          </p>
          <div className="practice-table-wrap">
            <table className="practice-table">
              <thead>
                <tr>
                  {[
                    "group",
                    "invoices",
                    "payments",
                    "outstanding",
                    "commission",
                  ].map((key) => (
                    <th key={key}>{t(locale, key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.groups.map((row: Row, index: number) => (
                  <tr key={index}>
                    <td>{row.group_id}</td>
                    {[
                      "invoiced_minor",
                      "received_minor",
                      "outstanding_minor",
                      "commission_minor",
                    ].map((key) => (
                      <td key={key}>{displayMoney(row[key], row.currency)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>{t(locale, "expenses")}</h3>
          {report.expenses.map((row: Row) => (
            <p key={row.currency}>
              {t(locale, "paid")}: {displayMoney(row.paid_minor, row.currency)}{" "}
              · {t(locale, "expected")}:{" "}
              {displayMoney(row.expected_minor, row.currency)}
            </p>
          ))}
          <h3>{t(locale, "conversions")}</h3>
          {(report.conversions ?? []).map((row: Row, index: number) => (
            <p key={index}>
              {t(locale, row.kind)} · {row.base_currency ?? "—"}:{" "}
              {row.converted_minor != null
                ? displayMoney(row.converted_minor, row.base_currency)
                : "—"}{" "}
              · {t(locale, "missingRates")}: {row.missing_rates}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
function Team({
  locale,
  data,
  command,
  api,
  workspaceId,
}: {
  locale: Locale;
  data: Row;
  command: (input: Row) => Promise<any>;
  api: (path: string, payload?: unknown) => Promise<any>;
  workspaceId: string;
}) {
  return (
    <div className="practice-stack">
      <section className="practice-panel">
        <h2>{t(locale, "team")}</h2>
        {(data.members ?? []).map((member: Row) => (
          <div className="practice-dashboard-row" key={member.id}>
            <b>{member.name ?? "JURO"}</b>
            <span>{t(locale, member.role)}</span>
            {!["owner", "admin"].includes(member.role) && (
              <ActionForm
                locale={locale}
                fields={[
                  {
                    key: "role",
                    type: "select",
                    options: ["lawyer", "assistant", "accountant"].map(
                      (value) => ({ value, label: t(locale, value) }),
                    ),
                  },
                  { key: "active", type: "checkbox" },
                ]}
                initial={{
                  role: ["lawyer", "assistant", "accountant"].includes(
                    member.role,
                  )
                    ? member.role
                    : "assistant",
                  active: member.status === "active",
                }}
                submit={async (values) => {
                  await command({
                    action: "member.role",
                    memberId: member.id,
                    ...values,
                  });
                }}
              />
            )}
          </div>
        ))}
      </section>
      <section className="practice-panel">
        <h2>{t(locale, "invite")}</h2>
        <ActionForm
          locale={locale}
          fields={[
            { key: "email" },
            {
              key: "role",
              type: "select",
              options: ["lawyer", "assistant", "accountant"].map((value) => ({
                value,
                label: t(locale, value),
              })),
            },
          ]}
          initial={{ role: "lawyer" }}
          submit={async (values) => {
            const response = await fetch("/api/platform/team", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-juro-csrf": "1",
                "x-juro-locale": locale,
              },
              body: JSON.stringify({ ...values, locale, workspaceId }),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error ?? t(locale, "failed"));
          }}
        />
      </section>
      <section className="practice-panel">
        <h2>{t(locale, "inviteClient")}</h2>
        <p>{t(locale, "inviteHelp")}</p>
        {(data.invitations ?? []).map((invite: Row) => (
          <div className="practice-dashboard-row" key={invite.id}>
            <div>
              <b>{invite.client_name}</b>
              <small>{invite.accepted_name ?? t(locale, "pending")}</small>
            </div>
            <span>
              {invite.confirmed_at ? t(locale, "active") : t(locale, "pending")}
            </span>
            {!invite.revoked_at && (
              <ActionForm
                locale={locale}
                fields={[
                  {
                    key: "choice",
                    label: t(locale, "confirm"),
                    type: "select",
                    options: [
                      { value: "confirm", label: t(locale, "confirm") },
                      { value: "revoke", label: t(locale, "revoke") },
                    ],
                  },
                ]}
                initial={{
                  choice:
                    invite.accepted_by && !invite.confirmed_at
                      ? "confirm"
                      : "revoke",
                }}
                submit={async (values) => {
                  await command({
                    action: `invitation.${values.choice}`,
                    invitationId: invite.id,
                  });
                }}
              />
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
function AiPanel({
  locale,
  api,
  caseId,
  documents,
}: {
  locale: Locale;
  api: (path: string, payload?: unknown) => Promise<any>;
  caseId: string;
  documents: Row[];
}) {
  const [result, setResult] = useState<Row | null>(null);
  useEffect(() => {
    api(`ai-drafts?caseId=${encodeURIComponent(caseId)}`)
      .then((value) => {
        if (value.items[0]) setResult(value.items[0].result);
      })
      .catch(() => {});
  }, [api, caseId]);
  return (
    <section className="practice-panel">
      <h2>{t(locale, "ai")}</h2>
      <p>{t(locale, "aiReview")}</p>
      <ActionForm
        locale={locale}
        fields={[
          {
            key: "task",
            label: t(locale, "kind"),
            type: "select",
            options: ["summary", "tasks", "plan", "document"].map((value) => ({
              value,
              label: t(locale, value),
            })),
          },
          { key: "instruction", type: "textarea", required: false },
          {
            key: "documentIds",
            label: t(locale, "selectMaterials"),
            type: "multi",
            options: documents.map((doc) => ({
              value: doc.id,
              label: doc.title,
            })),
          },
        ]}
        initial={{ task: "summary", documentIds: [] }}
        label={t(locale, "generate")}
        submit={async (values) => {
          setResult(
            await api("ai", {
              ...values,
              instruction: values.instruction ?? "",
              caseId,
            }),
          );
        }}
      />
      {result && (
        <div className="practice-ai-result">
          <p>{result.summary}</p>
          {result.facts?.map((fact: string, i: number) => (
            <p key={i}>{fact}</p>
          ))}
          {result.uncertainties?.map((fact: string, i: number) => (
            <p key={i}>? {fact}</p>
          ))}
          {result.proposedTasks?.map((task: Row, i: number) => (
            <p key={i}>
              {task.title} — {task.deadlineEvidence}
            </p>
          ))}
          <pre>{result.draft}</pre>
        </div>
      )}
    </section>
  );
}
function CaseDetails({
  locale,
  row,
  boot,
  writable,
  manager,
  api,
  command,
  openForm,
}: {
  locale: Locale;
  row: Row;
  boot: Row;
  writable: boolean;
  manager: boolean;
  api: (path: string) => Promise<any>;
  command: (input: Row) => Promise<any>;
  openForm: (
    title: string,
    fields: Field[],
    initial: Row,
    submit: (values: Row) => Promise<void>,
  ) => void;
}) {
  if (!row) return null;
  const pipeline = boot.pipelines.find((p: Row) => p.id === row.pipeline_id);
  return (
    <section className="practice-panel">
      <p className="practice-prewrap">{row.description}</p>
      <p>{row.next_action}</p>
      <dl>
        {Object.entries(row.custom_fields ?? {}).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
      {writable && (
        <div className="practice-actions">
          <button
            onClick={() =>
              openForm(
                t(locale, "edit"),
                [
                  {
                    key: "stageId",
                    type: "select",
                    options: (pipeline?.stages ?? []).map((stage: Row) => ({
                      value: stage.id,
                      label: stage.name,
                    })),
                  },
                  { key: "nextAction", type: "textarea", required: false },
                  { key: "clientStatus", type: "textarea", required: false },
                  ...Object.keys(row.custom_fields ?? {}).map((key) => ({
                    key: `custom_${key}`,
                    label: key,
                    type: ((row.custom_schema ?? []).find(
                      (field: Row) => field.label === key,
                    )?.type === "boolean"
                      ? "checkbox"
                      : ((row.custom_schema ?? []).find(
                          (field: Row) => field.label === key,
                        )?.type ?? "text")) as Field["type"],
                    required: false,
                  })),
                ],
                {
                  stageId: row.stage_id,
                  nextAction: row.next_action,
                  clientStatus: row.client_status ?? "",
                  ...Object.fromEntries(
                    Object.entries(row.custom_fields ?? {}).map(
                      ([key, value]) => [`custom_${key}`, value],
                    ),
                  ),
                },
                async (values) => {
                  const customFields = { ...row.custom_fields };
                  for (const key of Object.keys(customFields)) {
                    const type = (row.custom_schema ?? []).find(
                      (field: Row) => field.label === key,
                    )?.type;
                    customFields[key] =
                      type === "number"
                        ? Number(values[`custom_${key}`] ?? customFields[key])
                        : type === "boolean"
                          ? Boolean(values[`custom_${key}`])
                          : (values[`custom_${key}`] ?? customFields[key]);
                  }
                  await command({
                    action: "case.update",
                    caseId: row.id,
                    revision: row.revision,
                    stageId: values.stageId,
                    nextAction: values.nextAction ?? "",
                    clientStatus: values.clientStatus ?? "",
                    customFields,
                  });
                },
              )
            }
          >
            {t(locale, "edit")}
          </button>
          {manager && (
            <button
              onClick={() =>
                openForm(
                  t(locale, "assign"),
                  [
                    {
                      key: "userIds",
                      label: t(locale, "team"),
                      type: "multi",
                      options: boot.members
                        .filter((member: Row) => member.role !== "accountant")
                        .map((member: Row) => ({
                          value: member.user_id,
                          label: member.name,
                        })),
                    },
                  ],
                  { userIds: [] },
                  async (values) => {
                    await command({
                      action: "case.assign",
                      caseId: row.id,
                      userIds: values.userIds,
                    });
                  },
                )
              }
            >
              {t(locale, "assign")}
            </button>
          )}
          <button
            onClick={async () => {
              const templates = await api("case-templates");
              openForm(
                t(locale, "start"),
                [
                  {
                    key: "templateId",
                    label: t(locale, "templates"),
                    type: "select",
                    options: templates.items.map((template: Row) => ({
                      value: template.id,
                      label: template.name,
                    })),
                  },
                ],
                {},
                async (values) => {
                  await command({
                    action: "case.start",
                    caseId: row.id,
                    templateId: values.templateId,
                  });
                },
              );
            }}
          >
            {t(locale, "start")}
          </button>
        </div>
      )}
    </section>
  );
}
function UploadDialog({
  locale,
  caseId,
  api,
  done,
}: {
  locale: Locale;
  caseId: string;
  api: (path: string, payload?: unknown, form?: FormData) => Promise<any>;
  done: () => void;
}) {
  const [purpose, setPurpose] = useState("material"),
    [error, setError] = useState("");
  return (
    <form
      className="practice-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const form = new FormData(event.currentTarget);
        form.set("caseId", caseId);
        form.set("purpose", purpose);
        form.set("clientVisible", String(form.has("clientVisible")));
        try {
          await api("uploads", undefined, form);
          done();
        } catch (error) {
          setError((error as Error).message);
        }
      }}
    >
      <label>
        {t(locale, "kind")}
        <Select
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
        >
          <option value="material">{t(locale, "material")}</option>
          <option value="payment_evidence">
            {t(locale, "payment_evidence")}
          </option>
        </Select>
      </label>
      <label>
        {t(locale, "upload")}
        <input
          required
          type="file"
          name="file"
          accept=".pdf,.docx,.png,.jpg,.jpeg"
        />
      </label>
      <label>
        <input type="checkbox" name="clientVisible" />
        {t(locale, "clientVisible")}
      </label>
      <p>{t(locale, "manualPayment")}</p>
      {error && <p role="alert">{error}</p>}
      <button className="practice-primary">{t(locale, "upload")}</button>
    </form>
  );
}
