"use client";

import { useEffect, useRef, useState } from "react";
import type { AltchaWidgetElement } from "altcha";

export function TurnstileWidget({ siteKey, action, locale, onToken, resetSignal }: {
  siteKey: string; action: string; locale: "ru" | "uz" | "en"; onToken: (token: string) => void; resetSignal?: number;
}) {
  const callback = useRef(onToken);
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { callback.current = onToken; }, [onToken]);
  useEffect(() => {
    let active = true;
    let widget: AltchaWidgetElement | undefined;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      if (!active) return;
      callback.current("");
      setFailed(true);
      // Ignore any late verification from the failed attempt.
      active = false;
      if (refresh) clearTimeout(refresh);
      if (deadline) clearTimeout(deadline);
      widget?.remove();
    };
    const startDeadline = () => {
      if (deadline) clearTimeout(deadline);
      deadline = setTimeout(fail, 30_000);
    };
    callback.current("");
    const privateHost = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
    if (siteKey === "private-local" && privateHost) callback.current("private-local");
    else if (siteKey === "native-altcha") {
      startDeadline();
      void import("altcha/i18n").then(() => {
        if (!active || !container.current) return;
        widget = document.createElement("altcha-widget");
        widget.setAttribute("challenge", `/api/auth/challenge?action=${encodeURIComponent(action)}`);
        widget.setAttribute("language", locale);
        widget.setAttribute("auto", "onload");
        widget.setAttribute("workers", "2");
        widget.addEventListener("statechange", event => {
          if (!active) return;
          const detail = (event as CustomEvent<{ state: string; payload?: string }>).detail;
          if (detail.state === "error") { fail(); return; }
          callback.current(detail.state === "verified" ? detail.payload ?? "" : "");
          if (refresh) clearTimeout(refresh);
          if (detail.state === "verified") {
            if (deadline) clearTimeout(deadline);
            setFailed(false);
            let remaining = 0;
            try {
              const payload = JSON.parse(atob(detail.payload ?? ""));
              const expires = Number(new URLSearchParams(String(payload.salt).split("?")[1]).get("expires"));
              remaining = Math.max(0, Math.min(240_000, expires * 1000 - Date.now() - 10_000));
              if (!Number.isFinite(remaining)) remaining = 0;
            } catch { /* An invalid payload is cleared and retried immediately. */ }
            refresh = setTimeout(() => { callback.current(""); startDeadline(); widget?.reset(); void widget?.verify().catch(fail); }, remaining);
          }
        });
        container.current.replaceChildren(widget);
      }).catch(fail);
    } else {
      // Unsupported configuration must not silently strand the submit control.
      deadline = setTimeout(fail, 0);
    }
    return () => { active = false; if (refresh) clearTimeout(refresh); if (deadline) clearTimeout(deadline); widget?.remove(); callback.current(""); };
  }, [siteKey, action, locale, resetSignal, attempt]);
  if (siteKey === "private-local") return null;
  return <div>
    <div ref={container} />
    {failed && <div>
      <p role="alert">{locale === "ru" ? "Проверка безопасности не завершилась. Повторите попытку." : locale === "uz" ? "Xavfsizlik tekshiruvi tugamadi. Qayta urinib ko‘ring." : "The security check could not finish. Try again."}</p>
      <button type="button" className="auth-text-button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>{locale === "ru" ? "Повторить проверку" : locale === "uz" ? "Tekshiruvni qayta boshlash" : "Retry security check"}</button>
    </div>}
  </div>;
}
