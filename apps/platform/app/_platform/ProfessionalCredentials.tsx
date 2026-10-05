"use client";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated credentials are loaded after mount. */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileCheck2, LoaderCircle, Plus, Save, Trash2, Upload } from "lucide-react";
import type { PlatformLocale } from "../../lib/platform/routing";
import { FilePicker } from "../_components/ProfileControls";
import { Select } from "../_components/Select";

type Representative = { name: string; position: string; email: string };
type Credentials = {
  defaultType?: string;
  details: { professional_type: string; organization_name: string | null; registration_number: string | null; license_number: string | null; representatives: Representative[] } | null;
  documents: { id: string; file_name: string; kind: string }[];
};

export function ProfessionalCredentials({ locale, profileId }: { locale: PlatformLocale; profileId?: string }) {
  const [data, setData] = useState<Credentials | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState("lawyer");
  const [representatives, setRepresentatives] = useState<Representative[]>([]);
  const text = (ru: string, uz: string, en: string) => ({ ru, uz, en })[locale];
  const loadError = text("Не удалось загрузить документы.", "Hujjatlarni yuklab bo‘lmadi.", "We could not load your verification documents.");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/platform/lawyer-profile/credentials", { cache: "no-store" });
      if (response.status === 404) return;
      if (!response.ok) throw new Error(loadError);
      const body = await response.json() as Credentials;
      setData(body);
      setType(body.details?.professional_type ?? body.defaultType ?? "lawyer");
      setRepresentatives(body.details?.representatives ?? []);
      setError("");
    } catch { setError(loadError); }
  }, [loadError]);
  useEffect(() => { void load(); }, [load, profileId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const upload = form.has("file");
    setBusy(true); setNotice(""); setError("");
    try {
      const file = form.get("file");
      if (upload && file instanceof File && file.size > 10 * 1024 * 1024) throw new Error(text("Размер файла не должен превышать 10 МБ.", "Fayl 10 MB dan oshmasligi kerak.", "Choose a file smaller than 10 MB."));
      const response = await fetch("/api/platform/lawyer-profile/credentials", {
        method: "POST",
        headers: { "x-juro-csrf": "1", "x-juro-locale": locale, ...(upload ? {} : { "content-type": "application/json" }) },
        body: upload ? form : JSON.stringify({ professionalType: type, organizationName: String(form.get("organizationName") ?? "") || null, registrationNumber: String(form.get("registrationNumber") ?? "") || null, licenseNumber: String(form.get("licenseNumber") ?? "") || null, representatives }),
      });
      if (!response.ok) throw new Error(text("Не удалось сохранить. Проверьте данные и повторите попытку.", "Saqlanmadi. Ma’lumotlarni tekshiring va qayta urining.", "We could not save this. Check the details and try again."));
      setNotice(text("Сохранено. Существенные изменения требуют повторной проверки JURO.", "Saqlandi. Muhim o‘zgarishlar JURO tekshiruvini talab qiladi.", "Saved. Material changes require JURO review."));
      if (upload) element.reset();
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : loadError); }
    finally { setBusy(false); }
  }

  if (!data) return error ? <p className="profile-message error" role="alert">{error}<button className="account-button secondary" type="button" onClick={() => void load()}>{text("Повторить", "Qayta urinish", "Try again")}</button></p> : null;
  const details = data.details;
  return <section className="professional-credentials">
    <h2><FileCheck2 aria-hidden="true" />{text("Квалификация и документы", "Malaka va hujjatlar", "Credentials & verification")}</h2>
    <p>{text("Документы доступны только уполномоченным сотрудникам JURO и не публикуются в каталоге.", "Hujjatlar faqat vakolatli JURO xodimlariga ko‘rinadi va katalogda e’lon qilinmaydi.", "Only authorised JURO staff can see these documents. They never appear on your public profile.")}</p>
    <form onSubmit={submit}>
      <fieldset className="account-fields" disabled={busy}>
        <legend className="sr-only">{text("Квалификация", "Malaka", "Professional credentials")}</legend>
        <label>{text("Тип специалиста", "Mutaxassis turi", "Professional type")}<Select value={type} onChange={event => setType(event.target.value)}>{[["lawyer", "Юрист", "Yurist", "Lawyer"], ["advocate", "Адвокат", "Advokat", "Advocate"], ["firm", "Юридическая фирма", "Yuridik firma", "Legal firm"], ["other", "Другой специалист", "Boshqa mutaxassis", "Other professional"]].map(([value, ru, uz, en]) => <option key={value} value={value}>{text(ru, uz, en)}</option>)}</Select></label>
        {type === "firm" && <>
          <label>{text("Название организации", "Tashkilot nomi", "Organisation name")}<input name="organizationName" defaultValue={details?.organization_name ?? ""} required maxLength={300} /></label>
          <label>{text("Регистрационный номер", "Ro‘yxat raqami", "Registration number")}<input name="registrationNumber" defaultValue={details?.registration_number ?? ""} required maxLength={100} /></label>
        </>}
        {type === "advocate" && <label>{text("Номер лицензии", "Litsenziya raqami", "Advocate licence number")}<input name="licenseNumber" defaultValue={details?.license_number ?? ""} required maxLength={100} /></label>}
      </fieldset>
      {type === "firm" && <div className="credential-representatives"><h3>{text("Представители", "Vakillar", "Representatives")}</h3>
        {representatives.map((person, index) => <fieldset className="credential-person" key={index} disabled={busy}><legend>{text("Представитель", "Vakil", "Representative")} {index + 1}</legend>
          {(["name", "position", "email"] as const).map(field => <label key={field}>{field === "name" ? text("Имя", "Ism", "Name") : field === "position" ? text("Должность", "Lavozim", "Position") : "Email"}<input type={field === "email" ? "email" : "text"} required={field === "name"} maxLength={field === "email" ? 254 : 200} value={person[field]} onChange={event => setRepresentatives(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: event.target.value } : item))} /></label>)}
          <button className="account-button secondary" type="button" aria-label={`${text("Удалить представителя", "Vakilni o‘chirish", "Remove representative")} ${index + 1}`} onClick={() => setRepresentatives(current => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 aria-hidden="true" /></button>
        </fieldset>)}
        <button className="account-button secondary" type="button" disabled={busy || representatives.length >= 30} onClick={() => setRepresentatives(current => [...current, { name: "", position: "", email: "" }])}><Plus aria-hidden="true" />{text("Добавить представителя", "Vakil qo‘shish", "Add representative")}</button>
      </div>}
      <button className="account-button" disabled={busy}>{busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}{text("Сохранить сведения", "Ma’lumotlarni saqlash", "Save details")}</button>
    </form>
    <form onSubmit={submit} className="credential-upload">
      <h3>{text("Подтверждающие документы", "Tasdiqlovchi hujjatlar", "Verification documents")}</h3>
      <fieldset className="account-fields" disabled={busy}>
        <legend className="sr-only">{text("Загрузка документа", "Hujjat yuklash", "Upload a document")}</legend>
        <label>{text("Вид документа", "Hujjat turi", "Document type")}<Select name="kind" defaultValue="education"><option value="education">{text("Образование", "Ta’lim", "Education")}</option>{type === "advocate" && <option value="license">{text("Лицензия", "Litsenziya", "Licence")}</option>}{type === "firm" && <><option value="registration">{text("Регистрация организации", "Tashkilot ro‘yxati", "Company registration")}</option><option value="authority">{text("Полномочия представителя", "Vakil vakolati", "Representative authority")}</option></>}<option value="other">{text("Дополнительные сведения", "Qo‘shimcha ma’lumot", "Other")}</option></Select></label>
        <label>{text("Файл", "Fayl", "File")}<FilePicker locale={locale} name="file" accept="application/pdf,image/jpeg,image/png" required aria-describedby="credentials-file-hint" /></label>
      </fieldset>
      <p id="credentials-file-hint">PDF, JPEG, PNG · {text("до 10 МБ", "10 MB gacha", "up to 10 MB")}</p>
      <button className="account-button" disabled={busy}><Upload aria-hidden="true" />{text("Загрузить документ", "Hujjat yuklash", "Upload document")}</button>
    </form>
    {data.documents.length > 0 && <ul className="credential-documents">{data.documents.map(document => <li key={document.id}><FileCheck2 aria-hidden="true" /><span>{document.file_name}</span></li>)}</ul>}
    {error && <p className="profile-message error" role="alert">{error}</p>}
    {notice && <p className="profile-message success" role="status">{notice}</p>}
  </section>;
}
