"use client";

import { BrandImage } from "../../../_components/BrandImage";

import { FormEvent, useState } from "react";
import { ArrowRight, FileCheck2, LockKeyhole } from "lucide-react";
import type { PlatformLocale } from "../../../../lib/platform/routing";
import { builderText } from "../../builder-localization";

export function SignedShareAccessClient({ token, locale }: { token: string; locale: PlatformLocale }) {
  const copy = builderText(locale, {
    ru: { title: "Подписанный документ", description: "Введите код доступа, который сообщил владелец файла.", code: "Код доступа", denied: "Доступ запрещён.", failed: "Не удалось проверить код. Повторите попытку.", checking: "Проверяем…", confirm: "Подтвердить" },
    uz: { title: "Imzolangan hujjat", description: "Fayl egasi bergan kirish kodini kiriting.", code: "Kirish kodi", denied: "Kirish taqiqlangan.", failed: "Kodni tekshirib bo‘lmadi. Qayta urinib ko‘ring.", checking: "Tekshirilmoqda…", confirm: "Tasdiqlash" },
    en: { title: "Signed document", description: "Enter the access code provided by the file owner.", code: "Access code", denied: "Access denied.", failed: "We could not verify the code. Please try again.", checking: "Checking…", confirm: "Continue" },
  });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const target = window.open("about:blank", "_blank");
    setLoading(true);
    try {
      const response = await fetch(`/api/document-builder/standalone-signed-shares/${encodeURIComponent(token)}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-locale": locale },
        body: JSON.stringify({ code }),
      });
      const data = await response.json() as { viewerUrl?: string; error?: string };
      if (!response.ok || !data.viewerUrl) {
        target?.close();
        setError(copy.denied);
        return;
      }
      if (target) target.location.href = data.viewerUrl;
      else window.open(data.viewerUrl, "_blank", "noopener,noreferrer");
    } catch {
      target?.close();
      setError(copy.failed);
    } finally {
      setLoading(false);
    }
  };
  return <main className="dbt-signed-access" lang={locale}>
    <section>
      <BrandImage alt="JURO" width={125} height={122}/>
      <span className="dbt-access-icon"><FileCheck2 size={30}/></span>
      <h1>{copy.title}</h1>
      <p>{copy.description}</p>
      <form onSubmit={submit}>
        <label htmlFor="access-code">{copy.code}</label>
        <div className="dbt-code-input"><LockKeyhole size={19}/><input id="access-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" minLength={4} maxLength={6} aria-describedby={error ? "access-error" : undefined}/></div>
        {error && <p id="access-error" className="dbt-form-error" role="alert">{error}</p>}
        <button type="submit" disabled={loading || (code.length !== 4 && code.length !== 6)}>{loading ? copy.checking : copy.confirm}<ArrowRight size={18}/></button>
      </form>
    </section>
  </main>;
}
