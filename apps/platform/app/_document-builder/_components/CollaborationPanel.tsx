"use client";

import { Select } from "../../_components/Select";

import { Check, Copy, Download, Eye, FileCheck2, MessageSquareText, Send, UserPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { CollaborationSnapshot } from "../../../lib/document-builder/types";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { builderError, builderIntlLocale } from "../builder-localization";
import { apiFetch } from "./api-client";

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

export function CollaborationPanel({
  documentId,
  accessRole,
  finalText,
  currentUserEmail,
  signedFileId,
  locale = "ru",
  onApplied,
}: {
  documentId: string;
  accessRole: "owner" | "collaborator";
  finalText: string;
  currentUserEmail?: string;
  signedFileId?: string | null;
  locale?: PlatformLocale;
  onApplied: () => void;
}) {
  const copy = collaborationCopy[locale];
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [inviteRole, setInviteRole] = useState("counterparty");
  const [partyNumber, setPartyNumber] = useState(2);
  const [inviteLink, setInviteLink] = useState("");
  const [comment, setComment] = useState("");
  const [oldText, setOldText] = useState("");
  const [newText, setNewText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiFetch<CollaborationSnapshot>(`/api/document-builder/documents/${documentId}/collaboration`).then(setSnapshot).catch((caught: Error) => setError(builderError(locale, caught, copy.actionError))), [copy.actionError, documentId, locale]);
  useEffect(() => { void load(); }, [load]);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const result = await apiFetch<{ snapshot?: CollaborationSnapshot; applied?: boolean; invitation?: { path: string } }>(`/api/document-builder/documents/${documentId}/collaboration`, { method: "POST", body: JSON.stringify(body) });
      if (result.snapshot) setSnapshot(result.snapshot);
      if (result.applied) onApplied();
      if (result.invitation?.path) setInviteLink(`${window.location.origin}${result.invitation.path}`);
    } catch (caught) {
      setError(builderError(locale, caught, copy.actionError));
    } finally {
      setBusy(false);
    }
  };
  const currentCollaborator = snapshot?.collaborators.find((person) => person.email.toLocaleLowerCase() === currentUserEmail?.toLocaleLowerCase());
  const role = (value: string | null | undefined) => roleLabels[value ?? ""]?.[locale] ?? copy.member;
  const collaboratorStatus = (value: string | null | undefined) => collaboratorStatusLabels[value ?? ""]?.[locale] ?? copy.pending;
  return <section className="dbt-collaboration">
    <header><Users size={22}/><div><h2>{copy.title}</h2><p>{accessRole === "owner" ? copy.ownerDescription : copy.collaboratorDescription}</p></div></header>
    {error && <p className="dbt-form-error" role="alert">{error}</p>}
    {accessRole === "owner" && <div className="dbt-invite"><label><span>{copy.identifier}</span><input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={copy.identifierPlaceholder}/></label><label><span>{copy.role}</span><Select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>{Object.entries(roleLabels).map(([value, labels]) => <option value={value} key={value}>{labels[locale]}</option>)}</Select></label><label><span>{copy.participant}</span><Select value={partyNumber} onChange={(event) => setPartyNumber(Number(event.target.value))}><option value={2}>{copy.secondParty}</option><option value={3}>{copy.thirdParty}</option></Select></label><button type="button" disabled={busy || !identifier.trim()} onClick={() => void act({ action: "invite", identifier, role: inviteRole, partyNumber }).then(() => setIdentifier(""))}><UserPlus size={17}/>{copy.invite}</button></div>}
    {accessRole === "owner" && inviteLink && <div className="dbt-invite-link"><span>{copy.linkNotice}</span><input readOnly value={inviteLink}/><button type="button" onClick={() => void navigator.clipboard.writeText(inviteLink)}><Copy size={16}/>{copy.copy}</button></div>}
    {snapshot?.collaborators.length ? <div className="dbt-collaborators">{snapshot.collaborators.map((person) => <article key={person.id}><span>{person.displayName.slice(0, 1).toLocaleUpperCase()}</span><div><strong>{person.displayName}</strong><small>{person.email} · {role(person.role)}{person.partyNumber ? ` · ${copy.party} ${person.partyNumber}` : ""} · {collaboratorStatus(person.approvalStatus ?? person.status)}</small></div>{accessRole === "owner" && <button type="button" onClick={() => void act({ action: "revoke_collaborator", collaboratorUserId: person.userId })}>{copy.revoke}</button>}</article>)}</div> : <p className="dbt-empty-inline">{copy.noCollaborators}</p>}
    {accessRole === "collaborator" && signedFileId && <div className="dbt-collaborator-signed"><FileCheck2 size={22}/><div><strong>{copy.signed}</strong><small>{currentCollaborator?.signedViewAllowed ? copy.accessOpen : copy.accessClosed}</small></div>{currentCollaborator?.signedViewAllowed && <a href={`/api/document-builder/documents/${documentId}/files/${signedFileId}?inline=1`} target="_blank" rel="noreferrer"><Eye size={17}/>{copy.open}</a>}{currentCollaborator?.signedDownloadAllowed && <a href={`/api/document-builder/documents/${documentId}/files/${signedFileId}`}><Download size={17}/>{copy.download}</a>}</div>}
    <div className="dbt-collab-grid"><div><h3><MessageSquareText size={17}/>{copy.comments}</h3><div className="dbt-comments">{snapshot?.comments.map((item) => <article key={item.id}><strong>{item.authorName}</strong>{item.threadStatus && <span className={`dbt-comment-status ${item.threadStatus}`}>{item.threadStatus === "resolved" ? copy.resolved : copy.openStatus}</span>}<p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString(builderIntlLocale(locale))}</small>{accessRole === "owner" && item.threadId && <button type="button" onClick={() => void act({ action: item.threadStatus === "resolved" ? "reopen_comment" : "resolve_comment", threadId: item.threadId })}>{item.threadStatus === "resolved" ? copy.reopen : copy.resolve}</button>}</article>)}{!snapshot?.comments.length && <p>{copy.noComments}</p>}</div><div className="dbt-comment-input"><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={copy.commentPlaceholder}/><button type="button" aria-label={copy.sendComment} disabled={busy || !comment.trim()} onClick={() => void act({ action: "comment", body: comment }).then(() => setComment(""))}><Send size={17}/></button></div></div><div><h3>{copy.proposeTitle}</h3><label><span>{copy.original}</span><textarea value={oldText} onChange={(event) => setOldText(event.target.value)} placeholder={finalText.slice(0, 100)}/></label><label><span>{copy.revision}</span><textarea value={newText} onChange={(event) => setNewText(event.target.value)}/></label><button type="button" className="dbt-propose" disabled={busy || !oldText.trim() || !newText.trim()} onClick={() => void act({ action: "proposal", oldText, newText }).then(() => { setOldText(""); setNewText(""); })}>{copy.propose}</button></div></div>
    <div className="dbt-proposals">{snapshot?.proposals.map((proposal) => <article key={proposal.id}><div><span className={`dbt-proposal-status ${proposal.status}`}>{proposal.status === "pending" ? copy.pending : proposal.status === "applied" ? copy.applied : copy.rejected}</span><p><del>{proposal.oldText}</del></p><p><ins>{proposal.newText}</ins></p><small>{copy.creator}: {proposal.ownerAccepted ? copy.accepted : copy.awaiting} · {copy.counterparty}: {proposal.collaboratorAccepted ? copy.counterpartyAccepted : copy.awaiting}</small></div>{proposal.status === "pending" && <div><button type="button" onClick={() => void act({ action: "accept_proposal", proposalId: proposal.id })}><Check size={16}/>{copy.accept}</button><button type="button" onClick={() => void act({ action: "reject_proposal", proposalId: proposal.id })}><X size={16}/>{copy.reject}</button></div>}</article>)}</div>
    {accessRole === "collaborator" && <button type="button" className="dbt-confirm-data" disabled={busy} onClick={() => void act({ action: "confirm_data" })}><Check size={17}/>{copy.confirmData}</button>}
  </section>;
}
