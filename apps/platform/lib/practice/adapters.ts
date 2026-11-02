/** These contracts reserve integration points; they do not claim a provider is
 * connected or collect funds or verify signatures. */
export interface PracticePaymentProvider {
  createOperation(input: {
    invoiceId: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ operationId: string; checkoutUrl: string }>;
  getStatus(
    operationId: string,
  ): Promise<{
    status: "pending" | "succeeded" | "failed" | "refunded";
    providerReference: string;
  }>;
  verifyNotification(
    rawBody: Uint8Array,
    headers: Headers,
  ): Promise<{ eventId: string; operationId: string; status: string }>;
}
export interface PracticeSignatureProvider {
  requestSignature(input: {
    versionId: string;
    sha256: string;
    signerUserIds: string[];
    idempotencyKey: string;
  }): Promise<{ operationId: string }>;
  verifyResult(input: {
    operationId: string;
    rawEvidence: Uint8Array;
  }): Promise<{
    valid: boolean;
    signedSha256: string;
    signerIdentity: string;
    verifiedAt: string;
    providerEvidenceId: string;
  }>;
}
