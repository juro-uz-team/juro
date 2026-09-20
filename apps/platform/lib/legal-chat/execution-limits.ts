/** One bounded provider operation; reservations allow its finalization margin. */
export const LEGAL_CHAT_PROVIDER_TIMEOUT_MS = 900_000;
export const LEGAL_CHAT_RESERVATION_TTL_MS = LEGAL_CHAT_PROVIDER_TIMEOUT_MS + 60_000;
export const LEGAL_CHAT_HEARTBEAT_MS = 30_000;
export const LEGAL_CHAT_MAX_RESEARCH_ROUNDS = 3;
// Interpretation, at most two assessments per research round, and four whole
// answer operations. A heartbeat must not keep a stuck request alive forever.
export const LEGAL_CHAT_EXECUTION_TIMEOUT_MS = (1 + 2 * LEGAL_CHAT_MAX_RESEARCH_ROUNDS + 4)
  * LEGAL_CHAT_PROVIDER_TIMEOUT_MS + 60_000;
