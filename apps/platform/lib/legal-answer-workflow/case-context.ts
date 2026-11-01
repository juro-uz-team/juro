import { isDeepStrictEqual } from "node:util";
import { listUserMemories } from "../ai/user-memory";
import type { IdentityKeyring } from "../auth/keyring";
import { withinSignal } from "./lifetime";

type Actor = { db: D1Database; workspaceId: string; userId: string; conversationId: string | null };
type Fact = { id: string; statement: string; status: "confirmed" | "rejected"; updatedAt: string };
type MemoryVersion = { id: string; category: string; scope: string; workspaceId: string | null;
  ciphertext: string; iv: string; keyVersion: string; updatedAt: string };
export type CaseContextReceipt = { facts: Fact[]; memories: MemoryVersion[] };
export type CaseContext = { facts: { id: string; statement: string; status: "confirmed" | "rejected" }[];
  memories: { id: string; category: string; statement: string }[] };

async function access(input: Actor & { signal: AbortSignal }) {
  if (!await withinSignal(input.signal, () => input.db.prepare(`SELECT 1 AS allowed FROM workspace_members
    WHERE workspace_id=? AND user_id=? AND status='active' AND (? IS NULL OR EXISTS
      (SELECT 1 FROM conversations WHERE id=? AND workspace_id=? AND owner_user_id=? AND status='active'))`)
    .bind(input.workspaceId, input.userId, input.conversationId, input.conversationId, input.workspaceId, input.userId).first())) {
    throw new Error("CASE_CONTEXT_ACCESS_DENIED");
  }
}

/** Saved preferences and user-confirmed facts are context, never official evidence. */
export async function loadCaseContext(input: Actor & { signal: AbortSignal; keyring?: IdentityKeyring }) {
  await access(input);
  const readMemories = () => withinSignal(input.signal, () => input.db.prepare(`SELECT id,category,scope,workspace_id AS workspaceId,
    ciphertext,iv,key_version AS keyVersion,updated_at AS updatedAt FROM user_memories
    WHERE user_id=? AND status='active' AND (scope='global' OR (scope='workspace' AND workspace_id=?))
    ORDER BY updated_at DESC,id DESC LIMIT 101`).bind(input.userId, input.workspaceId).all<MemoryVersion>());
  const memoryVersions = (await readMemories()).results;
  if (memoryVersions.length > 100) throw new Error("CASE_CONTEXT_LIMIT");
  if (memoryVersions.length && !input.keyring) throw new Error("MEMORY_ENCRYPTION_UNAVAILABLE");
  const memories = memoryVersions.length ? await withinSignal(input.signal, () => listUserMemories({ ...input, keyring: input.keyring! })) : [];
  if (memories.length !== memoryVersions.length || memories.some(memory => !memoryVersions.some(version =>
    version.id === memory.id && version.updatedAt === memory.updatedAt && version.category === memory.category
      && version.scope === memory.scope && version.workspaceId === memory.workspaceId))
    || !isDeepStrictEqual(memoryVersions, (await readMemories()).results)) throw new Error("CASE_CONTEXT_CHANGED");
  const facts = input.conversationId ? (await withinSignal(input.signal, () => input.db.prepare(`SELECT f.id,f.statement,f.status,f.updated_at AS updatedAt
    FROM confirmed_facts f JOIN conversations c ON c.id=f.conversation_id
    WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND c.status='active' AND f.status IN ('confirmed','rejected')
    ORDER BY f.created_at,f.id LIMIT 201`).bind(input.conversationId, input.workspaceId, input.userId).all<Fact>())).results : [];
  if (facts.length > 200) {
    throw new Error("CASE_CONTEXT_LIMIT");
  }
  await access(input);
  return { context: { facts: facts.map(({ id, statement, status }) => ({ id, statement, status })),
    memories: memories.map(({ id, category, statement }) => ({ id, category, statement })) } satisfies CaseContext,
  receipt: { facts, memories: memoryVersions } satisfies CaseContextReceipt };
}

/** Lock only the exact versions used in this answer, inside its publication transaction. */
export function caseContextPublicationStatements(input: Actor & { receipt: CaseContextReceipt }) {
  const { facts, memories } = input.receipt;
  if (facts.length > 200 || memories.length > 100) throw new Error("CASE_CONTEXT_LIMIT");
  const unchanged = (count: number) => input.db.prepare(`SELECT CASE WHEN changes()=? THEN 1
    ELSE json_extract('CASE_CONTEXT_CHANGED','$') END AS unchanged`).bind(count);
  const statements: D1PreparedStatement[] = [];
  if (facts.length) {
    statements.push(input.db.prepare(`UPDATE confirmed_facts SET id=id WHERE conversation_id=?
      AND EXISTS (SELECT 1 FROM conversations WHERE id=? AND workspace_id=? AND owner_user_id=? AND status='active')
      AND (${facts.map(() => "(id=? AND statement=? AND status=? AND updated_at=?)").join(" OR ")})`)
      .bind(input.conversationId, input.conversationId, input.workspaceId, input.userId,
        ...facts.flatMap(fact => [fact.id, fact.statement, fact.status, fact.updatedAt])), unchanged(facts.length));
  }
  if (memories.length) {
    statements.push(input.db.prepare(`UPDATE user_memories SET id=id WHERE user_id=? AND status='active'
      AND (scope='global' OR (scope='workspace' AND workspace_id=?))
      AND (${memories.map(() => "(id=? AND category=? AND scope=? AND ciphertext=? AND iv=? AND key_version=? AND updated_at=?)").join(" OR ")})`)
      .bind(input.userId, input.workspaceId, ...memories.flatMap(memory => [memory.id, memory.category, memory.scope,
        memory.ciphertext, memory.iv, memory.keyVersion, memory.updatedAt])), unchanged(memories.length));
  }
  return statements;
}
