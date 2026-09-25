import {z} from "zod";

export const SOURCE_OBSERVATION_MAX_AGE_MS = 5 * 60_000;
export const sourceObservationSchema = z.object({
  version: z.literal(2), officialUrl: z.url(), observedAt: z.iso.datetime().transform(value => new Date(value).toISOString()), current: z.boolean(),
  normalizedTextSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  /** Independently normalized from the same fetched HTML with the v2 profile. */
  normalizedTextSha256V2: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  rawContentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  normalizationPolicy: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  /** Whole-instrument publisher banner, bound to this exact observation. */
  lifecycle: z.object({repealedOn:z.iso.date().nullable()}).strict().optional(),
}).strict();
export type SourceObservation = z.infer<typeof sourceObservationSchema>;
export const pinnedSourceStatusSchema = z.object({observation: sourceObservationSchema.nullable(),
  pinnedTextSha256: z.string().regex(/^[a-f0-9]{64}$/u)}).strict();
export type PinnedSourceStatus = z.infer<typeof pinnedSourceStatusSchema>;
export type SourceObservationStore = {
  get(officialUrl: string): Promise<unknown>;
  put(observation: SourceObservation): Promise<void>;
};

function fresh(observation: SourceObservation, officialUrl: string, now: number): boolean {
  const age = now - Date.parse(observation.observedAt);
  return observation.officialUrl === officialUrl && age >= 0 && age < SOURCE_OBSERVATION_MAX_AGE_MS
    && (observation.current || observation.lifecycle!==undefined);
}

export function isFreshSourceObservation(value: unknown, officialUrl: string, now: number): value is SourceObservation {
  const parsed = sourceObservationSchema.safeParse(value);
  return parsed.success && fresh(parsed.data, officialUrl, now);
}

/** Repeal status and correspondence with the pinned text are separate checks. */
export function isCurrentSourceObservation(value: unknown, expected: {
  officialUrl: string; normalizedTextSha256: string; now: number;
}): boolean {
  const parsed = sourceObservationSchema.safeParse(value);
  return parsed.success && fresh(parsed.data, expected.officialUrl, expected.now)
    && parsed.data.current && (parsed.data.normalizedTextSha256 === expected.normalizedTextSha256
      || parsed.data.normalizedTextSha256V2 === expected.normalizedTextSha256);
}

/** Cache only public publisher observations. Neither a cache hit nor a failed
 * refresh can create a new observation timestamp. */
export function createSourceObservationReader(dependencies: {
  readPublisher: (officialUrl: string) => Promise<SourceObservation>;
  store?: SourceObservationStore; now?: () => number;
}) {
  const now = dependencies.now ?? Date.now;
  const cache = new Map<string, SourceObservation>();
  const pending = new Map<string, Promise<SourceObservation>>();
  return async (officialUrl: string): Promise<SourceObservation> => {
    const cached = cache.get(officialUrl);
    if (cached && fresh(cached, officialUrl, now())) return sourceObservationSchema.parse(cached);
    let operation = pending.get(officialUrl);
    if (!operation) {
      operation = (async () => {
        const stored = sourceObservationSchema.safeParse(await dependencies.store?.get(officialUrl));
        const observation = stored.success && fresh(stored.data, officialUrl, now())
          ? stored.data : sourceObservationSchema.parse(await dependencies.readPublisher(officialUrl));
        if (!fresh(observation, officialUrl, now())) throw new TypeError("SOURCE_OBSERVATION_UNAVAILABLE");
        if (dependencies.store && (!stored.success || observation.observedAt !== stored.data.observedAt)) {
          await dependencies.store.put(observation);
        }
        if (cache.size >= 256 && !cache.has(officialUrl)) cache.delete(cache.keys().next().value!);
        cache.set(officialUrl, observation);
        return observation;
      })();
      pending.set(officialUrl, operation);
    }
    try {return sourceObservationSchema.parse(await operation);}
    finally {if (pending.get(officialUrl) === operation) pending.delete(officialUrl);}
  };
}
