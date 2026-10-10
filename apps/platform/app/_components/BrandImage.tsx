import type { ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  mark?: boolean;
  priority?: boolean;
  tone?: "light" | "dark";
};

/** Transparent artwork selected by surface without runtime color filters. */
export function BrandImage({ mark = false, priority, tone, alt = "", ...props }: Props) {
  const name = mark ? "mark" : "logo";
  return <span className="brand-image" data-brand-tone={tone}>
    {/* eslint-disable @next/next/no-img-element */}
    <img {...props} className={`brand-on-light ${props.className ?? ""}`} src={`/brand/juro-${name}-on-light.png`} alt={alt} fetchPriority={priority ? "high" : undefined} />
    <img {...props} className={`brand-on-dark ${props.className ?? ""}`} src={`/brand/juro-${name}-on-dark.png`} alt={alt} fetchPriority={priority ? "high" : undefined} />
  </span>;
}
