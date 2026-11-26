import assert from "node:assert/strict";
import test from "node:test";
import { DOCUMENT_REGISTRY } from "../lib/document-builder/registry";
import { assertTemplatePlan, templatesOnPlan } from "../lib/document-builder/template-access";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

test("bilingual templates are counted by code and the current publication governs new drafts", async () => {
  const free = templatesOnPlan(DOCUMENT_REGISTRY, "free");
  const starter = templatesOnPlan(DOCUMENT_REGISTRY, "starter");
  assert.equal(free.length, 4);
  assert.equal(new Set(free.map(template => template.code)).size, 4);
  assert(free.every(template => template.languages.includes("ru") && template.languages.includes("uz")));
  const restricted = starter.find(template => !free.some(item => item.code === template.code));
  assert(restricted);
  const receipt = DOCUMENT_REGISTRY.find(template => template.code === "0602001");
  assert(receipt);
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const workspace = "template-workspace";
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO workspaces (id,type,name,created_at,updated_at) VALUES (?,'individual','Free workspace',?,?)").run(workspace, now, now);
    await assertTemplatePlan(receipt.code, "ru", workspace, d1);
    await assertTemplatePlan(receipt.code, "uz", workspace, d1);
    await assert.rejects(assertTemplatePlan(restricted.code, "ru", workspace, d1), { message: "TEMPLATE_PLAN_UNAVAILABLE" });
    sqlite.prepare("INSERT INTO control_template_versions (code,version,definition,published_at) VALUES (?,?,?,?)")
      .run(receipt.code, "control-test", JSON.stringify({ ...receipt, allowedPlans: ["starter"] }), now);
    await assert.rejects(assertTemplatePlan(receipt.code, "uz", workspace, d1), { message: "TEMPLATE_PLAN_UNAVAILABLE" });
  } finally {
    sqlite.close();
  }
});
