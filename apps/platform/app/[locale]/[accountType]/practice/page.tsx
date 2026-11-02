import { notFound } from "next/navigation";
import { renderPractice } from "../../../_practice/PracticePage";
import { isAccountType } from "../../../../lib/platform/routing";
export const dynamic = "force-dynamic";
export default async function PracticePage({ params }: { params: Promise<{ locale: string; accountType: string }> }) {
  const { locale, accountType } = await params;
  if ((locale !== "ru" && locale !== "uz" && locale !== "en") || !isAccountType(accountType)) notFound();
  return renderPractice({ locale, embedded: true });
}
