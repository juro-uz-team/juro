"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { legalReferenceMarkdown } from "../../lib/ai/legal-reference-markdown";
import type { ReferenceSource } from "../../lib/ai/legal-inline-references";
import type { PlatformLocale } from "../../lib/platform/routing";

function safeLink(value: string | undefined, allowedLinks?: ReadonlySet<string>): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    if (allowedLinks && !allowedLinks.has(url.href)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function Table({ children, label, ...props }: ComponentPropsWithoutRef<"table"> & { label: string }) {
  return <div className="safe-markdown-table" role="region" aria-label={label} tabIndex={0} style={{ maxWidth: "100%", overflowX: "auto" }}>
    <table {...props} style={{ width: "100%", borderCollapse: "collapse" }}>{children}</table>
  </div>;
}

/** Safe, reusable Markdown presentation. Raw HTML and images are never rendered. */
export function SafeMarkdown({
  children,
  allowedLinks,
  referenceSources,
  className,
  locale = "ru",
}: {
  children?: string;
  allowedLinks?: readonly string[];
  referenceSources?: readonly ReferenceSource[];
  className?: string;
  locale?: PlatformLocale;
}) {
  const allowlist = allowedLinks ? new Set(allowedLinks.flatMap((value) => {
    const safe = safeLink(value);
    return safe ? [safe] : [];
  })) : undefined;
  return <div className={className ? `safe-markdown ${className}` : "safe-markdown"}>
    <ReactMarkdown
      remarkPlugins={referenceSources ? [remarkGfm, legalReferenceMarkdown(referenceSources)] : [remarkGfm]}
      skipHtml
      urlTransform={(url) => safeLink(url, allowlist) ?? ""}
      components={{
        img: () => null,
        a: ({ href, children: label }) => {
          const hrefValue = safeLink(href, allowlist);
          return hrefValue
            ? <a href={hrefValue} target="_blank" rel="noopener noreferrer">{label}</a>
            : <span>{label as ReactNode}</span>;
        },
        h1: ({ children: value }) => <h2>{value}</h2>,
        h2: ({ children: value }) => <h3>{value}</h3>,
        h3: ({ children: value }) => <h4>{value}</h4>,
        h4: ({ children: value }) => <h5>{value}</h5>,
        h5: ({ children: value }) => <h6>{value}</h6>,
        h6: ({ children: value }) => <h6>{value}</h6>,
        ul: ({ children: value }) => <ul>{value}</ul>,
        ol: ({ children: value }) => <ol>{value}</ol>,
        li: ({ children: value }) => <li>{value}</li>,
        table: ({ children: value, node, ...props }) => {
          void node;
          return <Table {...props} label={{ ru: "Прокручиваемая таблица", uz: "Aylantiriladigan jadval", en: "Scrollable table" }[locale]}>{value}</Table>;
        },
        thead: ({ children: value }) => <thead>{value}</thead>,
        tbody: ({ children: value }) => <tbody>{value}</tbody>,
        tr: ({ children: value }) => <tr>{value}</tr>,
        th: ({ children: value }) => <th scope="col">{value}</th>,
        td: ({ children: value }) => <td>{value}</td>,
        blockquote: ({ children: value }) => <blockquote>{value}</blockquote>,
        code: ({ children: value }) => <code>{value}</code>,
      }}
    >{children ?? ""}</ReactMarkdown>
  </div>;
}
