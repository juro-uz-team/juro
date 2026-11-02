import { notFound } from "next/navigation";
import { renderPractice } from "../../../../_practice/PracticePage";
export const dynamic = "force-dynamic";
export default async function PracticePage({ params }: { params: Promise<{ locale: string; workspaceId: string }> }) {
  const value = await params;
  if (value.locale !== "ru" && value.locale !== "uz" && value.locale !== "en") notFound();
  return renderPractice({ locale: value.locale, workspaceId: value.workspaceId, embedded: true });
}
