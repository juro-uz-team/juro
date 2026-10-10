import { BrandImage } from "../../../_components/BrandImage";
import type { Metadata } from "next";
import { sha256 } from "../../../../lib/document-builder/share-links/crypto";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { paragraphsFromFinalText } from "../../../../lib/document-builder/generation/paragraphs";
import { PublicDocumentView } from "../../_components/PublicDocumentView";
import { builderText } from "../../builder-localization";
import { publicBuilderLocale } from "../../public-builder-locale";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: {
  searchParams: Promise<{ lang?: string | string[] }>;
}): Promise<Metadata> {
  const locale = await publicBuilderLocale((await searchParams).lang);
  return {
    title: builderText(locale, { ru: "Документ", uz: "Hujjat", en: "Shared document" }),
    robots: { index: false, follow: false, nocache: true },
  };
}

interface ShareRecord {
  title: string;
  finalContent: string;
  expiresAt: string;
  revokedAt: string | null;
}

export default async function SharePage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const { token } = await params;
  const locale = await publicBuilderLocale((await searchParams).lang);
  const tokenHash = await sha256(token);
  let record: ShareRecord | null = null;
  try {
    record = await requireD1().prepare(
      `SELECT d.title, c.final_content AS finalContent, s.expires_at AS expiresAt, s.revoked_at AS revokedAt
       FROM document_share_links s JOIN documents d ON d.id = s.document_id
       JOIN document_current_content c ON c.document_id = d.id
       WHERE s.token_hash = ? LIMIT 1`,
    ).bind(tokenHash).first<ShareRecord>();
  } catch {
    record = null;
  }
  if (!record || record.revokedAt || record.expiresAt <= new Date().toISOString()) {
    const copy = builderText(locale, {
      ru: { title: "Ссылка недействительна", description: "Срок действия ссылки истёк либо владелец отозвал доступ." },
      uz: { title: "Havola haqiqiy emas", description: "Havola muddati tugagan yoki egasi kirishni bekor qilgan." },
      en: { title: "This link is no longer valid", description: "The link has expired or the owner has revoked access." },
    });
    return <main className="dbt-public-message" lang={locale}><BrandImage alt="JURO" width={140} height={137}/><h1>{copy.title}</h1><p>{copy.description}</p></main>;
  }
  return <PublicDocumentView title={record.title} paragraphs={paragraphsFromFinalText(record.finalContent)} locale={locale} />;
}
