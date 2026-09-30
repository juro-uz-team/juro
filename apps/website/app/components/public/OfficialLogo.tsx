"use client";

import Image from "next/image";
import styles from "./official-logo.module.css";

/** Original JURO artwork, including the supplied wordmark and proportions. */
export function OfficialLogo({ inverse = false, priority = false }: { inverse?: boolean; priority?: boolean }) {
  return <span className={styles.lockup} data-inverse={inverse || undefined}>
    <Image className={styles.primary} src="/brand/JURO_logo_navy.png" alt="" width={1254} height={1254} sizes="(max-width: 620px) 54px, 64px" priority={priority} />
    <Image className={styles.inverse} src="/brand/JURO_logo_transparent.png" alt="" width={786} height={771} sizes="(max-width: 620px) 34px, 41px" priority={priority} />
  </span>;
}
