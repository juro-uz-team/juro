"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { PlatformLocale } from "../../lib/platform/routing";

/** Visible liveness is independent of stage announcements and never estimates completion. */
export function AnswerActivity({ submittedAt, locale, status }: { submittedAt: number; locale: PlatformLocale; status?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - submittedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [submittedAt]);
  const labels = {
    en: { elapsed: "Elapsed", overrun: "Still working. This is taking longer than usual." },
    ru: { elapsed: "Прошло", overrun: "Работа продолжается. Требуется больше времени, чем обычно." },
    uz: { elapsed: "O‘tgan vaqt", overrun: "Ish davom etmoqda. Odatdagidan ko‘proq vaqt talab etilmoqda." },
  }[locale];
  return <div className="answer-activity">
    <div className="answer-activity__row">
      <LoaderCircle className="answer-activity__spinner" aria-hidden="true" />
      {status && <span className="answer-activity__status">{status}</span>}
      <span className="answer-activity__time" aria-live="off"><span>{labels.elapsed}:</span> <time>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</time></span>
    </div>
    {elapsed >= 30 && <p role="status">{labels.overrun}</p>}
  </div>;
}
