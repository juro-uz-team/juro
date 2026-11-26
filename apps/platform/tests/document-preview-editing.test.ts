import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultAnswers } from "../lib/document-builder/defaults";
import { previewWithWording, refreshLinkedWording } from "../lib/document-builder/generation/preview-fields";
import { SALARY_CLAIM } from "../lib/document-builder/registry/pilots";
import { createQuestionnaireAnswers, renderConfiguredDocument } from "../lib/document-builder/registry/engine";
import { renderReceipt } from "../lib/document-builder/templates/receipt";

test("configured preview attaches each identical blank to the actual template field", () => {
  for (const language of ["ru", "uz"] as const) {
    const answers = createQuestionnaireAnswers(SALARY_CLAIM);
    const preview = renderConfiguredDocument(SALARY_CLAIM, answers, language, true);
    assert.equal(preview.plainText, renderConfiguredDocument(SALARY_CLAIM, answers, language).plainText);
    const fields = preview.paragraphs.flatMap(paragraph => paragraph.parts ?? []).filter(part => part.field);
    assert(fields.some(part => part.field?.key === "debt.salaryAmount" && /^_+$/.test(part.text)));
    assert(fields.some(part => part.field?.key === "debt.currency" && /^_+$/.test(part.text)));
    const next = renderConfiguredDocument(SALARY_CLAIM, { ...answers, "debt.salaryAmount": "2150000" }, language, true);
    assert(next.paragraphs.flatMap(paragraph => paragraph.parts ?? []).some(part => part.field?.key === "debt.salaryAmount" && part.text === "2150000"));
  }
});

test("receipt preview links repeating facts without changing exported Russian or Uzbek wording", () => {
  for (const language of ["ru", "uz-cyrl"] as const) {
    const answers = createDefaultAnswers(language, "2026-11-27");
    answers.lender.fullName = "\uE000Applicant";
    answers.repayment.method = "other";
    answers.repayment.otherDetails = "First line\nSecond line.";
    const preview = renderReceipt(answers, true);
    assert.equal(preview.plainText, renderReceipt(answers).plainText);
    const fields = preview.paragraphs.flatMap(paragraph => paragraph.parts ?? []);
    assert(fields.filter(part => part.field?.key === "lender.fullName" && part.text === "\uE000Applicant").length > 1);
    assert(fields.some(part => part.field?.key === "borrower.fullName" && /^_+$/.test(part.text)));
    assert(fields.some(part => part.field?.key === "documentDate" && part.text === "27.11.2026"));
  }
});

test("linked form updates preserve custom paragraphs and skip indistinguishable bindings", () => {
  const answers = createDefaultAnswers("ru", "2026-11-27");
  const before = renderReceipt(answers, true);
  const after = renderReceipt({ ...answers, documentDate: "2026-12-02" }, true);
  const note = "Пункт изменён вручную.";
  const combined = `${before.plainText}\n\n${note}`;
  const refreshed = refreshLinkedWording(combined, before, after);
  assert(refreshed.includes("Дата составления: 02.12.2026"));
  assert.equal(refreshed.match(/Дата подписания: 02\.12\.2026/g)?.length, 2);
  assert(refreshed.endsWith(note));
  const duplicated = `${combined}\n\nДата составления: 27.11.2026`;
  assert.equal(refreshLinkedWording(duplicated, before, after).match(/Дата составления: 27\.11\.2026/g)?.length, 2);
  assert.equal(previewWithWording(before, duplicated).paragraphs.filter(p => p.text === "Дата составления: 27.11.2026" && p.parts).length, 0);
});
