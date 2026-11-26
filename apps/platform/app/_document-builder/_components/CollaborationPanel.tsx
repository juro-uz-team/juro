"use client";

import { Select } from "../../_components/Select";

import { Check, Copy, Download, Eye, FileCheck2, MessageSquareText, Pencil, Send, UserPlus, Users, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { CollaborationSnapshot } from "../../../lib/document-builder/types";
import type { DocumentPermission } from "../../../lib/document-builder/registry/types";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { builderError, builderIntlLocale } from "../builder-localization";
import { apiFetch, ApiClientError } from "./api-client";
import { BuilderToolDialog } from "./BuilderToolDialog";

const collaborationCopy = {
  ru: { actionError: "Не удалось выполнить действие.", title: "Совместная работа", ownerDescription: "Пригласите вторую или третью сторону, назначьте роль, обсудите и согласуйте изменения.", collaboratorDescription: "Вы можете комментировать и предлагать изменения в пределах назначенной роли.", identifier: "Email или номер телефона пользователя JURO", identifierPlaceholder: "name@example.uz или +998…", role: "Роль", participant: "Участник", secondParty: "Вторая сторона", thirdParty: "Третья сторона", invite: "Пригласить", linkNotice: "Защищённая ссылка действует 7 дней и привязана к указанному пользователю.", copy: "Копировать", member: "участник", party: "сторона", revoke: "Закрыть доступ", noCollaborators: "Вторая или третья сторона ещё не приглашена.", signed: "Подписанная версия", accessOpen: "Владелец открыл доступ", accessClosed: "Доступ закрыт владельцем", open: "Открыть", download: "Скачать", comments: "Комментарии", resolved: "Решено", openStatus: "Открыто", reopen: "Открыть снова", resolve: "Отметить решённым", noComments: "Комментариев пока нет.", commentPlaceholder: "Оставить комментарий…", sendComment: "Отправить комментарий", proposeTitle: "Предложить изменение", original: "Точный исходный фрагмент", revision: "Новая редакция", propose: "Предложить изменение", pending: "На согласовании", applied: "Применено", rejected: "Отклонено", creator: "Создатель", accepted: "подтвердил", awaiting: "ожидает", counterparty: "Вторая сторона", counterpartyAccepted: "подтвердила", accept: "Принять", reject: "Отклонить", confirmData: "Подтвердить данные документа" },
  uz: { actionError: "Amalni bajarib bo‘lmadi.", title: "Hamkorlikda ishlash", ownerDescription: "Ikkinchi yoki uchinchi tomonni taklif qiling, rol belgilang va o‘zgarishlarni muhokama qilib kelishing.", collaboratorDescription: "Sizga berilgan rol doirasida izoh qoldirish va o‘zgarish taklif qilish mumkin.", identifier: "JURO foydalanuvchisining emaili yoki telefon raqami", identifierPlaceholder: "name@example.uz yoki +998…", role: "Rol", participant: "Ishtirokchi", secondParty: "Ikkinchi tomon", thirdParty: "Uchinchi tomon", invite: "Taklif qilish", linkNotice: "Himoyalangan havola 7 kun amal qiladi va ko‘rsatilgan foydalanuvchiga bog‘langan.", copy: "Nusxalash", member: "ishtirokchi", party: "tomon", revoke: "Ruxsatni yopish", noCollaborators: "Ikkinchi yoki uchinchi tomon hali taklif qilinmagan.", signed: "Imzolangan nusxa", accessOpen: "Egasi ruxsat berdi", accessClosed: "Egasi ruxsatni yopdi", open: "Ochish", download: "Yuklab olish", comments: "Izohlar", resolved: "Hal qilindi", openStatus: "Ochiq", reopen: "Qayta ochish", resolve: "Hal qilingan deb belgilash", noComments: "Hozircha izohlar yo‘q.", commentPlaceholder: "Izoh qoldiring…", sendComment: "Izoh yuborish", proposeTitle: "O‘zgarish taklif qilish", original: "Aniq asl parcha", revision: "Yangi tahrir", propose: "O‘zgarishni taklif qilish", pending: "Kelishuvda", applied: "Qo‘llangan", rejected: "Rad etilgan", creator: "Yaratuvchi", accepted: "tasdiqladi", awaiting: "kutilmoqda", counterparty: "Ikkinchi tomon", counterpartyAccepted: "tasdiqladi", accept: "Qabul qilish", reject: "Rad etish", confirmData: "Hujjat ma’lumotlarini tasdiqlash" },
  en: { actionError: "We could not complete that action.", title: "Collaboration", ownerDescription: "Invite a second or third party, assign a role, discuss changes and approve the final wording.", collaboratorDescription: "You can comment and propose changes within your assigned role.", identifier: "JURO user's email or phone number", identifierPlaceholder: "name@example.uz or +998…", role: "Role", participant: "Participant", secondParty: "Second party", thirdParty: "Third party", invite: "Invite", linkNotice: "This protected link is valid for 7 days and is restricted to the specified user.", copy: "Copy", member: "member", party: "party", revoke: "Revoke access", noCollaborators: "No second or third party has been invited yet.", signed: "Signed version", accessOpen: "The owner granted access", accessClosed: "Access is restricted by the owner", open: "Open", download: "Download", comments: "Comments", resolved: "Resolved", openStatus: "Open", reopen: "Reopen", resolve: "Mark resolved", noComments: "No comments yet.", commentPlaceholder: "Leave a comment…", sendComment: "Send comment", proposeTitle: "Propose a change", original: "Exact original text", revision: "Suggested wording", propose: "Propose change", pending: "Awaiting approval", applied: "Applied", rejected: "Rejected", creator: "Creator", accepted: "accepted", awaiting: "awaiting response", counterparty: "Second party", counterpartyAccepted: "accepted", accept: "Accept", reject: "Reject", confirmData: "Confirm document details" },
} as const;

const roleLabels: Record<string, Record<PlatformLocale, string>> = {
  counterparty: { ru: "Сторона договора", uz: "Shartnoma tomoni", en: "Contracting party" },
  "co-party": { ru: "Со-сторона", uz: "Hamkor tomon", en: "Co-party" },
  representative: { ru: "Представитель", uz: "Vakil", en: "Representative" },
  editor: { ru: "Редактор", uz: "Tahrirchi", en: "Editor" },
  commenter: { ru: "Комментатор", uz: "Izohchi", en: "Commenter" },
  viewer: { ru: "Наблюдатель", uz: "Kuzatuvchi", en: "Viewer" },
  "legal-reviewer": { ru: "Юрист-проверяющий", uz: "Tekshiruvchi yurist", en: "Legal reviewer" },
  approver: { ru: "Согласующий", uz: "Tasdiqlovchi", en: "Approver" },
};

const collaboratorStatusLabels: Record<string, Record<PlatformLocale, string>> = {
  invited: { ru: "Приглашён", uz: "Taklif qilindi", en: "Invited" },
  pending: { ru: "Ожидает подтверждения", uz: "Tasdiqlash kutilmoqda", en: "Awaiting confirmation" },
  active: { ru: "Активен", uz: "Faol", en: "Active" },
  opened: { ru: "Открыл документ", uz: "Hujjatni ochdi", en: "Opened document" },
  confirmed: { ru: "Подтвердил данные", uz: "Ma’lumotlarni tasdiqladi", en: "Details confirmed" },
  approved: { ru: "Согласовано", uz: "Kelishildi", en: "Approved" },
  revoked: { ru: "Доступ отозван", uz: "Kirish bekor qilindi", en: "Access revoked" },
};

const panelCopy = {
  ru: { people: "Участники", changes: "Изменения", noChanges: "Предложений пока нет.", edit: "Редактировать текст", save: "Сохранить текст", latest: "Загрузить актуальный текст", stale: "Есть новая версия документа. Скопируйте свой текст перед загрузкой актуальной версии.", loading: "Загружаем обсуждение…", reload: "Загрузить версию с сервера", remote: "На сервере есть новая версия. При загрузке несохранённые правки будут заменены.", copied: "Скопировано" },
  uz: { people: "Ishtirokchilar", changes: "O‘zgarishlar", noChanges: "Hozircha takliflar yo‘q.", edit: "Matnni tahrirlash", save: "Matnni saqlash", latest: "So‘nggi matnni yuklash", stale: "Hujjatning yangi versiyasi bor. Uni yuklashdan oldin o‘z matningizni nusxalang.", loading: "Muhokama yuklanmoqda…", reload: "Serverdagi versiyani yuklash", remote: "Serverda yangi versiya bor. Yuklasangiz, saqlanmagan o‘zgarishlar almashtiriladi.", copied: "Nusxalandi" },
  en: { people: "People", changes: "Changes", noChanges: "No changes proposed yet.", edit: "Edit document text", save: "Save text", latest: "Load latest text", stale: "A newer version is available. Copy your edits before loading the latest text.", loading: "Loading discussion…", reload: "Load server version", remote: "A newer version is available. Loading it will replace unsaved edits.", copied: "Copied" },
} as const;

type CollaborationState = CollaborationSnapshot & {
  permissions: DocumentPermission[];
  viewerId: string;
  revision: number;
  canEditDraft: boolean;
};

type PanelProps = {
  documentId: string;
  accessRole: "owner" | "collaborator";
  finalText: string;
  revision: number;
  signedFileId?: string | null;
  locale?: PlatformLocale;
  beforeChange?: () => Promise<void>;
  onApplied: () => Promise<void>;
};

export function CollaborationPanel({ locale = "ru", ...props }: PanelProps) {
  return <BuilderToolDialog icon={Users} label={collaborationCopy[locale].title} locale={locale}>
    {() => <CollaborationContent {...props} locale={locale} />}
  </BuilderToolDialog>;
}

function CollaborationContent({
  documentId,
  accessRole,
  finalText,
  revision,
  signedFileId,
  locale = "ru",
  beforeChange,
  onApplied,
}: PanelProps) {
  const copy = collaborationCopy[locale];
  const labels = panelCopy[locale];
  const endpoint = `/api/document-builder/documents/${documentId}/collaboration`;
  const [snapshot, setSnapshot] = useState<CollaborationState | null>(null);
  const [view, setView] = useState<"people" | "comments" | "changes">(accessRole === "owner" || signedFileId ? "people" : "comments");
  const [edit, setEdit] = useState<{ text: string; revision: number }>();
  const [feedback, setFeedback] = useState("");
  const [loadError, setLoadError] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [inviteRole, setInviteRole] = useState("counterparty");
  const [partyNumber, setPartyNumber] = useState(2);
  const [inviteLink, setInviteLink] = useState("");
  const [comment, setComment] = useState("");
  const [oldText, setOldText] = useState("");
  const [newText, setNewText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    const load = async () => {
      try {
        if (!document.hidden) {
          const data = await apiFetch<CollaborationState>(endpoint, { cache: "no-store", signal: controller.signal });
          if (!controller.signal.aborted) { setSnapshot(data); setLoadError(""); }
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          if (caught instanceof ApiClientError && [401, 403, 404].includes(caught.status)) setSnapshot(null);
          setLoadError(builderError(locale, caught, copy.actionError));
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(load, 4_000);
    };
    void load();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [copy.actionError, endpoint, locale, refresh]);
  const allowed = (permission: DocumentPermission) => snapshot?.permissions.includes(permission) ?? false;
  const stale = (snapshot?.revision ?? revision) > revision;
  async function copyText(text: string) {
    setFeedback("");
    try { await navigator.clipboard.writeText(text); setFeedback(labels.copied); }
    catch { setError(copy.actionError); }
  }
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setError(""); setFeedback("");
    try {
      if (body.action === "proposal" || body.action === "accept_proposal") await beforeChange?.();
      const result = await apiFetch<{ applied?: boolean; invitation?: { path: string } }>(endpoint, { method: "POST", body: JSON.stringify(body) });
      if (result.applied) {
        try { await onApplied(); } catch (caught) { setError(builderError(locale, caught, copy.actionError)); }
      }
      if (result.invitation?.path) setInviteLink(`${window.location.origin}${result.invitation.path}`);
      return true;
    } catch (caught) {
      setError(builderError(locale, caught, copy.actionError));
      return false;
    } finally {
      setRefresh((previous) => previous + 1);
      setBusy(false);
    }
  };
  const currentCollaborator = snapshot?.collaborators.find((person) => person.userId === snapshot.viewerId);
  const role = (value: string | null | undefined) => roleLabels[value ?? ""]?.[locale] ?? copy.member;
  const collaboratorStatus = (value: string | null | undefined) => collaboratorStatusLabels[value ?? ""]?.[locale] ?? copy.pending;
  const status = collaborateStatus();
  function collaborateStatus() {
    if (loadError) return <p className="dbt-form-error" role="alert">{loadError}</p>;
    if (!snapshot) return <p className="dbt-empty-inline" role="status">{labels.loading}</p>;
    return null;
  }

  return <section className="dbt-collaboration">
    <div className="dbt-collaboration-nav" role="group" aria-label={copy.title}>
      {([{ id: "people", label: labels.people, icon: Users }, { id: "comments", label: copy.comments, icon: MessageSquareText }, { id: "changes", label: labels.changes, icon: Pencil }] as const).map(({ id, label, icon: Icon }) =>
        <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}><Icon size={16} aria-hidden="true" />{label}</button>)}
    </div>
    {status}
    {error && <p className="dbt-form-error" role="alert">{error}</p>}
    {feedback && <p role="status" className="dbt-empty-inline">{feedback}</p>}
    {stale && accessRole === "owner" && <div className="dbt-collab-notice"><p>{labels.remote}</p>
      <button type="button" className="dbt-tool-button" disabled={busy} onClick={() => void onApplied().catch(caught => setError(builderError(locale, caught, copy.actionError)))}>{labels.reload}</button>
    </div>}
    {snapshot && view === "people" && <div className="dbt-collab-content">
      {allowed("invite_participant") && <form className="dbt-invite" onSubmit={(event) => {
        event.preventDefault();
        void act({ action: "invite", identifier, role: inviteRole, partyNumber }).then(ok => { if (ok) setIdentifier(""); });
      }}>
        <label className="dbt-field dbt-field-wide"><span>{copy.identifier}</span><input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={copy.identifierPlaceholder}/></label>
        <label className="dbt-field"><span>{copy.role}</span><Select aria-label={copy.role} value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>{Object.entries(roleLabels).map(([value, values]) => <option value={value} key={value}>{values[locale]}</option>)}</Select></label>
        <label className="dbt-field"><span>{copy.participant}</span><Select aria-label={copy.participant} value={partyNumber} onChange={(event) => setPartyNumber(Number(event.target.value))}><option value={2}>{copy.secondParty}</option><option value={3}>{copy.thirdParty}</option></Select></label>
        <button type="submit" className="dbt-tool-button primary" disabled={busy || !identifier.trim()}><UserPlus size={17}/>{copy.invite}</button>
      </form>}
      {inviteLink && <div className="dbt-invite-link"><span>{copy.linkNotice}</span>
        <input aria-label={copy.linkNotice} readOnly value={inviteLink}/>
        <button type="button" onClick={() => void copyText(inviteLink)}><Copy size={16}/>{copy.copy}</button>
      </div>}
      {snapshot.collaborators.length ? <div className="dbt-collaborators">
        {snapshot.collaborators.map((person) => <article key={person.id}>
          <span aria-hidden="true">{person.displayName.slice(0, 1).toLocaleUpperCase()}</span>
          <div><strong>{person.displayName}</strong><small>{[accessRole === "owner" ? person.email : "", role(person.role), person.partyNumber ? `${copy.party} ${person.partyNumber}` : "", collaboratorStatus(person.approvalStatus ?? person.status)].filter(Boolean).join(" · ")}</small></div>
          {allowed("revoke_participant") && <button type="button" disabled={busy} onClick={() => void act({ action: "revoke_collaborator", collaboratorUserId: person.userId })}>{copy.revoke}</button>}
        </article>)}
      </div> : <p className="dbt-empty-inline">{copy.noCollaborators}</p>}
      {accessRole === "collaborator" && signedFileId && <div className="dbt-collaborator-signed"><FileCheck2 size={22}/><div><strong>{copy.signed}</strong><small>{currentCollaborator?.signedViewAllowed ? copy.accessOpen : copy.accessClosed}</small></div>
        {currentCollaborator?.signedViewAllowed && <a href={`/api/document-builder/documents/${documentId}/files/${signedFileId}?inline=1`} target="_blank" rel="noreferrer"><Eye size={17}/>{copy.open}</a>}
        {currentCollaborator?.signedDownloadAllowed && <a href={`/api/document-builder/documents/${documentId}/files/${signedFileId}`}><Download size={17}/>{copy.download}</a>}
      </div>}
      {accessRole === "collaborator" && allowed("approve_document") && <button type="button" className="dbt-tool-button" disabled={busy} onClick={() => void act({ action: "confirm_data" })}><Check size={17}/>{copy.confirmData}</button>}
    </div>}
    {snapshot && view === "comments" && <div className="dbt-collab-content">
      {allowed("add_comment") && <form className="dbt-comment-input" onSubmit={(event) => {
        event.preventDefault();
        void act({ action: "comment", body: comment }).then(ok => { if (ok) setComment(""); });
      }}>
        <textarea aria-label={copy.commentPlaceholder} rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={copy.commentPlaceholder}/>
        <button type="submit" className="dbt-tool-button primary" aria-label={copy.sendComment} disabled={busy || !comment.trim()}><Send size={17}/></button>
      </form>}
      <div className="dbt-comments">
        {snapshot.comments.map(item => <article key={item.id}>
          <strong>{item.authorName}</strong>
          {item.threadStatus && <span className={`dbt-comment-status ${item.threadStatus}`}>{item.threadStatus === "resolved" ? copy.resolved : copy.openStatus}</span>}
          <p>{item.body}</p>
          <small>{new Date(item.createdAt).toLocaleString(builderIntlLocale(locale))}</small>
          {allowed("resolve_comment") && item.threadId && <button type="button" disabled={busy} onClick={() => void act({ action: item.threadStatus === "resolved" ? "reopen_comment" : "resolve_comment", threadId: item.threadId })}>{item.threadStatus === "resolved" ? copy.reopen : copy.resolve}</button>}
        </article>)}
        {!snapshot.comments.length && <p className="dbt-empty-inline">{copy.noComments}</p>}
      </div>
    </div>}
    {snapshot && view === "changes" && <div className="dbt-collab-content">
      {snapshot.canEditDraft && (edit ? <form className="dbt-collab-editor" onSubmit={(event) => {
        event.preventDefault();
        void act({ action: "edit_draft", ...edit }).then(ok => { if (ok) setEdit(undefined); });
      }}>
        <label className="dbt-field"><span>{labels.edit}</span><textarea rows={9} value={edit.text} onChange={(event) => setEdit({ ...edit, text: event.target.value })}/></label>
        {edit.revision !== revision ? <div className="dbt-collab-notice"><p>{labels.stale}</p>
          <button type="button" className="dbt-tool-button" onClick={() => void copyText(edit.text)}><Copy size={16}/>{copy.copy}</button>
          <button type="button" className="dbt-tool-button" disabled={stale} onClick={() => setEdit({ text: finalText, revision })}>{labels.latest}</button>
        </div> : <button type="submit" className="dbt-tool-button primary" disabled={busy || stale || !edit.text.trim() || edit.text === finalText}>{labels.save}</button>}
      </form> : <button type="button" className="dbt-tool-button" disabled={stale} onClick={() => setEdit({ text: finalText, revision })}><Pencil size={16}/>{labels.edit}</button>)}
      {allowed("create_suggestion") && <details className="dbt-collab-suggestion">
        <summary className="juro-disclosure-summary">{copy.proposeTitle}</summary>
        <form onSubmit={(event) => {
          event.preventDefault();
          void act({ action: "proposal", oldText, newText }).then(ok => { if (ok) { setOldText(""); setNewText(""); } });
        }}>
          <label className="dbt-field"><span>{copy.original}</span><textarea rows={2} value={oldText} onChange={(event) => setOldText(event.target.value)}/></label>
          <label className="dbt-field"><span>{copy.revision}</span><textarea rows={3} value={newText} onChange={(event) => setNewText(event.target.value)}/></label>
          <button type="submit" className="dbt-tool-button primary" disabled={busy || !oldText.trim() || !newText.trim()}>{copy.propose}</button>
        </form>
      </details>}
      <div className="dbt-proposals">
        {snapshot.proposals.map(proposal => <article key={proposal.id}><div>
          <span className={`dbt-proposal-status ${proposal.status}`}>{proposal.status === "pending" ? copy.pending : proposal.status === "applied" ? copy.applied : copy.rejected}</span>
          <p><del>{proposal.oldText}</del></p><p><ins>{proposal.newText}</ins></p>
          <small>{copy.creator} · {proposal.ownerAccepted ? copy.accepted : copy.awaiting} / {copy.counterparty} · {proposal.collaboratorAccepted ? copy.counterpartyAccepted : copy.awaiting}</small>
        </div>{proposal.status === "pending" && <div>
          {allowed("accept_suggestion") && <button type="button" disabled={busy} onClick={() => void act({ action: "accept_proposal", proposalId: proposal.id })}><Check size={16}/>{copy.accept}</button>}
          {allowed("reject_suggestion") && <button type="button" disabled={busy} onClick={() => void act({ action: "reject_proposal", proposalId: proposal.id })}><X size={16}/>{copy.reject}</button>}
        </div>}</article>)}
        {!snapshot.proposals.length && <p className="dbt-empty-inline">{labels.noChanges}</p>}
      </div>
    </div>}
  </section>;
}
