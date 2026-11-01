/** Only fixed operational categories may be persisted; transport messages can contain private data. */
export function answerFailureCode(error: unknown, cancelled: boolean): string {
  if (cancelled) return "REQUEST_CANCELLED";
  if (error instanceof Error && ["PROVIDER_USAGE_UNRECONCILED", "PROVIDER_SPENDING_CAP"].includes(error.message)) {
    return error.message;
  }
  return "LEGAL_ANSWER_FAILED";
}
