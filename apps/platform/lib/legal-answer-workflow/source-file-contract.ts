import { z } from "zod";

// Both discovery lanes admit up to eight assets. Stay below the provider's
// 50 MB aggregate file limit; individual original artifacts remain bounded separately.
export const sourceFileContextLimits = { count: 16, bytes: 48_000_000 } as const;

export class SourceFileContextLimit extends Error {
  constructor() { super("SOURCE_FILE_CONTEXT_LIMIT"); }
}

const storedFileSchema = z.object({
  objectKey: z.string().min(1).max(1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  byteCount: z.number().int().positive().max(16 * 1024 * 1024),
}).strict();

/** PDF evidence and, for a conversion, the immutable source artifact it represents. */
export const sourceFileSchema = storedFileSchema.extend({
  rendererImage: z.string().regex(/^sha256:[a-f0-9]{64}$/u).optional(),
  original: storedFileSchema.optional(),
  originals: z.array(storedFileSchema).min(1).max(8).optional(),
  articleNumber: z.string().regex(/^[1-9]\d{0,5}(?:-\d{1,4})?$/u).optional(),
}).strict();

export type SourceFile = z.infer<typeof sourceFileSchema>;
