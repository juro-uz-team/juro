"use client";

import Image from "next/image";
import styles from "./official-logo.module.css";

/** Original JURO artwork, including the supplied wordmark and proportions. */
export function OfficialLogo({ inverse = false, priority = false }: { inverse?: boolean; priority?: boolean }) {
  return <span className={styles.lockup} data-inverse={inverse || undefined}>
    <Image className={styles.primary} src="/juro-logo-primary.avif" alt="" width={1248} height={1248} unoptimized priority={priority} />
    <Image className={styles.inverse} src="/juro-logo-light.avif" alt="" width={1248} height={1248} unoptimized priority={priority} />
  </span>;
}
