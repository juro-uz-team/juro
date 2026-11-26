"use client";

import { WorkspacePagination, useWorkspacePagination } from "./WorkspacePagination";
import { usePlatformWorkspaceId } from "./PlatformRouteContext";
import { WorkspaceTitle } from "./WorkspaceTitle";

import { Select } from "../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated team data is hydrated after the first browser render */

import { CircleAlert, LoaderCircle, MailPlus, ShieldCheck, Trash2, UserRound, UsersRound } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { platformApiError } from "../../content/platform-ui";
import { subscriptionFeedback } from "../../content/subscription-feedback";
import { formatPlatformDate } from "../../lib/platform/date-time";
import type { PlatformLocale } from "../../lib/platform/routing";

type Member = { id: string; userId: string; role: string; status: string; joinedAt: string; fullName: string | null; email: string };
type Invitation = { id: string; email: string | null; role: string; expiresAt: string; createdAt: string };
type TeamData = {
  workspace: { id: string; name: string; type: string; locale: string } | null;
  currentRole: string;
  currentUserId: string;
  readOnly: boolean;
  members: Member[];
  invitations: Invitation[];
  unassignedCases: { id: string; title: string }[];
};

const roles = ["admin", "lawyer", "employee", "viewer", "external"] as const;

const teamCopy = {
  ru: { loadError: "Не удалось загрузить команду.", inviteError: "Приглашение не отправлено.", invited: "Приглашение отправлено. Оно действует 7 дней.", roleError: "Роль не изменена.", removeConfirm: "Удалить участника из пространства?", removeError: "Участник не удалён.", revokeError: "Приглашение не отозвано.", section: "Команда", workspace: "Рабочее пространство", description: "Роли и доступ проверяются сервером. Скрытие кнопки не является механизмом защиты.", invite: "Пригласить участника", inviteDescription: "Письмо уйдёт через настроенный почтовый провайдер. Ложного success-состояния нет.", role: "Роль", send: "Отправить приглашение", members: "Участники", remove: "Удалить участника", pending: "Ожидают ответа", hiddenEmail: "Скрытый email", revoke: "Отозвать приглашение", noInvitations: "Активных приглашений нет." },
  uz: { loadError: "Jamoani yuklab bo‘lmadi.", inviteError: "Taklif yuborilmadi.", invited: "Taklif yuborildi. U 7 kun amal qiladi.", roleError: "Rol o‘zgartirilmadi.", removeConfirm: "Ishtirokchini makondan olib tashlaysizmi?", removeError: "Ishtirokchi olib tashlanmadi.", revokeError: "Taklif bekor qilinmadi.", section: "Jamoa", workspace: "Ish makoni", description: "Rollar va kirish serverda tekshiriladi. Tugmani yashirish himoya mexanizmi emas.", invite: "Ishtirokchini taklif qilish", inviteDescription: "Xat sozlangan pochta provayderi orqali yuboriladi. Soxta muvaffaqiyat holati yo‘q.", role: "Rol", send: "Taklif yuborish", members: "Ishtirokchilar", remove: "Ishtirokchini olib tashlash", pending: "Javob kutilmoqda", hiddenEmail: "Yashirin email", revoke: "Taklifni bekor qilish", noInvitations: "Faol takliflar yo‘q." },
  en: { loadError: "We could not load the team.", inviteError: "The invitation could not be sent.", invited: "Invitation sent. It remains valid for 7 days.", roleError: "The role could not be changed.", removeConfirm: "Remove this member from the workspace?", removeError: "The member could not be removed.", revokeError: "The invitation could not be revoked.", section: "Team", workspace: "Workspace", description: "Roles and access are enforced by the server. Hiding a button is not a security control.", invite: "Invite a member", inviteDescription: "The email is sent through the configured mail provider. Success is shown only after confirmed delivery acceptance.", role: "Role", send: "Send invitation", members: "Members", remove: "Remove member", pending: "Awaiting response", hiddenEmail: "Hidden email", revoke: "Revoke invitation", noInvitations: "No active invitations." },
} as const;

