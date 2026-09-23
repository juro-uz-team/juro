import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { getTableName } from "drizzle-orm";
import {
  getTableConfig,
  PgDialect,
  type PgTable,
} from "drizzle-orm/pg-core";

import {
  accountDeletionChallenges,
  aiDocumentPrefillHandoffs,
  authMfaAttemptReservations,
  authMfaChallenges,
  authPendingRegistrations,
  authPasswordAttemptReservations,
  authPasswordRateLimits,
  authSessionHandoffs,
  builderDocumentAnalysisHandoffs,
  emailChangeChallenges,
  guestAiSessions,
  knowledgeBaseArticleVersions,
  orderItems,
  policyDocuments,
  securityEmailJobs,
  securityNotificationJobs,
  subscriptionPlanVersions,
  userPasswordCredentials,
  userProfiles,
} from "../db/schema";

type JournalEntry = {
  idx: number;
  tag: string;
};

type PragmaColumn = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type PragmaForeignKey = {
  from: string;
  table: string;
  to: string;
  on_update: string;
  on_delete: string;
};

type PragmaIndex = {
  name: string;
  origin: string;
  unique: number;
};

type PragmaIndexColumn = {
  name: string;
  seqno: number;
};

const drizzleRoot = new URL("../drizzle/", import.meta.url);
const journal = JSON.parse(
  readFileSync(new URL("meta/_journal.json", drizzleRoot), "utf8"),
) as { entries: JournalEntry[] };

const migratedTables = [
  userPasswordCredentials,
  authPendingRegistrations,
  authPasswordRateLimits,
  authPasswordAttemptReservations,
  authMfaAttemptReservations,
  authSessionHandoffs,
  policyDocuments,
  securityEmailJobs,
  emailChangeChallenges,
  securityNotificationJobs,
  accountDeletionChallenges,
  aiDocumentPrefillHandoffs,
  builderDocumentAnalysisHandoffs,
  guestAiSessions,
  knowledgeBaseArticleVersions,
  subscriptionPlanVersions,
  orderItems,
] as const;

