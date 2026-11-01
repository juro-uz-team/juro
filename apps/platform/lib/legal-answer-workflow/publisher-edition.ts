import { legalAnswerDeadlineMs } from "./deadline";
import { z } from "zod";
import type { EvidenceScope } from "./evidence";
import { officialPublisherUrl } from "./official-capture";

function publisherDay(value: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})(?: \d{2})?$/u.exec(value);
  const day = match ? `${match[3]}-${match[2]}-${match[1]}` : "";
  if (!z.iso.date().safeParse(day).success) throw new Error("PUBLISHER_EDITION_DATE");
  return day;
}

export function publisherUrlForScope(sourceUrl: string, scope: EvidenceScope): string {
  const url = new URL(officialPublisherUrl(sourceUrl));
  if (!/^\/(?:ru\/|uz\/|uzc\/|en\/)?docs\/-?\d+\/?$/u.test(url.pathname)) throw new Error("PUBLISHER_EDITION_ENDPOINT");
  url.search = "";
  if (scope.kind === "historical") {
    if (!z.iso.date().safeParse(scope.at).success) throw new Error("PUBLISHER_EDITION_DATE");
    const [year, month, day] = scope.at.split("-");
    url.searchParams.set("ONDATE", `${day}.${month}.${year}`);
  }
  return url.href;
}

export function historicalPublisherUrl(sourceUrl: string, editionDates: string[], at: string): string {
  if (!z.iso.date().safeParse(at).success) throw new Error("PUBLISHER_EDITION_DATE");
  const candidates = [...new Set(editionDates)].map(token => ({ token, day: publisherDay(token) })).filter(item => item.day <= at);
  const latest = candidates.map(item => item.day).sort().at(-1);
  const selected = candidates.filter(item => item.day === latest);
  if (selected.length !== 1) throw new Error("PUBLISHER_EDITION_SELECTION");
  const url = new URL(publisherUrlForScope(sourceUrl, { kind: "current" }));
  url.searchParams.set("ONDATE", selected[0].token);
  return url.href;
}

/** Proves which publisher edition was served, not the effective date of every provision within it. */
export function verifyPublisherEdition(input: {
  requestedUrl: string; finalUrl: string; observedAt: string; selectedEditions: string[]; editionDates: string[];
  scope: EvidenceScope; submittedAt: number; deadlineMs: number;
}) {
  const observedAt = Date.parse(input.observedAt), now = Date.now();
  if (!Number.isFinite(input.submittedAt) || !Number.isFinite(input.deadlineMs) || input.deadlineMs <= 0 || input.deadlineMs > legalAnswerDeadlineMs
    || !Number.isFinite(observedAt) || observedAt < input.submittedAt || observedAt > now + 1000
    || observedAt > input.submittedAt + input.deadlineMs || now > input.submittedAt + input.deadlineMs) {
    throw new Error("PUBLISHER_EDITION_OBSERVATION");
  }
  if (input.selectedEditions.length !== 1 || !input.editionDates.length || input.editionDates.length > 4096) {
    throw new Error("PUBLISHER_EDITION_SELECTION");
  }
  const selectedEdition = publisherDay(input.selectedEditions[0]);
  const selectedEditionToken = input.selectedEditions[0];
  const expected = publisherUrlForScope(input.requestedUrl, input.scope);
  const requested = officialPublisherUrl(input.requestedUrl);
  const specificEdition = new URL(publisherUrlForScope(input.requestedUrl, { kind: "current" }));
  specificEdition.searchParams.set("ONDATE", selectedEditionToken);
  if ((requested !== expected && (input.scope.kind !== "historical" || requested !== specificEdition.href))
    || officialPublisherUrl(input.finalUrl) !== requested) throw new Error("PUBLISHER_EDITION_ENDPOINT");
  const editions = [...new Set(input.editionDates.map(publisherDay))].sort();
  // The publisher jurisdiction uses UTC+05:00. This is a calendar observation,
  // never an inferred statutory commencement time.
  const observedDay = new Date(observedAt + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const requestedDate = input.scope.kind === "historical" ? input.scope.at : null;
  const at = requestedDate ?? observedDay;
  if (!input.editionDates.includes(selectedEditionToken) || at > observedDay || editions.filter(day => day <= at).at(-1) !== selectedEdition) {
    throw new Error("PUBLISHER_EDITION_SELECTION");
  }
  return { kind: input.scope.kind === "current" ? "current_publisher_edition" as const : "historical_publisher_edition" as const,
    requestedDate, selectedEdition, selectedEditionToken, observedAt: input.observedAt, url: requested };
}
