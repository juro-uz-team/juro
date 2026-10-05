"use client";

import { Select } from "../_components/Select";

import { Check, Crown, LoaderCircle, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { lawyerText } from "../../lib/platform/lawyer-localization";
import type { PlatformLocale } from "../../lib/platform/routing";

type Profile = {
  id: string;
  displayName: string;
  juroApprovalStatus: "approved" | "not_approved";
  topLawyerStatus: "featured" | "not_featured";
  topLawyerCriteria: string | null;
};

async function body<T>(response: Response, fallback: string): Promise<T> {
  const value = await response.json() as T;
  if (!response.ok) throw new Error(fallback);
  return value;
}

/** Controls are embedded in the existing lawyer moderation page, rather than a
 * parallel catalogue, so a designation can be issued only after publication. */
export function LawyerTrustDesignationPanel({ locale }: { locale: PlatformLocale }) {
  const text = useCallback(
    (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english),
    [locale],
  );
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [designation, setDesignation] = useState<"juro_approval" | "top_lawyer">("juro_approval");
  const [decision, setDecision] = useState<"approved" | "revoked">("approved");
  const [reason, setReason] = useState("");
  const [criteria, setCriteria] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const value = await body<{ profiles: Profile[] }>(
        await fetch("/api/platform/admin/lawyer-profiles?status=public_approved&limit=100", { cache: "no-store" }),
        text("Не удалось загрузить опубликованные профили.", "Nashr qilingan profillarni yuklab bo‘lmadi.", "We could not load the published profiles."),
      );
      setProfiles(value.profiles);
      setProfileId((current) => current || value.profiles[0]?.id || "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : text("Не удалось выполнить запрос.", "So‘rov bajarilmadi.", "We could not complete the request.")); }
  }, [text]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const selected = profiles.find((profile) => profile.id === profileId);
  function preset(profile: Profile | undefined, nextDesignation: "juro_approval" | "top_lawyer") {
    if (!profile) return;
    setDesignation(nextDesignation);
    setDecision(nextDesignation === "juro_approval"
      ? profile.juroApprovalStatus === "approved" ? "revoked" : "approved"
      : profile.topLawyerStatus === "featured" ? "revoked" : "approved");
    setCriteria(nextDesignation === "top_lawyer" ? profile.topLawyerCriteria ?? "" : "");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileId || !reason.trim() || busy) return;
    if (designation === "top_lawyer" && decision === "approved" && criteria.trim().length < 20) {
      setError(text("Укажите публичные критерии Top Lawyer (минимум 20 символов).", "Top yuristning ochiq mezonlarini kiriting (kamida 20 belgi).", "Enter the public Top Lawyer criteria (at least 20 characters)."));
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      await body(await fetch(`/api/platform/admin/lawyer-profiles/${encodeURIComponent(profileId)}/designation`, {
        method: "POST", headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ designation, decision, reason: reason.trim(), ...(designation === "top_lawyer" && decision === "approved" ? { criteria: criteria.trim() } : {}) }),
      }), text("Не удалось сохранить статус.", "Maqomni saqlab bo‘lmadi.", "We could not save the designation."));
      setNotice(text("Статус сохранён в неизменяемом журнале.", "Maqom o‘zgarmas jurnalga saqlandi.", "The designation was saved to the immutable audit record."));
      setReason("");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : text("Не удалось выполнить запрос.", "So‘rov bajarilmadi.", "We could not complete the request.")); }
    finally { setBusy(false); }
  }

  return <section className="staff-decision lawyer-trust-designation" aria-labelledby="lawyer-trust-designation-title">
    <header><div><small>JURO · TRUST DESIGNATIONS</small><h2 id="lawyer-trust-designation-title">{text("Статусы доверия", "Ishonch maqomlari", "Trust designations")}</h2><p>{text("Публикация, «Одобрен JURO» и Top Lawyer — отдельные решения. Top Lawyer получает публичные критерии.", "Nashr, «JURO tomonidan ma’qullangan» va Top yurist alohida qarorlardir. Top yurist uchun ochiq mezonlar ko‘rsatiladi.", "Publication, Approved by JURO, and Top Lawyer are separate decisions. Every Top Lawyer designation includes public criteria.")}</p></div><button type="button" onClick={() => void load()} disabled={busy}>{busy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{text("Обновить", "Yangilash", "Refresh")}</button></header>
    {!profiles.length && !error && <p role="status">{text("Нет опубликованных профилей для отдельного статуса.", "Alohida maqom uchun nashr qilingan profillar yo‘q.", "There are no published profiles eligible for a trust designation.")}</p>}
    {error && <p className="staff-error" role="alert">{error}</p>}{notice && <p className="staff-verified" role="status"><Check aria-hidden="true" />{notice}</p>}
    {profiles.length > 0 && <form onSubmit={(event) => void submit(event)}>
      <label>{text("Юрист", "Yurist", "Lawyer")}<Select value={profileId} onChange={(event) => { const next = profiles.find((profile) => profile.id === event.target.value); setProfileId(event.target.value); preset(next, designation); }}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</Select></label>
      <label>{text("Статус", "Maqom", "Designation")}<Select value={designation} onChange={(event) => preset(selected, event.target.value as "juro_approval" | "top_lawyer")}><option value="juro_approval">{text("Одобрен JURO", "JURO tomonidan ma’qullangan", "Approved by JURO")}</option><option value="top_lawyer">Top Lawyer</option></Select></label>
      <label>{text("Решение", "Qaror", "Decision")}<Select value={decision} onChange={(event) => setDecision(event.target.value as "approved" | "revoked")}><option value="approved">{text("Присвоить", "Berish", "Grant")}</option><option value="revoked">{text("Снять", "Bekor qilish", "Revoke")}</option></Select></label>
      {designation === "top_lawyer" && decision === "approved" && <label>{text("Публичные критерии Top Lawyer", "Top yuristning ochiq mezonlari", "Public Top Lawyer criteria")}<textarea required minLength={20} maxLength={1200} value={criteria} onChange={(event) => setCriteria(event.target.value)} /></label>}
      <label>{text("Основание решения", "Qaror asosi", "Decision rationale")}<textarea required minLength={1} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <button className="staff-approve" disabled={busy || !reason.trim()}>{busy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : designation === "top_lawyer" ? <Crown aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{text("Сохранить статус", "Maqomni saqlash", "Save designation")}</button>
    </form>}
  </section>;
}
