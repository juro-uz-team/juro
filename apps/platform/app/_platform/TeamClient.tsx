"use client";

import { Select } from "../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated team data is hydrated after the first browser render */

import { CircleAlert, LoaderCircle, MailPlus, ShieldCheck, Trash2, UserRound, UsersRound } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { platformApiError } from "../../content/platform-ui";
import { formatPlatformDate } from "../../lib/platform/date-time";
import type { PlatformLocale } from "../../lib/platform/routing";

type Member = { id: string; userId: string; role: string; status: string; joinedAt: string; fullName: string | null; email: string };
type Invitation = { id: string; email: string | null; role: string; expiresAt: string; createdAt: string };
type TeamData = {
  workspace: { id: string; name: string; type: string; locale: string } | null;
  currentRole: string;
  members: Member[];
  invitations: Invitation[];
};

const roles = ["admin", "lawyer", "employee", "viewer", "external"] as const;

const teamCopy = {
  ru: { loadError: "Не удалось загрузить команду.", inviteError: "Приглашение не отправлено.", invited: "Приглашение отправлено. Оно действует 7 дней.", roleError: "Роль не изменена.", removeConfirm: "Удалить участника из пространства?", removeError: "Участник не удалён.", revokeError: "Приглашение не отозвано.", section: "Команда", workspace: "Рабочее пространство", description: "Роли и доступ проверяются сервером. Скрытие кнопки не является механизмом защиты.", invite: "Пригласить участника", inviteDescription: "Письмо уйдёт через настроенный почтовый провайдер. Ложного success-состояния нет.", role: "Роль", send: "Отправить приглашение", members: "Участники", remove: "Удалить участника", pending: "Ожидают ответа", hiddenEmail: "Скрытый email", revoke: "Отозвать приглашение", noInvitations: "Активных приглашений нет." },
  uz: { loadError: "Jamoani yuklab bo‘lmadi.", inviteError: "Taklif yuborilmadi.", invited: "Taklif yuborildi. U 7 kun amal qiladi.", roleError: "Rol o‘zgartirilmadi.", removeConfirm: "Ishtirokchini makondan olib tashlaysizmi?", removeError: "Ishtirokchi olib tashlanmadi.", revokeError: "Taklif bekor qilinmadi.", section: "Jamoa", workspace: "Ish makoni", description: "Rollar va kirish serverda tekshiriladi. Tugmani yashirish himoya mexanizmi emas.", invite: "Ishtirokchini taklif qilish", inviteDescription: "Xat sozlangan pochta provayderi orqali yuboriladi. Soxta muvaffaqiyat holati yo‘q.", role: "Rol", send: "Taklif yuborish", members: "Ishtirokchilar", remove: "Ishtirokchini olib tashlash", pending: "Javob kutilmoqda", hiddenEmail: "Yashirin email", revoke: "Taklifni bekor qilish", noInvitations: "Faol takliflar yo‘q." },
  en: { loadError: "We could not load the team.", inviteError: "The invitation could not be sent.", invited: "Invitation sent. It remains valid for 7 days.", roleError: "The role could not be changed.", removeConfirm: "Remove this member from the workspace?", removeError: "The member could not be removed.", revokeError: "The invitation could not be revoked.", section: "Team", workspace: "Workspace", description: "Roles and access are enforced by the server. Hiding a button is not a security control.", invite: "Invite a member", inviteDescription: "The email is sent through the configured mail provider. Success is shown only after confirmed delivery acceptance.", role: "Role", send: "Send invitation", members: "Members", remove: "Remove member", pending: "Awaiting response", hiddenEmail: "Hidden email", revoke: "Revoke invitation", noInvitations: "No active invitations." },
} as const;

