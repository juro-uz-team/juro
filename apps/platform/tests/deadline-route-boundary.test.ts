import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("deadline preview is authenticated, tenant-scoped, deterministic, and read-only", () => {
  const route = source("app/api/platform/cases/[caseId]/steps/[stepId]/deadline/route.ts");
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /requireApiUser\(\)/);
  assert.match(route, /workspaceForUser\(user\)/);
  assert.match(route, /c\.workspace_id=\?/);
  assert.match(route, /calculateDeadline\(parsed\.data\)/);
  assert.match(route, /requiresConfirmation: true/);
  assert.doesNotMatch(route, /\b(?:INSERT|UPDATE|DELETE)\b/);
});

test("confirmed plan writes re-calculate and persist bounded deadline evidence", () => {
  const batchRoute = source("app/api/platform/cases/[caseId]/plan/route.ts");
  const stepRoute = source("app/api/platform/cases/[caseId]/steps/[stepId]/route.ts");
  const tasksRoute = source("app/api/platform/cases/[caseId]/tasks/route.ts");
  for (const route of [batchRoute, stepRoute]) {
    assert.match(route, /calculateDeadline\(/);
    assert.match(route, /DEADLINE_PREVIEW_STALE/);
    assert.match(route, /deadline_evidence_json/);
    assert.match(route, /deadline_confidence/);
    assert.match(route, /workspace\.id/);
  }
  assert.match(tasksRoute, /deadlineEvidenceJson/);
  assert.match(tasksRoute, /deadlineConfidence/);
  assert.match(tasksRoute, /INSERT OR IGNORE INTO tasks[\s\S]*deadline_evidence_json/);
});

test("plan UI separates preview from confirmation and clears evidence on manual edit", () => {
  const client = source("app/_platform/ActionPlanClient.tsx");
  assert.match(client, /steps\/\$\{step\.id\}\/deadline/);
  assert.match(client, /deadlineCalculation: input/);
  assert.match(client, /deadlineCalculation: null/);
  assert.match(client, /Предварительный расчёт/);
  assert.match(client, /сохранится только после подтверждения/);
  assert.match(client, /Дополнительные выходные ещё не подтверждены/);
});
