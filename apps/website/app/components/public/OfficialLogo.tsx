"use client";

import Image from "next/image";
import styles from "./official-logo.module.css";

/** Original JURO artwork, including the supplied wordmark and proportions. */
export function OfficialLogo({ inverse = false, priority = false, loading = false }: { inverse?: boolean; priority?: boolean; loading?: boolean }) {
  return <span className={styles.lockup} data-inverse={inverse || undefined} data-loading={loading || undefined}>
    <Image className={styles.primary} src="/brand/juro-logo-on-light.png" alt="" width={800} height={800} sizes="128px" priority={priority} unoptimized />
    <Image className={styles.inverse} src="/brand/juro-logo-on-dark.png" alt="" width={800} height={800} sizes="128px" priority={priority} unoptimized />
  </span>;
}
