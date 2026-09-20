import { searchUserDocumentEvidence, type UserDocumentVectorEnv } from "../document-analysis/user-document-vectors";
import { privateDocumentLocator } from "../document-analysis/private-document-locator";
import type { LegalSourceContext } from "../legal/source-context";

/** Private text is factual context, never an official legal-evidence endpoint. */
export type LegalDocumentContext = {
  kind: "private_document";
  source: LegalSourceContext;
  text: string;
  textSha256: string;
};

export async function readLegalDocumentContext(
  env: UserDocumentVectorEnv,
  input: { workspaceId: string; userId: string; query: string; conversationId?: string | null },
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; now?: Date } = {},
): Promise<LegalDocumentContext[]> {
  options.signal?.throwIfAborted();
  let caseId: string | null = null;
  if (input.conversationId) {
    const conversation = await env.DB.prepare(
      "SELECT case_id AS caseId FROM conversations WHERE id=? AND workspace_id=? AND owner_user_id=?",
    ).bind(input.conversationId, input.workspaceId, input.userId).first<{ caseId: string | null }>();
    if (!conversation) return [];
    caseId = conversation.caseId;
  }
  // The retained reader authenticates membership, ledger ownership, latest
  // document version, vector metadata and the full object checksum.
  const evidence = await searchUserDocumentEvidence(env, { ...input, caseId, limit: 10 }, options);
  const checkedAt = (options.now ?? new Date()).toISOString();
  const contexts: LegalDocumentContext[] = [];
  for (const item of evidence) {
    options.signal?.throwIfAborted();
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(item.snippet)));
    const textSha256 = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    const source: LegalSourceContext = {
      id: item.id, actTitle: item.title, actIdentifier: null, officialUrl: privateDocumentLocator(item.id),
      revisionDate: null, lastCheckedAt: checkedAt, locale: item.language, publishedAt: null,
      sourceType: "internal", status: "unconfirmed", verificationState: "user_supplied", verifiedAt: checkedAt,
      contentSha256: item.sourceHash, documentType: "uploaded_document",
      sourceClass: item.accessScope === "workspace" ? "TENANT_TRUSTED_PRIVATE" : "USER_TRUSTED_PRIVATE",
      spans: [{ id: item.id, article: null, paragraph: item.page === null ? null : String(item.page),
        text: item.snippet, textSha256, quality: "high" }],
    };
    contexts.push({ kind: "private_document", source, text: item.snippet, textSha256 });
  }
  return contexts;
}
