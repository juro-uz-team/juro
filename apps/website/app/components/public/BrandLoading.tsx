"use client";

import { useEffect, useState } from "react";
import { OfficialLogo } from "./OfficialLogo";
import styles from "./brand-loading.module.css";

export function LoadingMark({ label = "JURO · Loading" }: { label?: string }) {
  return <div className={styles.mark} role="status" aria-label={label}>
    <span className={styles.halo} aria-hidden="true" />
    <span className={styles.logo}><OfficialLogo priority loading /></span>
    <span className={styles.track} aria-hidden="true"><i /></span>
  </div>;
}

export function BrandLoading({ language }: { language: string }) {
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    let exit: ReturnType<typeof setTimeout>;
    const ready = () => {
      document.documentElement.removeAttribute("data-juro-loading");
      exit = setTimeout(() => setFinished(true), 200);
    };
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready, { once: true });
    const safety = setTimeout(ready, 4500);
    return () => { window.removeEventListener("load", ready); clearTimeout(safety); clearTimeout(exit); };
  }, []);
  if (finished) return null;
  const label = language === "uz" ? "JURO yuklanmoqda" : language === "en" ? "Loading JURO" : "Загрузка JURO";
  return <div className={styles.overlay}><LoadingMark label={label} /></div>;
}
