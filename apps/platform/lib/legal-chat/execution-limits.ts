/** One bounded provider operation; reservations allow its finalization margin. */
export const LEGAL_CHAT_PROVIDER_TIMEOUT_MS = 120_000;
export const LEGAL_CHAT_RESERVATION_TTL_MS = LEGAL_CHAT_PROVIDER_TIMEOUT_MS + 60_000;
export const LEGAL_CHAT_HEARTBEAT_MS = 30_000;
export const LEGAL_CHAT_MAX_RESEARCH_ROUNDS = 1;
// Interpretation, at most two lane formulations, one assessment, a fallback
// draft and independent verification. Combined calls consume fewer operations.
// This stale-work ceiling is not the usable-answer latency target.
export const LEGAL_CHAT_EXECUTION_TIMEOUT_MS = 6 * LEGAL_CHAT_PROVIDER_TIMEOUT_MS + 60_000;
