"use client";

import { useEffect, useRef } from "react";

export function TurnstileWidget({ siteKey, onToken, resetSignal }: {
  siteKey: string; action: string; locale: "ru" | "uz" | "en"; onToken: (token: string) => void; resetSignal?: number;
}) {
  const callback = useRef(onToken);
  useEffect(() => { callback.current = onToken; }, [onToken]);
  useEffect(() => {
    callback.current(siteKey === "private-local" ? "private-local" : "");
    return () => callback.current("");
  }, [siteKey, resetSignal]);
  return null;
}
