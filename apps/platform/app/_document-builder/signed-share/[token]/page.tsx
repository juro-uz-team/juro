import type { Metadata } from "next";
import Image from "next/image";
import { sha256 } from "../../../../lib/document-builder/share-links/crypto";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { SignedShareAccessClient } from "./SignedShareAccessClient";
import { builderText } from "../../builder-localization";
import { publicBuilderLocale } from "../../public-builder-locale";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: {
  searchParams: Promise<{ lang?: string | string[] }>;
}): Promise<Metadata> {
  const locale = await publicBuilderLocale((await searchParams).lang);
  return {
    title: builderText(locale, { ru: "Доступ к подписанному документу", uz: "Imzolangan hujjatga kirish", en: "Access a signed document" }),
    robots: { index: false, follow: false, nocache: true },
  };
}

interface SignedShareRecord {
  expiresAt: string;
  deactivatedAt: string | null;
  deletedAt: string | null;
  archivedAt: string | null;
}

export default async function SignedSharePage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const { token } = await params;
  const locale = await publicBuilderLocale((await searchParams).lang);
  const hash = await sha256(token);
  let record: SignedShareRecord | null = null;
  try {
    record = await requireD1().prepare(
      `SELECT s.expires_at AS expiresAt, s.deactivated_at AS deactivatedAt,
       s.deleted_at AS deletedAt, f.archived_at AS archivedAt
       FROM standalone_signed_pdf_shares s JOIN document_files f ON f.id = s.file_id
       WHERE s.token_hash = ? LIMIT 1`,
    ).bind(hash).first<SignedShareRecord>();
  } catch {
    record = null;
  }
  const copy = builderText(locale, {
    ru: { expired: "Срок действия ссылки истёк", expiredDescription: "Доступ к этому файлу больше не предоставляется.", denied: "Доступ запрещён", deniedDescription: "Владелец файла закрыл доступ." },
    uz: { expired: "Havola muddati tugagan", expiredDescription: "Bu faylga kirish endi taqdim etilmaydi.", denied: "Kirish taqiqlangan", deniedDescription: "Fayl egasi kirishni yopgan." },
    en: { expired: "This link has expired", expiredDescription: "Access to this file is no longer available.", denied: "Access denied", deniedDescription: "The file owner has closed access." },
  });
  if (!record || Boolean(record.deletedAt) || record.expiresAt <= new Date().toISOString()) return <main className="dbt-public-message" lang={locale}><Image src="/brand/JURO_logo_transparent.png" alt="JURO" width={140} height={137} unoptimized/><h1>{copy.expired}</h1><p>{copy.expiredDescription}</p></main>;
  if (record.deactivatedAt || record.archivedAt) return <main className="dbt-public-message" lang={locale}><Image src="/brand/JURO_logo_transparent.png" alt="JURO" width={140} height={137} unoptimized/><h1>{copy.denied}</h1><p>{copy.deniedDescription}</p></main>;
  return <SignedShareAccessClient token={token} locale={locale}/>;
}
