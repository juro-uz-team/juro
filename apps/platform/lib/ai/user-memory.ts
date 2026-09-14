import { z } from "zod";

import {
  parseIdentityKeyring,
  protectIdentityValue,
  revealIdentityValue,
  type IdentityKeyring,
} from "../auth/keyring";
import { sha256Json } from "./run-store";
import type { AiOutputLocale } from "./localization";

function isoNow(): string {
  return new Date().toISOString();
}

export const USER_MEMORY_SOFT_DELETE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const USER_MEMORY_PURGE_BATCH_SIZE = 100;

export const memoryCategories = [
  "profile_name",
  "language",
  "company",
  "answer_style",
  "user_instruction",
  "counterparty",
  "legal_context",
  "typical_requisite",
] as const;

export const memoryCategorySchema = z.enum(memoryCategories);
export type MemoryCategory = z.infer<typeof memoryCategorySchema>;
export type MemoryScope = "global" | "workspace";

export const memoryStatementSchema = z.string().trim().min(2).max(500);

export type UserMemory = {
  id: string;
  category: MemoryCategory;
  statement: string;
  scope: MemoryScope;
  workspaceId: string | null;
  sourceKind: "manual" | "automatic" | "profile";
  source: {
    type: "manual" | "chat" | "profile";
    conversationId: string | null;
    messageId: string | null;
    savedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export class UserMemoryError extends Error {
  constructor(
    readonly code:
      | "MEMORY_INVALID"
      | "MEMORY_NOT_FOUND"
      | "MEMORY_ACCESS_DENIED"
      | "MEMORY_CREDENTIAL_FORBIDDEN"
      | "MEMORY_SENSITIVE_CONFIRMATION_REQUIRED"
      | "MEMORY_ENCRYPTION_UNAVAILABLE"
      | "MEMORY_DUPLICATE",
  ) {
    super(code);
    this.name = "UserMemoryError";
  }
}

type MemoryRow = {
  id: string;
  category: string;
  scope: string;
  workspaceId: string | null;
  ciphertext: string;
  iv: string;
  keyVersion: string;
  sourceKind: string;
  createdAt: string;
  updatedAt: string;
  sourceType: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  sourceCreatedAt: string | null;
};

export type MemoryCandidate = {
  category: MemoryCategory;
  statement: string;
  scope: MemoryScope;
};

const CREDENTIAL_PATTERNS = [
  /(?:password|passcode|парол[ья]|otp|totp|cvv|cvc)/iu,
  /(?:код(?:а)?\s+(?:из|от)\s+(?:смс|sms|email|почт)|sms\s*code|verification\s*code)/iu,
  /(?:pin[-\s]?code|пин[-\s]?код|banking\s+access|банковск\w*\s+доступ)/iu,
  /\b(?:\d[ -]?){13,19}\b/u,
];

const HIGH_SENSITIVITY_PATTERNS = [
  /(?:паспорт|passport|pinfl|пинфл|жшш[иir]|id\s*document)/iu,
  /(?:диагноз|лечение|болезн|medical|health|sog['‘’ʻʼ]?liq)\w*/iu,
  /(?:уголовн|преступлен|обвинен|criminal|jinoyat|ayblov)\w*/iu,
  /(?:интимн|сексуальн|насили|самоубий|self[-\s]?harm|zo['‘’ʻʼ]?ravonlik)\w*/iu,
  /(?:развод|алименты|опек|усынов|family\s+secret|oilaviy\s+sir)\w*/iu,
  /(?:bank\s+account|расч[её]тн\w*\s+сч[её]т|корреспондентск\w*\s+сч[её]т)/iu,
];

export function classifyMemorySensitivity(statement: string): "none" | "high" | "credential" {
  const normalized = statement.normalize("NFKC");
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(normalized))) return "credential";
  if (HIGH_SENSITIVITY_PATTERNS.some((pattern) => pattern.test(normalized))) return "high";
  return "none";
}

function compactStatement(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 500);
}

function capture(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  const value = match?.[1]
    ? compactStatement(match[1]).replace(/[.!?]+$/u, "").trim()
    : "";
  return value.length >= 2 ? value : null;
}

export function memoryKeyring(raw: string | null | undefined): IdentityKeyring {
  try {
    return parseIdentityKeyring(raw);
  } catch {
    throw new UserMemoryError("MEMORY_ENCRYPTION_UNAVAILABLE");
  }
}

function memoryContext(userId: string, memoryId: string) {
  return { purpose: "user-memory-statement-v1", subjectId: userId, recordId: memoryId };
}

function scopeIdentity(scope: MemoryScope, workspaceId: string): { scopeKey: string; storedWorkspaceId: string | null } {
  return scope === "workspace"
    ? { scopeKey: `workspace:${workspaceId}`, storedWorkspaceId: workspaceId }
    : { scopeKey: "global", storedWorkspaceId: null };
}

async function statementHash(statement: string): Promise<string> {
  return sha256Json(compactStatement(statement).toLocaleLowerCase());
}

function validateStatement(statement: string, confirmSensitive: boolean): string {
  const parsed = memoryStatementSchema.safeParse(statement);
  if (!parsed.success) throw new UserMemoryError("MEMORY_INVALID");
  const compact = compactStatement(parsed.data);
  const sensitivity = classifyMemorySensitivity(compact);
  if (sensitivity === "credential") throw new UserMemoryError("MEMORY_CREDENTIAL_FORBIDDEN");
  if (sensitivity === "high" && !confirmSensitive) {
    throw new UserMemoryError("MEMORY_SENSITIVE_CONFIRMATION_REQUIRED");
  }
  return compact;
}

export async function memorySettings(db: D1Database, userId: string): Promise<{ automaticEnabled: boolean }> {
  const row = await db.prepare("SELECT automatic_enabled AS automaticEnabled FROM user_memory_settings WHERE user_id=?")
    .bind(userId).first<{ automaticEnabled: number | boolean }>();
  return { automaticEnabled: row ? Boolean(row.automaticEnabled) : true };
}

export async function setAutomaticMemory(
  db: D1Database,
  userId: string,
  workspaceId: string,
  enabled: boolean,
): Promise<void> {
  const now = isoNow();
  await db.batch([
    db.prepare(`
      INSERT INTO user_memory_settings (user_id,automatic_enabled,created_at,updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET automatic_enabled=excluded.automatic_enabled,updated_at=excluded.updated_at
    `).bind(userId, enabled ? 1 : 0, now, now),
    db.prepare(`
      INSERT INTO workspace_audit_events (
        id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at
      ) VALUES (?,?,?,'user_memory_settings',?,'user_memory_settings_updated',?,?)
    `).bind(crypto.randomUUID(), workspaceId, userId, userId, JSON.stringify({ automaticEnabled: enabled }), now),
  ]);
}

export async function listUserMemories(input: {
  db: D1Database;
  keyring: IdentityKeyring;
  userId: string;
  workspaceId: string;
}): Promise<UserMemory[]> {
  const rows = await input.db.prepare(`
    SELECT m.id,m.category,m.scope,m.workspace_id AS workspaceId,m.ciphertext,m.iv,
      m.key_version AS keyVersion,m.source_kind AS sourceKind,m.created_at AS createdAt,
      m.updated_at AS updatedAt,s.source_type AS sourceType,
      s.conversation_id AS sourceConversationId,s.message_id AS sourceMessageId,
      s.created_at AS sourceCreatedAt
    FROM user_memories m
    LEFT JOIN memory_sources s ON s.id=(
      SELECT source.id FROM memory_sources source WHERE source.memory_id=m.id
      ORDER BY source.created_at DESC,source.id DESC LIMIT 1
    )
    WHERE m.user_id=? AND m.status='active'
      AND (m.scope='global' OR (m.scope='workspace' AND m.workspace_id=?))
    ORDER BY m.updated_at DESC,m.id DESC
    LIMIT 100
  `).bind(input.userId, input.workspaceId).all<MemoryRow>();
  return Promise.all(rows.results.map(async (row) => {
    const category = memoryCategorySchema.safeParse(row.category);
    if (!category.success || (row.scope !== "global" && row.scope !== "workspace")) {
      throw new UserMemoryError("MEMORY_INVALID");
    }
    const statement = await revealIdentityValue(input.keyring, {
      ciphertext: row.ciphertext,
      iv: row.iv,
      keyVersion: row.keyVersion,
    }, memoryContext(input.userId, row.id)).catch(() => {
      throw new UserMemoryError("MEMORY_ENCRYPTION_UNAVAILABLE");
    });
    const valid = memoryStatementSchema.safeParse(statement);
    if (!valid.success) throw new UserMemoryError("MEMORY_INVALID");
    return {
      id: row.id,
      category: category.data,
      statement: valid.data,
      scope: row.scope as MemoryScope,
      workspaceId: row.workspaceId,
      sourceKind: row.sourceKind as UserMemory["sourceKind"],
      source: row.sourceType ? {
        type: row.sourceType as NonNullable<UserMemory["source"]>["type"],
        conversationId: row.sourceConversationId,
        messageId: row.sourceMessageId,
        savedAt: row.sourceCreatedAt!,
      } : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }));
}

export async function saveUserMemory(input: {
  db: D1Database;
  keyring: IdentityKeyring;
  userId: string;
  workspaceId: string;
  category: MemoryCategory;
  statement: string;
  scope: MemoryScope;
  sourceKind: "manual" | "automatic" | "profile";
  sourceType: "manual" | "chat" | "profile";
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
  sourceRef?: string | null;
  confirmSensitive?: boolean;
}): Promise<{ id: string; created: boolean }> {
  const category = memoryCategorySchema.safeParse(input.category);
  if (!category.success) throw new UserMemoryError("MEMORY_INVALID");
  const statement = validateStatement(input.statement, Boolean(input.confirmSensitive));
  const hash = await statementHash(statement);
  const { scopeKey, storedWorkspaceId } = scopeIdentity(input.scope, input.workspaceId);
  const existing = await input.db.prepare(`
    SELECT id,status FROM user_memories
    WHERE user_id=? AND scope_key=? AND content_sha256=?
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END LIMIT 1
  `).bind(input.userId, scopeKey, hash).first<{ id: string; status: string }>();
  if (existing?.status === "active") return { id: existing.id, created: false };
  const id = existing?.id ?? crypto.randomUUID();
  const protectedValue = await protectIdentityValue(
    input.keyring,
    statement,
    memoryContext(input.userId, id),
  );
  const now = isoNow();
  const sourceId = crypto.randomUUID();
  const memoryStatement = existing
    ? input.db.prepare(`
        UPDATE user_memories SET workspace_id=?,scope=?,scope_key=?,category=?,ciphertext=?,iv=?,
          key_version=?,source_kind=?,status='active',deleted_at=NULL,updated_at=?
        WHERE id=? AND user_id=? AND status='deleted'
      `).bind(
        storedWorkspaceId, input.scope, scopeKey, category.data, protectedValue.ciphertext,
        protectedValue.iv, protectedValue.keyVersion, input.sourceKind, now, id, input.userId,
      )
    : input.db.prepare(`
        INSERT INTO user_memories (
          id,user_id,workspace_id,scope,scope_key,category,ciphertext,iv,key_version,
          content_sha256,source_kind,status,deleted_at,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',NULL,?,?)
      `).bind(
        id, input.userId, storedWorkspaceId, input.scope, scopeKey, category.data,
        protectedValue.ciphertext, protectedValue.iv, protectedValue.keyVersion,
        hash, input.sourceKind, now, now,
      );
  await input.db.batch([
    memoryStatement,
    input.db.prepare(`
      INSERT INTO memory_sources (
        id,memory_id,conversation_id,message_id,source_type,source_ref,created_at
      ) VALUES (?,?,?,?,?,?,?)
    `).bind(
      sourceId, id, input.sourceConversationId ?? null, input.sourceMessageId ?? null,
      input.sourceType, input.sourceRef ?? null, now,
    ),
    input.db.prepare(`
      INSERT INTO workspace_audit_events (
        id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at
      ) VALUES (?,?,?,'user_memory',?,'user_memory_saved',?,?)
    `).bind(crypto.randomUUID(), input.workspaceId, input.userId, id, JSON.stringify({
      category: category.data,
      scope: input.scope,
      sourceKind: input.sourceKind,
      restored: Boolean(existing),
    }), now),
  ]);
  return { id, created: !existing };
}

async function accessibleMemoryRow(
  db: D1Database,
  memoryId: string,
  userId: string,
  workspaceId: string,
): Promise<{ id: string; scope: MemoryScope } | null> {
  return db.prepare(`
    SELECT id,scope FROM user_memories
    WHERE id=? AND user_id=? AND status='active'
      AND (scope='global' OR (scope='workspace' AND workspace_id=?))
    LIMIT 1
  `).bind(memoryId, userId, workspaceId).first<{ id: string; scope: MemoryScope }>();
}

export async function updateUserMemory(input: {
  db: D1Database;
  keyring: IdentityKeyring;
  memoryId: string;
  userId: string;
  workspaceId: string;
  category: MemoryCategory;
  statement: string;
  confirmSensitive?: boolean;
}): Promise<void> {
  const existing = await accessibleMemoryRow(input.db, input.memoryId, input.userId, input.workspaceId);
  if (!existing) throw new UserMemoryError("MEMORY_NOT_FOUND");
  const category = memoryCategorySchema.safeParse(input.category);
  if (!category.success) throw new UserMemoryError("MEMORY_INVALID");
  const statement = validateStatement(input.statement, Boolean(input.confirmSensitive));
  const hash = await statementHash(statement);
  const protectedValue = await protectIdentityValue(
    input.keyring,
    statement,
    memoryContext(input.userId, input.memoryId),
  );
  const now = isoNow();
  try {
    const [result] = await input.db.batch([
      input.db.prepare(`
        UPDATE user_memories SET category=?,ciphertext=?,iv=?,key_version=?,content_sha256=?,
          source_kind='manual',updated_at=?
        WHERE id=? AND user_id=? AND status='active'
      `).bind(
        category.data, protectedValue.ciphertext, protectedValue.iv, protectedValue.keyVersion,
        hash, now, input.memoryId, input.userId,
      ),
      input.db.prepare(`
        INSERT INTO workspace_audit_events (
          id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at
        ) VALUES (?,?,?,'user_memory',?,'user_memory_updated',?,?)
      `).bind(crypto.randomUUID(), input.workspaceId, input.userId, input.memoryId, JSON.stringify({
        category: category.data,
        scope: existing.scope,
      }), now),
    ]);
    if (Number(result.meta.changes ?? 0) !== 1) throw new UserMemoryError("MEMORY_NOT_FOUND");
  } catch (error) {
    if (error instanceof UserMemoryError) throw error;
    if (String(error).includes("UNIQUE")) throw new UserMemoryError("MEMORY_DUPLICATE");
    throw error;
  }
}

export async function deleteUserMemory(input: {
  db: D1Database;
  memoryId: string;
  userId: string;
  workspaceId: string;
}): Promise<void> {
  if (!await accessibleMemoryRow(input.db, input.memoryId, input.userId, input.workspaceId)) {
    throw new UserMemoryError("MEMORY_NOT_FOUND");
  }
  const now = isoNow();
  const [result] = await input.db.batch([
    input.db.prepare(`
      UPDATE user_memories SET status='deleted',deleted_at=?,updated_at=?
      WHERE id=? AND user_id=? AND status='active'
    `).bind(now, now, input.memoryId, input.userId),
    input.db.prepare(`
      INSERT INTO workspace_audit_events (
        id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at
      ) VALUES (?,?,?,'user_memory',?,'user_memory_deleted',?,?)
    `).bind(crypto.randomUUID(), input.workspaceId, input.userId, input.memoryId, JSON.stringify({ scope: "user_requested" }), now),
  ]);
  if (Number(result.meta.changes ?? 0) !== 1) throw new UserMemoryError("MEMORY_NOT_FOUND");
}

export async function clearUserMemories(input: {
  db: D1Database;
  userId: string;
  workspaceId: string;
}): Promise<number> {
  const now = isoNow();
  const [result] = await input.db.batch([
    input.db.prepare(`
      UPDATE user_memories SET status='deleted',deleted_at=?,updated_at=?
      WHERE user_id=? AND status='active'
        AND (scope='global' OR (scope='workspace' AND workspace_id=?))
    `).bind(now, now, input.userId, input.workspaceId),
    input.db.prepare(`
      INSERT INTO workspace_audit_events (
        id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at
      ) VALUES (?,?,?,'user_memory',NULL,'user_memory_cleared',?,?)
    `).bind(crypto.randomUUID(), input.workspaceId, input.userId, JSON.stringify({ scope: "accessible" }), now),
  ]);
  return Number(result.meta.changes ?? 0);
}

/**
 * Permanently removes only memory rows that have remained soft-deleted for the
 * policy window. The sqlite_master guard keeps an application deploy compatible
 * with an environment where additive migration 0062 has not been applied yet.
 */
export async function purgeDueDeletedUserMemories(input: {
  db: D1Database;
  now?: string;
  limit?: number;
}): Promise<{ eligible: number; purged: number }> {
  const now = input.now ?? isoNow();
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new TypeError("MEMORY_RETENTION_CLOCK_INVALID");
  const requestedLimit = input.limit ?? USER_MEMORY_PURGE_BATCH_SIZE;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(USER_MEMORY_PURGE_BATCH_SIZE, Math.max(1, Math.trunc(requestedLimit)))
    : USER_MEMORY_PURGE_BATCH_SIZE;
  const table = await input.db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='user_memories'",
  ).first<{ present: number }>();
  if (!table) return { eligible: 0, purged: 0 };

  const cutoff = new Date(nowMs - USER_MEMORY_SOFT_DELETE_RETENTION_MS).toISOString();
  const due = await input.db.prepare(`
    SELECT id FROM user_memories
    WHERE status='deleted' AND deleted_at IS NOT NULL AND deleted_at<=?
    ORDER BY deleted_at ASC,id ASC
    LIMIT ?
  `).bind(cutoff, limit).all<{ id: string }>();
  if (due.results.length === 0) return { eligible: 0, purged: 0 };

  const results = await input.db.batch(due.results.map(({ id }) => input.db.prepare(`
    DELETE FROM user_memories
    WHERE id=? AND status='deleted' AND deleted_at IS NOT NULL AND deleted_at<=?
  `).bind(id, cutoff)));
  return {
    eligible: due.results.length,
    purged: results.reduce((total, result) => total + Number(result.meta.changes ?? 0), 0),
  };
}