export function TeamClient({ locale }: { locale: PlatformLocale }) {
  const copy = teamCopy[locale];
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof roles)[number]>("employee");
  const canManage = data?.currentRole === "owner" || data?.currentRole === "admin";

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/platform/team", { cache: "no-store" });
      const body = await response.json() as TeamData & { error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.loadError));
      setData(body);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [copy.loadError, locale]);

  useEffect(() => { void load(); }, [load]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/platform/team", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ email, role, locale }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.inviteError));
      setEmail("");
      setNotice(copy.invited);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(memberId: string, nextRole: string) {
    setError("");
    const response = await fetch(`/api/platform/team/members/${encodeURIComponent(memberId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-juro-csrf": "1" },
      body: JSON.stringify({ role: nextRole }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) { setError(platformApiError(locale, body.error, copy.roleError)); return; }
    await load();
  }

  async function removeMember(memberId: string) {
    if (!window.confirm(copy.removeConfirm)) return;
    const response = await fetch(`/api/platform/team/members/${encodeURIComponent(memberId)}`, { method: "DELETE", headers: { "x-juro-csrf": "1" } });
    const body = await response.json() as { error?: string };
    if (!response.ok) { setError(platformApiError(locale, body.error, copy.removeError)); return; }
    await load();
  }

  async function revokeInvitation(invitationId: string) {
    const response = await fetch(`/api/platform/team/invitations/${encodeURIComponent(invitationId)}`, { method: "DELETE", headers: { "x-juro-csrf": "1" } });
    const body = await response.json() as { error?: string };
    if (!response.ok) { setError(platformApiError(locale, body.error, copy.revokeError)); return; }
    await load();
  }

  if (loading && !data) return <div className="team-loading"><LoaderCircle className="spin" /></div>;
  return (
    <section className="team-workspace">
      <header><UsersRound /><div><small>JURO · {copy.section}</small><h1>{data?.workspace?.name || copy.workspace}</h1><p>{copy.description}</p></div></header>
      {error && <p className="team-message error" role="alert"><CircleAlert />{error}</p>}
      {notice && <p className="team-message success" role="status"><ShieldCheck />{notice}</p>}
      {canManage && (
        <form className="team-invite" onSubmit={invite}>
          <div><MailPlus /><div><h2>{copy.invite}</h2><p>{copy.inviteDescription}</p></div></div>
          <label><span>Email</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@company.uz" /></label>
          <label><span>{copy.role}</span><Select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>{roles.map((item) => <option key={item} value={item}>{roleLabel(item, locale)}</option>)}</Select></label>
          <button disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <MailPlus />}{copy.send}</button>
        </form>
      )}
      <div className="team-grid">
        <article><div className="team-title"><h2>{copy.members}</h2><span>{data?.members.length ?? 0}</span></div><div className="team-list">{data?.members.map((member) => <div key={member.id}><span className="team-avatar"><UserRound /></span><div><strong>{member.fullName || member.email}</strong><small>{member.email}</small></div>{canManage && member.role !== "owner" ? <Select aria-label={`${copy.role}: ${member.fullName || member.email}`} value={member.role} onChange={(event) => void changeRole(member.id, event.target.value)}>{roles.map((item) => <option key={item} value={item}>{roleLabel(item, locale)}</option>)}</Select> : <span className="team-role">{roleLabel(member.role, locale)}</span>}{canManage && member.role !== "owner" && <button className="team-remove" onClick={() => void removeMember(member.id)} aria-label={copy.remove}><Trash2 /></button>}</div>)}</div></article>
        <article><div className="team-title"><h2>{copy.pending}</h2><span>{data?.invitations.length ?? 0}</span></div>{data?.invitations.length ? <div className="team-list">{data.invitations.map((invitation) => <div key={invitation.id}><span className="team-avatar"><MailPlus /></span><div><strong>{invitation.email || copy.hiddenEmail}</strong><small>{roleLabel(invitation.role, locale)} · {formatDate(invitation.expiresAt, locale)}</small></div>{canManage && <button className="team-remove" onClick={() => void revokeInvitation(invitation.id)} aria-label={copy.revoke}><Trash2 /></button>}</div>)}</div> : <p className="team-empty">{copy.noInvitations}</p>}</article>
      </div>
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
