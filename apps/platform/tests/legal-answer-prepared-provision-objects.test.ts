import assert from "node:assert/strict";
import test from "node:test";
import { createPreparedProvisionObjects } from "../lib/legal-answer-workflow/prepared-provision-objects";

const packageSha256 = "a".repeat(64);
const source = { work: "work:one", title: "Artificial act", gaps: [], tables: [], units: [
  { ordinal: 0, locator: "100", language: "en", hierarchy: [], text: "Article 1. Rule" },
  { ordinal: 1, locator: "101", language: "en", hierarchy: [], text: "A rule and its exception." },
] };
const signal = new AbortController().signal;
const create = (prepared: unknown = source, pin = packageSha256) => createPreparedProvisionObjects({ packageSha256: pin,
  async loadSource(work) { assert.equal(work, "work:one"); return prepared; } });

test("saved prepared provision references reopen the same immutable corpus range without copied objects", async () => {
  const first = create();
  const read = await first.read({ work: "work:one", position: "101", language: "en" }, signal);
  assert.equal(read.text, "Artificial act\n\nArticle 1. Rule\n\nA rule and its exception.");
  const second = create();
  assert.equal(Buffer.from((await second.get(read.objectKey, signal))!).toString(), read.text);
  assert.equal(read.byteCount, Buffer.byteLength(read.text));
});

test("a saved reference stays bound to its retained package", async () => {
  const read = await create().read({ work: "work:one", position: "101", language: "en" }, signal);
  await assert.rejects(create(source, "b".repeat(64)).get(read.objectKey, signal), /PREPARED_PACKAGE_MISMATCH/);
});

test("mixed-language interior matches reopen through the complete range anchor", async () => {
  for (const heading of ["Article 1. Rule", "Chapter A", "Complete document"]) {
    const prepared = { ...source, units: source.units.map((unit, index) => ({ ...unit,
      hierarchy: heading === "Chapter A" ? [heading] : [],
      text: index === 0 ? heading : unit.text, language: index === 0 ? "uz-Cyrl" : "en" })) };
    const read = await create(prepared).read({ work: source.work, position: "101", language: "en" }, signal);
    assert.equal(read.position, "100");
    assert.equal(read.language, "uz-Cyrl");
    assert.equal(Buffer.from(await create(prepared).get(read.objectKey, signal)).toString(), read.text);
    await assert.rejects(create(prepared).read({ work: source.work, position: "101", language: "ru" }, signal), /CORPUS_SOURCE_IDENTITY/);
  }
});

test("whole-document references reopen every unit even when their first position has an article heading", async () => {
  const prepared = { ...source, units: [...source.units,
    { ...source.units[1], ordinal: 2, locator: "102", text: "See «An unclosed title" },
    { ...source.units[0], ordinal: 3, locator: "103", hierarchy: ["Another chapter"], text: "Article 2. Exception" },
    { ...source.units[1], ordinal: 4, locator: "104", hierarchy: ["Another chapter"], text: "The material exception applies." }] };
  const read = await create(prepared).read({ work: "work:one", position: "104", language: "en" }, signal);
  assert.equal(read.articleTitle, null);
  assert.match(read.objectKey, /^legal-evidence\/prepared-document-v1\//);
  assert.equal(Buffer.from((await create(prepared).get(read.objectKey, signal))!).toString(), read.text);
  assert.match(read.text, /Article 1. Rule/);
  assert.match(read.text, /The material exception applies/);
});

test("existing provision keys for unstructured documents retain their original bytes", async () => {
  const prepared = { ...source, units: [{ ...source.units[0], text: "Complete unstructured rule." }] };
  const read = await create(prepared).read({ work: "work:one", position: "100", language: "en" }, signal);
  const oldKey = read.objectKey.replace("prepared-document-v1/", "prepared-provision-v1/");
  assert.equal(Buffer.from((await create(prepared).get(oldKey, signal))!).toString(), "Artificial act\n\nComplete unstructured rule.");
});

test("complete sections have explicit immutable keys while earlier whole-document keys keep their extent", async () => {
  const prepared = { ...source, units: [
    { ...source.units[0], text: "Chapter A", hierarchy: ["Chapter A"] },
    { ...source.units[1], hierarchy: ["Chapter A"] },
    { ...source.units[0], ordinal: 2, locator: "102", text: "Chapter B", hierarchy: ["Chapter B"] },
    { ...source.units[0], ordinal: 3, locator: "103", text: "Article 2. Other rule", hierarchy: ["Chapter B"] },
    { ...source.units[1], ordinal: 4, locator: "104", text: "Other complete qualification.", hierarchy: ["Chapter B"] },
  ] };
  const target = { work: "work:one", position: "101", language: "en" };
  const section = await create(prepared).read(target, signal);
  assert.equal(section.sectionTitle, "Chapter A");
  assert.equal(section.position, "100", "an interior match is cited at the complete container heading");
  assert.match(section.objectKey, /^legal-evidence\/prepared-section-v1\//);
  assert.equal(Buffer.from(await create(prepared).get(section.objectKey, signal)).toString(), section.text);
  assert.ok(!section.text.includes("Chapter B"));
  const whole = await create(prepared).read({ ...target, wholeDocument: true }, signal);
  const legacy = whole.objectKey.replace("prepared-document-v1/", "prepared-provision-v1/");
  assert.equal(Buffer.from(await create(prepared).get(legacy, signal)).toString(), whole.text);
  assert.equal(Buffer.from(await create(prepared).get(whole.objectKey, signal)).toString(), whole.text);
});
