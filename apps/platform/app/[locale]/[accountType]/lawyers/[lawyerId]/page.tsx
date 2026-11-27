import { notFound } from "next/navigation";
import { requireChatGPTUser } from "../../../../chatgpt-auth";
import { isLocale, isPersonalAccountType, platformPath } from "../../../../../lib/platform/routing";
import { LawyerProfileClient, LawyerProfileView } from "../../../../_platform/LawyerProfileClient";
import { praeLegalDirectoryProfiles } from "../../../../_platform/prae-legal-directory";

export const dynamic = "force-dynamic";

export default async function LawyerProfilePage({ params }: { params: Promise<{ locale: string; accountType: string; lawyerId: string }> }) {
  const { locale, accountType, lawyerId } = await params;
  if (!isLocale(locale) || !isPersonalAccountType(accountType)) notFound();
  await requireChatGPTUser(`${platformPath(locale, accountType, "lawyers")}/${encodeURIComponent(lawyerId)}`);

  if (accountType === "individual" && lawyerId.startsWith("praelegal-")) {
    const profile = praeLegalDirectoryProfiles(locale).find((profile) => profile.id === lawyerId);
    if (!profile) notFound();
    return <LawyerProfileView locale={locale} lawyerId={lawyerId} lawyer={profile} />;
  }

  return <LawyerProfileClient locale={locale} lawyerId={lawyerId} />;
}
