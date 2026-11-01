import { z } from "zod";
import type { ReadCandidate } from "./candidate-selection";

/** Navigation preference, not an applicability verdict; every source remains selectable. */
export function publisherNavigationPriority(candidate: ReadCandidate, today = new Date().toISOString().slice(0, 10)) {
  if (candidate.scope.kind !== "current") return 0;
  const url = new URL(candidate.sourceUrl);
  if (candidate.requestedEdition || url.searchParams.has("ONDATE") || url.searchParams.has("ONDATE2")) return 2;
  const notice = candidate.sourceNotes?.[0] ?? candidate.readRange?.sourceNotes?.[0] ?? "";
  if (/(?:^|\s)(?:в части|за исключением|частично|qisman|қисман)(?=\s|[,.;:]|$)/iu.test(notice)) return 0;
  const match = /^(?:Акт утратил силу|Ҳужжат кучини йўқотган|Hujjat kuchini yo[‘’ʻʼ']qotgan)\s+(\d{2})\.(\d{2})\.(\d{4})(?=\s|$)/u.exec(notice.trim());
  if (!match) return 0;
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  return z.iso.date().safeParse(date).success && date <= today ? 1 : 0;
}
