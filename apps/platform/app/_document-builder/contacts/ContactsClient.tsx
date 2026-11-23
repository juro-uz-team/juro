"use client";

import { WorkspacePagination, useWorkspacePagination } from "../../_platform/WorkspacePagination";
import { WorkspaceTitle } from "../../_platform/WorkspaceTitle";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BookUser, Pencil, Plus, Search, Trash2, UserRound } from "lucide-react";
import type { ChatGPTUser } from "../../chatgpt-auth";
import type { ContactRecord, IdentityDocumentType } from "../../../lib/document-builder/types";
import { BuilderHeader } from "../_components/BuilderHeader";
import { BuilderFormLocaleProvider, DateField, InputField, SelectField, TextAreaField } from "../_components/FormControls";
import { apiFetch } from "../_components/api-client";
import { builderNavigationPaths } from "../../../lib/platform/builder-paths";
import { workspaceCopy } from "../../../lib/platform/builder-workspace-copy";
import { builderError, builderText } from "../builder-localization";

type ContactForm = Omit<ContactRecord, "id" | "createdAt" | "updatedAt">;
const empty: ContactForm = { label: "", fullName: "", birthDate: "", idDocumentType: "", idDocumentNumber: "", idIssuedBy: "", idIssueDate: "", pinfl: "", registeredAddress: "", phone: "" };

export function ContactsClient({ user, signInPath }: { user: ChatGPTUser; signInPath: string }) {
  const paths = builderNavigationPaths(usePathname());
  const locale = paths.locale;
  const copy = workspaceCopy(locale).contacts;
  const pinflHelp = builderText(locale, {
    ru: "14 цифр без букв и пробелов",
    uz: "Harflar va bo‘shliqlarsiz 14 ta raqam",
    en: "14 digits without letters or spaces",
  });
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<ContactForm>(empty);
  const [editingId, setEditingId] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLFormElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const load = useCallback(() => apiFetch<{ contacts: ContactRecord[] }>("/api/document-builder/contacts").then((result) => setContacts(result.contacts)).catch((caught: unknown) => setError(builderError(locale, caught, copy.saveError))), [copy.saveError, locale]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])")]
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
      window.setTimeout(() => returnFocusRef.current?.focus(), 0);
    };
  }, [open]);
  const update = (field: keyof ContactForm, value: string) => setForm((current) => ({
    ...current,
    [field]: field === "pinfl" ? value.replace(/[^0-9]/g, "").slice(0, 14) : value,
  }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      await apiFetch(editingId ? `/api/document-builder/contacts/${editingId}` : "/api/document-builder/contacts", { method: editingId ? "PUT" : "POST", body: JSON.stringify(form) });
      setOpen(false); setForm(empty); setEditingId(""); await load();
    } catch (caught) { setError(builderError(locale, caught, copy.saveError)); }
  };
  const edit = (contact: ContactRecord) => { setEditingId(contact.id); setForm({ label: contact.label, fullName: contact.fullName, birthDate: contact.birthDate ?? "", idDocumentType: contact.idDocumentType ?? "", idDocumentNumber: contact.idDocumentNumber ?? "", idIssuedBy: contact.idIssuedBy ?? "", idIssueDate: contact.idIssueDate ?? "", pinfl: contact.pinfl ?? "", registeredAddress: contact.registeredAddress ?? "", phone: contact.phone ?? "" }); setOpen(true); };
  const filtered = contacts.filter((contact) => `${contact.label} ${contact.fullName} ${contact.phone}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const pagination = useWorkspacePagination(filtered.length, 6, search);
  return <div className="dbt-root"><BuilderHeader user={user} signInPath={signInPath}/><div className="dbt-simple-page workspace-page"><WorkspaceTitle icon={<BookUser />} title={copy.title} description={<>{contacts.length} {copy.count}</>} actions={ <><button type="button" onClick={() => { setForm(empty); setEditingId(""); setOpen(true); }}><Plus size={18}/>{copy.add}</button></> } />{error && <div className="dbt-global-error" role="alert"><span>{error}</span><button type="button" aria-label={copy.close} title={copy.close} onClick={() => setError("")}>×</button></div>}<label className="dbt-doc-search dbt-contact-search"><Search size={18}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.search} aria-label={copy.search}/></label>{filtered.length ? <><div className="dbt-contact-list">{filtered.slice(pagination.from, pagination.to).map((contact) => <article key={contact.id}><span><UserRound size={22}/></span><div><strong>{contact.label}</strong><h2>{contact.fullName}</h2><p>{[contact.idDocumentNumber, contact.phone].filter(Boolean).join(" · ") || copy.missing}</p></div><button type="button" onClick={() => edit(contact)}><Pencil size={17}/>{copy.edit}</button><button type="button" className="danger" aria-label={`${copy.remove}: ${contact.fullName}`} onClick={async () => { await apiFetch(`/api/document-builder/contacts/${contact.id}`, { method: "DELETE" }); await load(); }}><Trash2 size={17}/></button></article>)}</div><WorkspacePagination locale={locale ?? "ru"} {...pagination} /></> : <div className="dbt-empty-state"><BookUser size={38}/><h2>{copy.emptyTitle}</h2><p>{copy.emptyBody}</p></div>}
    {open && <div className="dbt-modal-backdrop" onMouseDown={() => setOpen(false)}><form ref={dialogRef} className="dbt-contact-form" role="dialog" aria-modal="true" aria-labelledby="contact-form-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><header><h2 id="contact-form-title">{editingId ? copy.editTitle : copy.newTitle}</h2><button type="button" onClick={() => setOpen(false)} aria-label={copy.close}>×</button></header><BuilderFormLocaleProvider locale={locale ?? "ru"}><div className="dbt-fields-grid"><InputField label={copy.label} value={form.label} onChange={(event) => update("label", event.target.value)} required example={copy.labelExample}/><InputField label={copy.fullName} value={form.fullName} onChange={(event) => update("fullName", event.target.value)} required/><DateField label={copy.birthDate} value={form.birthDate ?? ""} onChange={(value) => update("birthDate", value)}/><SelectField label={copy.documentType} value={form.idDocumentType ?? ""} onChange={(event) => update("idDocumentType", event.target.value as IdentityDocumentType)}><option value="">{copy.notSelected}</option><option value="passport">{copy.passport}</option><option value="id_card">{copy.idCard}</option></SelectField><InputField label={copy.documentNumber} value={form.idDocumentNumber ?? ""} onChange={(event) => update("idDocumentNumber", event.target.value)}/><InputField label={copy.issuedBy} value={form.idIssuedBy ?? ""} onChange={(event) => update("idIssuedBy", event.target.value)}/><DateField label={copy.issueDate} value={form.idIssueDate ?? ""} onChange={(value) => update("idIssueDate", value)}/><InputField label={copy.pinfl} value={form.pinfl ?? ""} inputMode="numeric" maxLength={14} pattern="[0-9]{14}" onChange={(event) => update("pinfl", event.target.value)} help={pinflHelp}/><InputField label={copy.phone} value={form.phone ?? ""} onChange={(event) => update("phone", event.target.value)}/><TextAreaField label={copy.address} value={form.registeredAddress ?? ""} onChange={(event) => update("registeredAddress", event.target.value)} className="dbt-field-wide" rows={2}/></div></BuilderFormLocaleProvider><footer><button type="button" onClick={() => setOpen(false)}>{copy.cancel}</button><button type="submit" className="primary">{copy.save}</button></footer></form></div>}
  </div></div>;
}
