import type {LegalSourceContext} from "../ai/provider";
import {isCurrentSourceObservation, isFreshSourceObservation, SOURCE_OBSERVATION_MAX_AGE_MS, type SourceObservation} from "./source-observation";

/** Synthesis can outlive an observation. Recheck referenced current evidence
 * before finalization without changing the pinned text or historical endpoint. */
export async function validateFinalSourceObservations(input: {
  sources: readonly LegalSourceContext[]; sourceIds: readonly string[];
  observe: (url: string) => Promise<SourceObservation>; now?: () => number;
}): Promise<Map<string, LegalSourceContext>> {
  const now = input.now ?? Date.now;
  const byId = new Map(input.sources.map(source => [source.id, source]));
  const refreshes = new Map<string, Promise<SourceObservation>>();
  const validated = new Map<string, LegalSourceContext>();
  for (const id of new Set(input.sourceIds)) {
    const source = byId.get(id);
    if (!source) throw new TypeError("FINAL_SOURCE_OBSERVATION_UNAVAILABLE");
    if (source.applicabilityStatus === "historical" || source.sourceClass === "SECONDARY_REFERENCE" || source.sourceType !== "lex") {
      validated.set(id, source); continue;
    }
    const pinned = source.currentSourceStatus;
    if (!pinned) {
      const age = now() - Date.parse(source.verifiedAt);
      if (source.id.startsWith("target:") || !Number.isFinite(age) || age < 0 || age >= SOURCE_OBSERVATION_MAX_AGE_MS) {
        throw new TypeError("FINAL_SOURCE_OBSERVATION_UNAVAILABLE");
      }
      validated.set(id, source); continue;
    }
    let observation = pinned.observation;
    if (!isFreshSourceObservation(observation, source.officialUrl, now())) {
      let refresh = refreshes.get(source.officialUrl);
      if (!refresh) {refresh = input.observe(source.officialUrl); refreshes.set(source.officialUrl, refresh);}
      try {observation = await refresh;}
      catch {throw new TypeError("FINAL_SOURCE_OBSERVATION_UNAVAILABLE");}
    }
    if (!isCurrentSourceObservation(observation, {officialUrl: source.officialUrl,
      normalizedTextSha256: pinned.pinnedTextSha256, now: now()})) throw new TypeError("FINAL_SOURCE_OBSERVATION_UNAVAILABLE");
    validated.set(id, {...source, verifiedAt: observation!.observedAt, lastCheckedAt: observation!.observedAt,
      currentSourceStatus: {...pinned, observation}});
  }
  // An earlier source can expire while a later source is being refreshed.
  const completedAt = now();
  for (const source of validated.values()) {
    if (source.applicabilityStatus === "historical" || source.sourceClass === "SECONDARY_REFERENCE" || source.sourceType !== "lex") continue;
    if (!source.currentSourceStatus) {
      const age = completedAt - Date.parse(source.verifiedAt);
      if (!Number.isFinite(age) || age < 0 || age >= SOURCE_OBSERVATION_MAX_AGE_MS) throw new TypeError("FINAL_SOURCE_OBSERVATION_UNAVAILABLE");
      continue;
    }
    if (!isCurrentSourceObservation(source.currentSourceStatus.observation, {
      officialUrl: source.officialUrl, normalizedTextSha256: source.currentSourceStatus.pinnedTextSha256,
      now: completedAt,
    })) throw new TypeError("FINAL_SOURCE_OBSERVATION_UNAVAILABLE");
  }
  return validated;
}
