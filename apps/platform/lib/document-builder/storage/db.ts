import type { ChatGPTUser } from "../../../app/chatgpt-auth";
import {
  resolveUserIdentity,
  USER_IDENTITY_SELECT,
  userIdByEmail,
  userIdentityWriteBindings,
  prepareUserIdentityWrite,
  type UserIdentityRow,
} from "../../auth/identity-protection";
import { runtimeIdentityProtection } from "../../auth/identity-runtime";
import { ensureDefaultWorkspace } from "../../platform/workspace";
import type { UserProfile } from "../types";
import type { DocumentDefinition } from "../registry";
import { requireD1 } from "./runtime";

let seeded = false;

export function isoNow(): string {
  return new Date().toISOString();
}

export async function ensureTemplateSeed(): Promise<void> {
  if (seeded) return;
  const db = requireD1();
  const now = isoNow();
  try {
    await db.batch([
      db.prepare(
        "INSERT OR IGNORE INTO document_templates (id, key, category, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      ).bind("receipt-money-v1", "receipt-money", "Займы и расписки", now, now),
      db.prepare(
        "INSERT OR IGNORE INTO document_template_locales (id, template_id, language, name, source_object_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind("receipt-money-v1-ru", "receipt-money-v1", "ru", "Расписка в получении денежных средств", "system/templates/receipt-ru.docx", now, now),
      db.prepare(
        "INSERT OR IGNORE INTO document_template_locales (id, template_id, language, name, source_object_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind("receipt-money-v1-uz-cyrl", "receipt-money-v1", "uz-cyrl", "Пул маблағларини олганлик тўғрисида тилхат", "system/templates/receipt-uz-cyrl.docx", now, now),
    ]);
    seeded = true;
  } catch (error) {
    seeded = false;
    throw error;
  }
}

export async function ensureConfiguredTemplateSeed(definition: DocumentDefinition, database?: D1Database): Promise<void> {
  const db = database ?? requireD1();
  const now = isoNow();
  await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO document_templates (id, key, category, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind(definition.id, definition.code, definition.categorySlug, now, now),
    db.prepare(
      "INSERT OR IGNORE INTO document_template_locales (id, template_id, language, name, source_object_key, created_at, updated_at) VALUES (?, ?, 'ru', ?, NULL, ?, ?)",
    ).bind(`${definition.id}-ru`, definition.id, definition.titleRu, now, now),
    db.prepare(
      "INSERT OR IGNORE INTO document_template_locales (id, template_id, language, name, source_object_key, created_at, updated_at) VALUES (?, ?, 'uz', ?, NULL, ?, ?)",
    ).bind(`${definition.id}-uz`, definition.id, definition.titleUz, now, now),
  ]);
}

export async function getOrCreateUserProfile(user: ChatGPTUser): Promise<UserProfile> {
  const db = requireD1();
  const identityContext = runtimeIdentityProtection();
  const existingId = await userIdByEmail(db, identityContext, user.email);
  const existing = existingId
    ? await db.prepare(
      `SELECT id,${USER_IDENTITY_SELECT},
        full_name AS fullName,birth_date AS birthDate,
        id_document_type AS idDocumentType,
        id_document_number AS idDocumentNumber,
        id_issued_by AS idIssuedBy,id_issue_date AS idIssueDate,
        pinfl,registered_address AS registeredAddress,
        onboarding_completed_at AS onboardingCompletedAt
       FROM user_profiles WHERE id=? LIMIT 1`,
    ).bind(existingId).first<UserProfile & UserIdentityRow & {
      onboardingCompletedAt: string | null;
    }>()
    : null;
  if (existing) {
    const identity = await resolveUserIdentity(identityContext, existing);
    const profile: UserProfile = {
      id: existing.id,
      email: identity.email,
      fullName: existing.fullName,
      birthDate: existing.birthDate,
      idDocumentType: existing.idDocumentType,
      idDocumentNumber: existing.idDocumentNumber,
      idIssuedBy: existing.idIssuedBy,
      idIssueDate: existing.idIssueDate,
      pinfl: existing.pinfl,
      registeredAddress: existing.registeredAddress,
      phone: identity.phone,
    };
    // A name entered in JURO is canonical, even without optional onboarding.
    // Refreshing an auth session must not replace it with the provider label.
    if (
      !existing.fullName?.trim()
      && user.fullName
      && user.fullName !== existing.fullName
    ) {
      await db.prepare("UPDATE user_profiles SET full_name = ?, updated_at = ? WHERE id = ?")
        .bind(user.fullName, isoNow(), existing.id).run();
      await ensureDefaultWorkspace(existing.id);
      return { ...profile, fullName: user.fullName };
    }
    await ensureDefaultWorkspace(existing.id);
    return profile;
  }

  const id = crypto.randomUUID();
  const now = isoNow();
  const identity = await prepareUserIdentityWrite(identityContext, {
    userId: id,
    email: user.email,
    phone: null,
  });
  await db.prepare(
    `INSERT INTO user_profiles (
       id,email,email_ciphertext,email_iv,email_key_version,
       email_lookup_hash,email_lookup_key_version,
       phone,phone_ciphertext,phone_iv,phone_key_version,
       phone_lookup_hash,phone_lookup_key_version,
       full_name,locale,account_type,created_at,updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ru','individual',?,?)`,
  ).bind(
    id,
    ...userIdentityWriteBindings(identity),
    user.fullName,
    now,
    now,
  ).run();
  await ensureDefaultWorkspace(id);
  return {
    id,
    email: identity.email,
    fullName: user.fullName,
    birthDate: null,
    idDocumentType: null,
    idDocumentNumber: null,
    idIssuedBy: null,
    idIssueDate: null,
    pinfl: null,
    registeredAddress: null,
    phone: identity.phone,
  };
}

export async function addActivity(
  documentId: string,
  actorUserId: string | null,
  type: string,
  metadata?: Record<string, string | number | boolean | null>,
): Promise<void> {
  const db = requireD1();
  await db.prepare(
    "INSERT INTO activity_events (id, document_id, actor_user_id, type, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), documentId, actorUserId, type, metadata ? JSON.stringify(metadata) : null, isoNow()).run();
}

export async function addNotification(
  userId: string,
  documentId: string | null,
  type: string,
  title: string,
  body: string,
): Promise<void> {
  const db = requireD1();
  await db.prepare(
    "INSERT INTO notifications (id, workspace_id, user_id, document_id, type, title, body, read_at, created_at) VALUES (?, (SELECT default_workspace_id FROM user_profiles WHERE id = ?), ?, ?, ?, ?, ?, NULL, ?)",
  ).bind(crypto.randomUUID(), userId, userId, documentId, type, title, body, isoNow()).run();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
