import { openSavedCitation } from "./citation-storage";
import { parsePreparedProvisionKey } from "./prepared-provision-objects";

/** Translate verified saved evidence to the retained citation-dialog contract. */
export async function savedCitationDetails(input: Parameters<typeof openSavedCitation>[0] & {
  sourceUrl: string; article?: string;
}) {
  const saved = await openSavedCitation(input);
  if (!saved) return null;
  if (saved.receipt.officialUrl !== input.sourceUrl || (input.article !== undefined && saved.article !== input.article)) {
    throw new Error("CITATION_SELECTION_MISMATCH");
  }
  const prepared = saved.receipt.kind === "provision" ? parsePreparedProvisionKey(saved.receipt.r2Key) : null;
  const wholeSection = saved.receipt.kind === "normalized-section" || prepared?.wholeSection === true;
  const wholeDocument = saved.receipt.kind === "normalized-document"
    || (saved.receipt.kind === "provision" && saved.receipt.articleNumber === null && !!prepared && !wholeSection);
  return { documentTitle: saved.title, documentType: null, documentNumber: null, adoptingAuthority: null,
    sourceClass: "official", articleNumber: wholeSection ? null : saved.receipt.articleNumber, articleTitle: wholeSection ? null : saved.article,
    part: null, chapter: null, section: wholeSection ? saved.article : null, text: saved.text, fullArticle: !wholeDocument && !wholeSection,
    fullDocument: wholeDocument && !saved.sourceFile, fullSection: wholeSection, evidenceUnavailable: false, truncated: false, language: saved.receipt.languageTag,
    ...(saved.sourceFile ? { originalPdfAvailable: true } : {}),
    status: saved.status ?? "unconfirmed", validFrom: saved.effectiveDate, validTo: null, versionDate: null,
    officialUrl: saved.receipt.officialUrl, verifiedAt: saved.verifiedAt, availableLanguages: [], versionHistory: [] };
}
