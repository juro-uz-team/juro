"use client";

import { useEffect, useRef, useState } from "react";
import type { AltchaWidgetElement } from "altcha";

export function TurnstileWidget({ siteKey, action, locale, onToken, resetSignal }: {
  siteKey: string; action: string; locale: "ru" | "uz" | "en"; onToken: (token: string) => void; resetSignal?: number;
}) {
  const callback = useRef(onToken);
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { callback.current = onToken; }, [onToken]);
  useEffect(() => {
    let active = true;
    let widget: AltchaWidgetElement | undefined;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    callback.current("");
    const privateHost = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
    if (siteKey === "private-local" && privateHost) callback.current("private-local");
    else if (siteKey === "native-altcha") {
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
          callback.current(detail.state === "verified" ? detail.payload ?? "" : "");
          if (refresh) clearTimeout(refresh);
          if (detail.state === "verified") {
            let remaining = 0;
            try {
              const payload = JSON.parse(atob(detail.payload ?? ""));
              const expires = Number(new URLSearchParams(String(payload.salt).split("?")[1]).get("expires"));
              remaining = Math.max(0, Math.min(240_000, expires * 1000 - Date.now() - 10_000));
              if (!Number.isFinite(remaining)) remaining = 0;
            } catch { /* An invalid payload is cleared and retried immediately. */ }
            refresh = setTimeout(() => { callback.current(""); widget?.reset(); void widget?.verify(); }, remaining);
          }
        });
        container.current.replaceChildren(widget);
      }).catch(() => { if (active) setFailed(true); });
    }
    return () => { active = false; if (refresh) clearTimeout(refresh); widget?.remove(); callback.current(""); };
  }, [siteKey, action, locale, resetSignal]);
  if (siteKey === "private-local") return null;
  return <div ref={container}>{failed && <p role="alert">{locale === "ru" ? "Проверка не загрузилась. Обновите страницу." : locale === "uz" ? "Tekshiruv yuklanmadi. Sahifani yangilang." : "Verification could not load. Refresh the page."}</p>}</div>;
}