function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function applyMigrationsThrough0154(db: DatabaseSync): void {
  const cutoff = journal.entries.find(
    ({ tag }) => tag === "0154_english_locale_foundation",
  );
  assert.ok(cutoff, "missing 0154_english_locale_foundation journal entry");
  for (const entry of journal.entries.filter(({ idx }) => idx <= cutoff.idx)) {
    const migration = readFileSync(
      new URL(`${entry.tag}.sql`, drizzleRoot),
      "utf8",
    );
    for (const statement of statements(migration)) {
      db.exec(statement);
    }
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeDefault(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const rendered = String(value).trim();
  if (
    (rendered.startsWith("'") && rendered.endsWith("'"))
    || (rendered.startsWith('"') && rendered.endsWith('"'))
  ) {
    return rendered.slice(1, -1);
  }
  return rendered;
}

function declaredColumns(table: PgTable) {
  return getTableConfig(table).columns.map((column) => ({
    name: column.name,
    type: column.getSQLType().toLowerCase().replace(/^bigint$/, "integer"),
    notNull: column.notNull,
    defaultValue: normalizeDefault(column.default),
    primaryKey: column.primary,
  }));
}

function migratedColumns(db: DatabaseSync, tableName: string) {
  const columns = db.prepare(
    `PRAGMA table_info(${quoteIdentifier(tableName)})`,
  ).all() as unknown as PragmaColumn[];
  return columns.map((column) => ({
    name: column.name,
    type: column.type.toLowerCase(),
    notNull: column.notnull === 1,
    defaultValue: normalizeDefault(column.dflt_value),
    primaryKey: column.pk > 0,
  }));
}

function declaredIndexes(table: PgTable) {
  return getTableConfig(table).indexes.map((entry) => {
    assert.ok(entry.config.name, "Indexes must have stable names");
    return ({
    name: entry.config.name,
    unique: entry.config.unique,
    columns: entry.config.columns.map((column) => {
      assert.ok("name" in column, `${entry.config.name} must use named columns`);
      return column.name;
    }),
  }); }).sort((left, right) => left.name.localeCompare(right.name));
}

function migratedIndexes(db: DatabaseSync, tableName: string) {
  const indexes = db.prepare(
    `PRAGMA index_list(${quoteIdentifier(tableName)})`,
  ).all() as unknown as PragmaIndex[];
  return indexes
    .filter(({ origin }) => origin === "c")
    .map((entry) => ({
      name: entry.name,
      unique: entry.unique === 1,
      columns: (db.prepare(
        `PRAGMA index_info(${quoteIdentifier(entry.name)})`,
      ).all() as unknown as PragmaIndexColumn[])
        .sort((left, right) => left.seqno - right.seqno)
        .map(({ name }) => name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function declaredForeignKeys(table: PgTable) {
  return getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      from: reference.columns.map(({ name }) => name).join(","),
      table: getTableName(reference.foreignTable),
      to: reference.foreignColumns.map(({ name }) => name).join(","),
      onUpdate: (foreignKey.onUpdate ?? "no action").toUpperCase(),
      onDelete: (foreignKey.onDelete ?? "no action").toUpperCase(),
    };
  }).sort((left, right) => left.from.localeCompare(right.from));
}

function migratedForeignKeys(db: DatabaseSync, tableName: string) {
  const foreignKeys = db.prepare(
    `PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`,
  ).all() as unknown as PragmaForeignKey[];
  return foreignKeys.map((foreignKey) => ({
    from: foreignKey.from,
    table: foreignKey.table,
    to: foreignKey.to,
    onUpdate: foreignKey.on_update.toUpperCase(),
    onDelete: foreignKey.on_delete.toUpperCase(),
  })).sort((left, right) => left.from.localeCompare(right.from));
}

function declaredCheckNames(table: PgTable): string[] {
  return getTableConfig(table).checks.map(({ name }) => name).sort();
}

function migratedCheckNames(db: DatabaseSync, tableName: string): string[] {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
  ).get(tableName) as { sql: string } | undefined;
  assert.ok(row, `missing migrated table ${tableName}`);
  return [...row.sql.matchAll(
    /CONSTRAINT\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+CHECK/giu,
  )].map((match) => match[1]).sort();
}

function assertColumnParity(
  db: DatabaseSync,
  table: PgTable,
  columnName: string,
): void {
  const tableName = getTableName(table);
  const declared = declaredColumns(table).find(({ name }) => name === columnName);
  const migrated = migratedColumns(db, tableName).find(
    ({ name }) => name === columnName,
  );
  assert.ok(declared, `missing ${tableName}.${columnName} in db/schema.ts`);
  assert.deepEqual(declared, migrated);
}

test("db/schema.ts stays in parity with locale and authentication migrations 0150-0154", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    applyMigrationsThrough0154(db);

    for (const table of migratedTables) {
      const tableName = getTableName(table);
      assert.deepEqual(
        declaredColumns(table),
        migratedColumns(db, tableName),
        `${tableName} column drift`,
      );
      assert.deepEqual(
        declaredIndexes(table),
        migratedIndexes(db, tableName),
        `${tableName} index drift`,
      );
      assert.deepEqual(
        declaredForeignKeys(table),
        migratedForeignKeys(db, tableName),
        `${tableName} foreign-key drift`,
      );
      assert.deepEqual(
        declaredCheckNames(table),
        migratedCheckNames(db, tableName),
        `${tableName} check-constraint drift`,
      );
    }

    assertColumnParity(db, userProfiles, "email_verified_at");
    assertColumnParity(db, authMfaChallenges, "primary_auth_method");

    const dialect = new PgDialect();
    const policyLocaleCheck = getTableConfig(policyDocuments).checks.find(
      ({ name }) => name === "policy_documents_locale_check",
    );
    assert.ok(policyLocaleCheck);
    assert.match(
      dialect.sqlToQuery(policyLocaleCheck.value).sql,
      /IN \('ru','uz','en'\)/u,
    );

    const securityEventCheck = getTableConfig(securityEmailJobs).checks.find(
      ({ name }) => name === "security_email_jobs_event_check",
    );
    const securityContextCheck = getTableConfig(securityEmailJobs).checks.find(
      ({ name }) => name === "security_email_jobs_context_check",
    );
    assert.ok(securityEventCheck);
    assert.ok(securityContextCheck);
    assert.match(
      dialect.sqlToQuery(securityEventCheck.value).sql,
      /password_changed/u,
    );
    assert.match(
      dialect.sqlToQuery(securityContextCheck.value).sql,
      /auth_otp_challenge_id/u,
    );

    assert.deepEqual(
      { ...db.prepare("PRAGMA quick_check").get() },
      { quick_check: "ok" },
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});
