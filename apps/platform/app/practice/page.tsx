import { renderPractice } from "../_practice/PracticePage";
export const dynamic = "force-dynamic";
export default async function PracticePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  return renderPractice({ locale: search.locale === "en" ? "en" : search.locale === "uz" ? "uz" : "ru", workspaceId: typeof search.workspaceId === "string" ? search.workspaceId : undefined, initialCaseId: typeof search.caseId === "string" ? search.caseId : undefined, invitationToken: typeof search.invite === "string" ? search.invite : undefined });
}