export function TeamClient({ locale }: { locale: PlatformLocale }) {
  const copy = teamCopy[locale];
  const workspaceId = usePlatformWorkspaceId();
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof roles)[number]>("employee");
  const [query, setQuery] = useState("");
  const [reassignment, setReassignment] = useState({ caseId: "", memberId: "" });
  const canManage = data?.currentRole === "owner" || data?.currentRole === "admin";

  const canInvite = canManage && !data?.readOnly;
  const rolesForManager = roles.filter(item => data?.currentRole === "owner" || item !== "admin");
  const canRemove = (member: Member) => canManage && member.role !== "owner" && member.userId !== data?.currentUserId
    && (member.role !== "admin" || data?.currentRole === "owner");
  const t = (ru: string, uz: string, en: string) => ({ ru, uz, en })[locale];

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/platform/team", { cache: "no-store", headers: { "x-juro-workspace-id": workspaceId } });
      const body = await response.json() as TeamData & { error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.loadError));
      setData(body);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [copy.loadError, locale, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    await sendInvitation(email, role);
  }

  async function sendInvitation(email: string, role: string) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/platform/team", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-workspace-id": workspaceId },
        body: JSON.stringify({ email, role, locale }),
      });
      const body = await response.json() as { error?: string; code?: string };
      if (!response.ok) throw new Error(subscriptionFeedback(locale, body.code) ?? platformApiError(locale, body.error, copy.inviteError));
      setEmail("");
      setNotice(copy.invited);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  }

  async function updateMembership(path: string, method: "PATCH" | "DELETE", fallback: string, role?: string) {
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(`/api/platform/team/${path}`, {
        method,
        headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-workspace-id": workspaceId },
        body: role ? JSON.stringify({ role }) : undefined,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
        setError(subscriptionFeedback(locale, body.code) ?? platformApiError(locale, body.error, fallback));
        return;
      }
      await load();
    } catch {
      setError(fallback);
    } finally {
      setSaving(false);
    }
  }

  function changeRole(memberId: string, nextRole: string) {
    return updateMembership(`members/${encodeURIComponent(memberId)}`, "PATCH", copy.roleError, nextRole);
  }

  function removeMember(member: Member) {
    if (!window.confirm([copy.removeConfirm, member.fullName || member.email, data?.workspace?.name].filter(Boolean).join("\n"))) return;
    void updateMembership(`members/${encodeURIComponent(member.id)}`, "DELETE", copy.removeError);
  }

  function revokeInvitation(invitationId: string) {
    return updateMembership(`invitations/${encodeURIComponent(invitationId)}`, "DELETE", copy.revokeError);
  }

  async function assignResponsibility(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/platform/team", {
        method: "PATCH", headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-workspace-id": workspaceId },
        body: JSON.stringify(reassignment),
      });
      if (!response.ok) throw new Error();
      setReassignment({ caseId: "", memberId: "" });
      setNotice(t("Ответственный обновлён.", "Mas’ul yangilandi.", "Responsibility reassigned."));
      await load();
    } catch {
      setError(t("Не удалось назначить ответственного.", "Mas’ulni tayinlab bo‘lmadi.", "We could not reassign the matter."));
    } finally { setSaving(false); }
  }

  const filter = query.trim().toLocaleLowerCase();
  const members = (data?.members ?? []).filter(member => [member.fullName, member.email, roleLabel(member.role, locale)]
    .some(value => value?.toLocaleLowerCase().includes(filter)));
  const invitations = (data?.invitations ?? []).filter(invitation => [invitation.email, roleLabel(invitation.role, locale)]
    .some(value => value?.toLocaleLowerCase().includes(filter)));
  const memberPages = useWorkspacePagination(members.length, 8, filter);
  const invitationPages = useWorkspacePagination(invitations.length, 8, filter);
  if (loading && !data) return <div className="team-loading"><LoaderCircle className="spin" /></div>;
  return (
    <section className="team-workspace workspace-page">
      <WorkspaceTitle icon={<UsersRound />} title={data?.workspace?.name || copy.workspace} description={data?.workspace?.type === "business" ? t("Без ограничения числа участников", "A’zolar soni cheklanmagan", "Unlimited members") : undefined} />
      {error && <p className="team-message error" role="alert"><CircleAlert />{error}</p>}
      {notice && <p className="team-message success" role="status"><ShieldCheck />{notice}</p>}
      {data?.readOnly && <p className="team-message">{t("Срок тарифа истёк. Можно отозвать доступ и приглашения.", "Tarif tugadi. Ruxsat va takliflarni bekor qilish mumkin.", "The term ended. You can still revoke access and invitations.")}</p>}
      {canInvite && (
        <form className="team-invite" onSubmit={invite}>
          <div><MailPlus /><div><h2>{copy.invite}</h2><p>{t("Участник примет приглашение по электронной почте.", "A’zo taklifni elektron pochta orqali qabul qiladi.", "The recipient accepts by email.")}</p></div></div>
          <label><span>Email</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@company.uz" /></label>
          <label><span>{copy.role}</span><Select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>{rolesForManager.map((item) => <option key={item} value={item}>{roleLabel(item, locale)}</option>)}</Select></label>
          <button disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <MailPlus />}{copy.send}</button>
        </form>
      )}
      <label className="team-search"><span>{t("Поиск по команде", "Jamoada qidirish", "Search team")}</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <div className="team-grid">
        <article><div className="team-title"><h2>{copy.members}</h2><span>{data?.members.length ?? 0}</span></div><div className="team-list">{!members.length && <p className="team-empty">{t("Участники не найдены.", "A’zolar topilmadi.", "No matching members.")}</p>}{members.slice(memberPages.from, memberPages.to).map((member) => <div key={member.id}><span className="team-avatar"><UserRound /></span><div><strong>{member.fullName || member.email}</strong><small>{member.email}</small></div>{canRemove(member) && !data?.readOnly ? <Select aria-label={`${copy.role}: ${member.fullName || member.email}`} disabled={saving} value={member.role} onChange={(event) => void changeRole(member.id, event.target.value)}>{rolesForManager.map((item) => <option key={item} value={item}>{roleLabel(item, locale)}</option>)}</Select> : <span className="team-role">{roleLabel(member.role, locale)}</span>}{canRemove(member) && <button className="team-remove" disabled={saving} onClick={() => removeMember(member)} aria-label={copy.remove}><Trash2 /></button>}</div>)}</div><WorkspacePagination locale={locale} {...memberPages} /></article>
        <article><div className="team-title"><h2>{copy.pending}</h2><span>{invitations.length ?? 0}</span></div>{invitations.length ? <div className="team-list">{invitations.slice(invitationPages.from, invitationPages.to).map((invitation) => <div key={invitation.id}><span className="team-avatar"><MailPlus /></span><div><strong>{invitation.email || copy.hiddenEmail}</strong><small>{roleLabel(invitation.role, locale)} · {formatDate(invitation.expiresAt, locale)}</small></div>{canInvite && invitation.email && (data?.currentRole === "owner" || invitation.role !== "admin") &&
          <button type="button" className="team-remove" disabled={saving} onClick={() => void sendInvitation(invitation.email!, invitation.role)}
            aria-label={t("Отправить ещё раз", "Qayta yuborish", "Resend invitation")}><MailPlus /></button>}
          {canManage && <button className="team-remove" disabled={saving} onClick={() => void revokeInvitation(invitation.id)} aria-label={copy.revoke}><Trash2 /></button>}</div>)}</div> : <p className="team-empty">{copy.noInvitations}</p>}<WorkspacePagination locale={locale} {...invitationPages} /></article>
      </div>
      {canInvite && !!data?.unassignedCases.length && <form className="team-invite" onSubmit={assignResponsibility}>
        <div><UsersRound /><h2>{t("Дела без ответственного", "Mas’ulsiz ishlar", "Matters that need an owner")}</h2></div>
        <label>{t("Дело", "Ish", "Matter")}<Select required value={reassignment.caseId}
          onChange={event => setReassignment({ ...reassignment, caseId: event.target.value })}>
          <option value="">{t("Выберите дело", "Ishni tanlang", "Choose a matter")}</option>
          {data.unassignedCases.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </Select></label>
        <label>{t("Ответственный", "Mas’ul", "Responsible team member")}<Select required value={reassignment.memberId}
          onChange={event => setReassignment({ ...reassignment, memberId: event.target.value })}>
          <option value="">{t("Выберите участника", "A’zoni tanlang", "Choose a team member")}</option>
          {data.members.filter(member => ["owner","admin","employee","lawyer"].includes(member.role)).map(member =>
            <option key={member.id} value={member.id}>{member.fullName || member.email}</option>)}
        </Select></label>
        <button type="submit" disabled={saving || !reassignment.caseId || !reassignment.memberId}>
          {t("Назначить", "Tayinlash", "Assign responsibility")}
        </button>
      </form>}
    </section>
  );
}

function roleLabel(role: string, locale: PlatformLocale) {
  const labels: Record<string, Record<PlatformLocale, string>> = {
    owner: { ru: "Владелец", uz: "Egasi", en: "Owner" }, admin: { ru: "Администратор", uz: "Administrator", en: "Administrator" }, lawyer: { ru: "Юрист", uz: "Yurist", en: "Lawyer" },
    employee: { ru: "Сотрудник", uz: "Xodim", en: "Employee" }, viewer: { ru: "Наблюдатель", uz: "Kuzatuvchi", en: "Viewer" }, external: { ru: "Внешний участник", uz: "Tashqi ishtirokchi", en: "External member" },
  };
  return labels[role]?.[locale] ?? role;
}

function formatDate(value: string, locale: PlatformLocale) {
  return formatPlatformDate(value, locale);
}
