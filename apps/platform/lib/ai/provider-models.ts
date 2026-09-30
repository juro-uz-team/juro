/**
 * Conservative provider fallbacks for missing optional runtime variables.
 *
 * Deployment configuration still takes precedence. Keep this value aligned with
 * the checked-in staging configuration and change it only with provider
 * capability review plus the contract/evaluation suite.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

/** Legal chat routing policy, independent of legacy environment or saved overrides. */
export const OPENAI_FAST_CHAT_MODEL = "gpt-5.6-terra";
export const OPENAI_DEEP_CHAT_MODEL = "gpt-6-luna";

export function openAiChatModel(mode: "fast" | "deep"): string {
  return mode === "deep" ? OPENAI_DEEP_CHAT_MODEL : OPENAI_FAST_CHAT_MODEL;
}
