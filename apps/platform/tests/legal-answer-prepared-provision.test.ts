import assert from "node:assert/strict";
import test from "node:test";
import { createPreparedProvisionReader, readPreparedProvision } from "../lib/legal-answer-workflow/prepared-provision";

const unit = (ordinal: number, text: string) => ({ ordinal, locator: String(100 + ordinal), text,
  language: "en", hierarchy: ["Chapter 1. Artificial rules"] });
const prepared = { work: "work:one", title: "Artificial Act", gaps: [], tables: [],
  units: [unit(0, "Article 1. Ordinary rule"), unit(1, "The ordinary rule applies."),
    unit(2, "Exception: written consent is required for private events."),
    unit(3, "Article 2. Another rule"), unit(4, "An unrelated rule.")] };

test("annex context exposes exact preceding labels without changing inherited ranges or citation text", () => {
  const chapter = "Chapter 2. General benefit";
  const local = "Chapter 2. Payment procedure";
  const source = { ...prepared, units: [
    { ...unit(0, chapter), hierarchy: [chapter] },
    { ...unit(1, "General benefit rule."), hierarchy: [chapter] },
    { ...unit(2, "ANNEX 2 to the artificial decision"), hierarchy: [chapter] },
    { ...unit(3, "Rules for a different group of recipients"), hierarchy: [chapter] },
    { ...unit(4, "Chapter 1. Scope"), hierarchy: [chapter, "Chapter 1. Scope"] },
    { ...unit(5, "Only the stated recipients are covered."), hierarchy: [chapter, "Chapter 1. Scope"] },
    { ...unit(6, local), hierarchy: [chapter, local] },
    { ...unit(7, "Payment procedure."), hierarchy: [chapter, local] },
  ] };
  const before = structuredClone(source), read = createPreparedProvisionReader(source);
  const narrow = read({ work: source.work, position: "106", language: "en", wholeSection: true });
  assert.deepEqual(narrow.ordinals, [6, 7]);
  assert.equal(narrow.text, [source.title, local, "Payment procedure."].join("\n\n"));
  assert.deepEqual(narrow.sourceStructure.annexContext, [{ relation: "preceding", units: [
    { position: "102", ordinal: 2, language: "en", text: source.units[2].text },
    { position: "103", ordinal: 3, language: "en", text: source.units[3].text },
  ] }]);
  const broad = read({ work: source.work, position: "100", language: "en", wholeSection: true });
  assert.deepEqual(broad.ordinals, source.units.map(u => u.ordinal));
  assert.equal(broad.sourceStructure.annexContext![0].relation, "within");
  assert.deepEqual(read.describe({ work: source.work, position: "106", language: "en", wholeSection: true }).annexContext,
    narrow.sourceStructure.annexContext);
  assert.deepEqual(source, before);
});

test("annex navigation separates markers, ignores quoted markers, and keeps unknown preface extent conservative", () => {
  for (const marker of ["ПРИЛОЖЕНИЕ № 3", "3-ILOVA", "3-ИЛОВА", "APPENDIX B"]) {
    const chapter = "Chapter 1. Local scope";
    const source = { ...prepared, units: [
      { ...unit(0, "An opening quotation: «"), hierarchy: [] },
      { ...unit(1, "ANNEX 9"), hierarchy: [] },
      { ...unit(2, "Quoted material ends.»"), hierarchy: [] },
      { ...unit(3, marker), hierarchy: [] },
      { ...unit(4, "First instrument title"), hierarchy: [] },
      { ...unit(5, chapter), hierarchy: [chapter] },
      { ...unit(6, "First scope rule."), hierarchy: [chapter] },
      { ...unit(7, "ANNEX 4"), hierarchy: [chapter] },
      { ...unit(8, "Unstructured body with no known preface boundary."), hierarchy: [chapter] },
    ] };
    const read = createPreparedProvisionReader(source);
    const context = read({ work: source.work, position: "100", language: "en", wholeDocument: true }).sourceStructure.annexContext!;
    assert.deepEqual(context.map(item => item.units.map(u => u.ordinal)), [[3, 4], [7]]);
    assert.deepEqual(context.map(item => item.relation), ["within", "within"]);
    context[0].units[0].text = "mutated";
    assert.equal(read({ work: source.work, position: "100", language: "en", wholeDocument: true })
      .sourceStructure.annexContext![0].units[0].text, marker);
  }
});

test("first article navigation stays inside a complete enclosing section", () => {
  const source = { ...prepared, units: [unit(0, "Chapter 1. Artificial rules"),
    unit(1, "Article 1. Scope"), unit(2, "Only the stated participants are covered."),
    unit(3, "Article 2. Procedure"), unit(4, "Procedure text.")] };
  const target = { work: source.work, position: "104", language: "en" };
  const read = createPreparedProvisionReader(source);
  assert.equal(read.firstArticle(target), "101");
  assert.deepEqual(read({ ...target, position: read.firstArticle(target)! }).ordinals, [1, 2]);
  assert.equal(read.firstArticle({ ...target, position: "102" }), null);
  assert.equal(read.firstArticle({ ...target, position: "100" }), null);
  assert.equal(createPreparedProvisionReader(prepared).firstArticle(target), null);
  source.units[1].language = "ru";
  assert.equal(createPreparedProvisionReader(source).firstArticle(target), null);
  source.units[1].language = "en";
  source.units[2].locator = "101";
  assert.equal(createPreparedProvisionReader(source).firstArticle(target), null);
});

test("stored containers retain ordered local headings without inferring shared applicability", () => {
  const parent = "Chapter A. First benefit";
  const later = "Chapter B. Different benefit";
  const appendix = "Appendix. Another instrument";
  const repeated = "Chapter A. First benefit";
  const source = { ...prepared, units: [
    { ...unit(0, parent), hierarchy: [parent] },
    { ...unit(1, "First benefit conditions."), hierarchy: [parent] },
    { ...unit(2, later), hierarchy: [parent, later] },
    { ...unit(3, "Different eligibility and process."), hierarchy: [parent, later] },
    { ...unit(4, appendix), hierarchy: [parent, appendix] },
    { ...unit(5, repeated), hierarchy: [parent, appendix, repeated], language: "ru" },
    { ...unit(6, "Other instrument's rule."), hierarchy: [parent, appendix, repeated], language: "ru" },
  ] };
  const read = readPreparedProvision(source, { work: source.work, position: "101", language: "en", wholeDocument: true });
  assert.equal(read.sourceStructure.navigationOnly, true);
  assert.equal(read.sourceStructure.rangeKind, "document");
  assert.deepEqual(read.sourceStructure.anchor, { position: "100", ordinal: 0, language: "en" });
  assert.deepEqual(read.sourceStructure, readPreparedProvision(source,
    { work: source.work, position: "103", language: "en", wholeDocument: true }).sourceStructure);
  assert.deepEqual(read.sourceStructure.headings.map(heading => [heading.position, heading.text]),
    [["100", parent], ["102", later], ["104", appendix], ["105", repeated]]);
  assert.equal(read.sourceStructure.headings[3].language, "ru");
  assert.equal(read.text, [source.title, ...source.units.map(item => item.text)].join("\n\n"));
});

test("a reusable source reader preserves complete ranges and isolates returned arrays", () => {
  const source = structuredClone(prepared);
  const read = createPreparedProvisionReader(source);
  for (const item of source.units) {
    const target = { work: source.work, position: item.locator, language: "en" };
    const result = read(target);
    assert.deepEqual(result, readPreparedProvision(source, target));
    result.ordinals.length = 0;
    assert.deepEqual(read(target), readPreparedProvision(source, target));
  }
  source.units[1].text = "Changed after reader creation";
  assert.match(read({ work: source.work, position: "101", language: "en" }).text, /The ordinary rule applies/);
  assert.throws(() => read({ work: "another-work", position: "101", language: "en" }), /CORPUS_SOURCE_IDENTITY/);
  assert.throws(() => read({ work: source.work, position: "101", language: "ru" }), /CORPUS_SOURCE_IDENTITY/);
});

test("navigation describes complete ranges without exposing text and preserves selected-table failures", () => {
  const read = createPreparedProvisionReader({ ...prepared,
    tables: [{ locator: "104", rows: [[{ text: "Invalid table", rowspan: 0 }]] }] });
  const target = { work: prepared.work, position: "102", language: "en" };
  const description = read.describe(target);
  assert.deepEqual(description, { title: "Artificial Act", articleTitle: "Article 1. Ordinary rule",
    sectionTitle: null, position: "100", language: "en", ordinals: [0, 1, 2],
    textByteCount: Buffer.byteLength(read(target).text), unitCount: 3 });
  description.ordinals.length = 0;
  assert.deepEqual(read.describe(target).ordinals, [0, 1, 2]);
  assert.match(read(target).text, /written consent/);
  for (const describe of [read.describe, read]) {
    assert.throws(() => describe({ ...target, position: "104" }), /PREPARED_TABLE_SPAN_INVALID/);
    assert.throws(() => describe({ ...target, wholeDocument: true }), /PREPARED_TABLE_SPAN_INVALID/);
    assert.throws(() => describe({ ...target, language: "ru" }), /CORPUS_SOURCE_IDENTITY/);
  }
});

test("ambiguous article boundaries return the complete stored document without repairing quotation punctuation", () => {
  const source = { ...prepared, header: ["Captured status"], notices: ["Commencement notice"],
    units: [unit(0, "Article 1. Introduction"), unit(1, "See the instrument «Unclosed cited title"),
      { ...unit(2, "Article 2. Material rule"), hierarchy: ["Chapter 2"] },
      { ...unit(3, "An exception applies."), hierarchy: ["Chapter 2"] }] };
  const read = readPreparedProvision(source, { work: "work:one", position: "103", language: "en" });
  assert.equal(read.articleTitle, null);
  assert.deepEqual(read.ordinals, [0, 1, 2, 3]);
  assert.equal(read.text, "Artificial Act\n\nCaptured status\n\nCommencement notice\n\nArticle 1. Introduction\n\nSee the instrument «Unclosed cited title\n\nArticle 2. Material rule\n\nAn exception applies.");
});

test("quoted replacement headings retain their introducing amendment context", () => {
  const source = { ...prepared, units: [unit(0, "Replace Articles 8 and 9 with the following:"),
    unit(1, "«Article 8. First replacement"), unit(2, "First replacement rule."),
    unit(3, "Article 9. Second replacement"), unit(4, "Second replacement rule.»"),
    unit(5, "The amendment takes effect next month.")] };
  const read = readPreparedProvision(source, { work: "work:one", position: "103", language: "en" });
  assert.equal(read.articleTitle, null);
  assert.match(read.text, /Replace Articles 8 and 9/);
  assert.match(read.text, /takes effect next month/);
  assert.deepEqual(read.ordinals, [0, 1, 2, 3, 4, 5]);
});

test("quoted headings cannot split their containing article and unresolved quotations retain the whole document", () => {
  const source = { ...prepared, units: [unit(0, "Article 1. Amendment"), unit(1, "Replace the text:"),
    unit(2, "“Article 8. First replacement"), unit(3, "Article 9. Second replacement"),
    unit(4, "Replacement qualification.”"), unit(5, "Article 2. Commencement")] };
  const read = readPreparedProvision(source, { work: "work:one", position: "103", language: "en" });
  assert.equal(read.articleTitle, "Article 1. Amendment");
  assert.deepEqual(read.ordinals, [0, 1, 2, 3, 4]);
  const unresolved = readPreparedProvision({ ...source, units: source.units.slice(0, 4) },
    { work: "work:one", position: "103", language: "en" });
  assert.equal(unresolved.articleTitle, null);
  assert.deepEqual(unresolved.ordinals, [0, 1, 2, 3]);
});

test("stored publisher status and notices accompany every article range", () => {
  const read = readPreparedProvision({ ...prepared, header: ["Act repealed on the recorded date."],
    notices: ["This retained version is no longer in force."] }, { work: "work:one", position: "101", language: "en" });
  assert.match(read.text, /Act repealed on the recorded date/);
  assert.match(read.text, /no longer in force/);
  assert.match(read.text, /Exception: written consent/);
});

test("prepared provision reads include the complete stored article around a matching fragment", () => {
  const read = readPreparedProvision(prepared, { work: "work:one", position: "101", language: "en" });
  assert.equal(read.text, "Artificial Act\n\nArticle 1. Ordinary rule\n\nThe ordinary rule applies.\n\nException: written consent is required for private events.");
  assert.equal(read.articleTitle, "Article 1. Ordinary rule");
  assert.deepEqual(read.ordinals, [0, 1, 2]);
  assert.equal(read.position, "100");
});

test("stored document without article structure is read completely", () => {
  const document = { ...prepared, units: [unit(0, "A rule."), unit(1, "Its qualification.")] };
  const read = readPreparedProvision(document, { work: "work:one", position: "101", language: "en" });
  assert.equal(read.text, "Artificial Act\n\nA rule.\n\nIts qualification.");
  assert.equal(read.articleTitle, null);
});

test("missing or ambiguous stored positions cannot become provision evidence", () => {
  assert.throws(() => readPreparedProvision(prepared, { work: "work:one", position: "999", language: "en" }), /PREPARED_POSITION_UNAVAILABLE/);
  assert.throws(() => readPreparedProvision({ ...prepared, units: [...prepared.units, unit(1, "Duplicate position")] },
    { work: "work:one", position: "101", language: "en" }), /PREPARED_UNIT_ORDER/);
});

test("stored extraction gaps and unlocated tables remain explicit evidence gaps", () => {
  const target = { work: "work:one", position: "101", language: "en" };
  assert.throws(() => readPreparedProvision({ ...prepared, gaps: [{ reason: "missing text" }] }, target), /PREPARED_EXTRACTION_GAP/);
  assert.throws(() => readPreparedProvision({ ...prepared, tables: [{ locator: null, rows: [[{ text: "Material exception" }]] }] }, target),
    /PREPARED_TABLE_POSITION_UNAVAILABLE/);
});

test("located table rows and cell spans survive complete provision reads", () => {
  const read = readPreparedProvision({ ...prepared, tables: [{ locator: "101", rows: [
    [{ text: "Actor", rowspan: "2" }, { text: "Condition" }], [{ text: "Written consent", colspan: "2" }],
  ] }] }, { work: "work:one", position: "101", language: "en" });
  assert.match(read.text, /Actor \[row span 2; column span 1\] \| Condition\nWritten consent \[row span 1; column span 2\]/);
  assert.match(read.text, /Exception: written consent/);
});

test("an unlocated table uses only a unique complete cell-text match without changing stored data", () => {
  const target = { work: "work:one", position: "101", language: "en" };
  const source = { ...prepared, units: [...prepared.units,
    { ...prepared.units.at(-1)!, ordinal: 100, locator: "table-unit", text: "Complete cell A Complete cell B" }],
    tables: [{ locator: null, rows: [[{ text: "Complete cell A", colspan: "2" }, { text: "Complete cell B" }]] }] };
  const before = structuredClone(source);
  const read = readPreparedProvision(source, { ...target, wholeDocument: true });
  assert.match(read.text, /Complete cell A \[row span 1; column span 2\] \| Complete cell B/);
  assert.deepEqual(source, before);
  assert.throws(() => readPreparedProvision({ ...source, units: [...source.units,
    { ...source.units.at(-1)!, ordinal: 101, locator: "duplicate" }] }, target), /PREPARED_TABLE_POSITION_UNAVAILABLE/);
  assert.throws(() => readPreparedProvision({ ...source, tables: [...source.tables, source.tables[0]] }, target),
    /PREPARED_TABLE_POSITION_UNAVAILABLE/);
});

test("a chapter preamble retains its complete section without borrowing an earlier article title", () => {
  const source = { ...prepared, units: [...prepared.units,
    { ...unit(5, "Chapter 2"), hierarchy: ["Chapter 2"] }, { ...unit(6, "A preamble."), hierarchy: ["Chapter 2"] }] };
  const read = readPreparedProvision(source, { work: "work:one", position: "106", language: "en" });
  assert.equal(read.articleTitle, null);
  assert.equal(read.sectionTitle, "Chapter 2");
  assert.deepEqual(read.ordinals, [5, 6]);
});

test("complete document fallback preserves a large qualification beyond former byte ceilings", () => {
  const source = { ...prepared, units: [unit(0, "Introduction «"), unit(1, "ж".repeat(180_000))] };
  const target = { work: "work:one", position: "101", language: "en" };
  assert.equal(readPreparedProvision(source, target).ordinals.length, 2);
  assert.ok(readPreparedProvision({ ...source, units: [source.units[0], unit(1, "ж".repeat(200_000))] }, target).text.includes("ж".repeat(200_000)));
  assert.throws(() => readPreparedProvision({ ...source, gaps: ["Missing material text"] }, target), /PREPARED_EXTRACTION_GAP/);
});

test("safe article neighbours stay inside their stored chapter and exclude quoted headings", () => {
  const source = { ...prepared, units: [unit(0, "Article 1. Prior rule"), unit(1, "Prior qualification."),
    unit(2, "Article 2. Selected rule"), unit(3, "Replace the example:"), unit(4, "«Article 90. Quoted example"),
    unit(5, "Quoted qualification.»"), unit(6, "Article 3. Consequence"), unit(7, "Complete consequence."),
    { ...unit(8, "Article 4. Other chapter"), hierarchy: ["Chapter 2"] }] };
  const read = readPreparedProvision(source, { work: "work:one", position: "103", language: "en" });
  assert.deepEqual(read.adjacentPositions, { next: "106", previous: "100" });
  const last = readPreparedProvision(source, { work: "work:one", position: "107", language: "en" });
  assert.deepEqual(last.adjacentPositions, { previous: "102" });
  const whole = readPreparedProvision(source, { work: "work:one", position: "103", language: "en", wholeDocument: true });
  assert.deepEqual(whole.adjacentPositions, {});
});

test("an exact section heading reads every contiguous descendant with its tables and publisher context", () => {
  const make = (n: number, text: string, hierarchy: string[]) => ({ ...unit(n, text), hierarchy });
  const source = { ...prepared, header: ["Publisher status"], notices: ["Applicable notice"], units: [
    make(0, "Chapter 1", ["Chapter 1"]), make(1, "Chapter 2", ["Chapter 2"]),
    make(2, "Section A", ["Chapter 2", "Section A"]), make(3, "Article 5. Rule", ["Chapter 2", "Section A"]),
    make(4, "Complete qualification.", ["Chapter 2", "Section A"]),
    make(5, "Article 6. Exception", ["Chapter 2"]), make(6, "Complete exception.", ["Chapter 2"]),
    make(7, "Chapter 3", ["Chapter 3"]),
  ], tables: [{ locator: "104", rows: [[{ text: "Complete condition table" }]] }] };
  const target = { work: "work:one", position: "101", language: "en" };
  const read = readPreparedProvision(source, target);
  assert.equal(read.sectionTitle, "Chapter 2");
  assert.equal(read.articleTitle, null);
  assert.deepEqual(read.ordinals, [1, 2, 3, 4, 5, 6]);
  for (const text of ["Publisher status", "Applicable notice", "Complete condition table", "Complete qualification.", "Complete exception."]) {
    assert.ok(read.text.includes(text));
  }
  assert.ok(!read.text.includes("Chapter 3"));
  assert.deepEqual(read.adjacentPositions, {});
  assert.throws(() => readPreparedProvision({ ...source, units: [...source.units, make(8, "Conflicting return", ["Chapter 2"])] },
    { ...target, wholeSection: true }), /PREPARED_SECTION_UNAVAILABLE/);
  assert.equal(readPreparedProvision(source, { ...target, wholeDocument: true }).ordinals.length, 8);
  const unrelated = { ...source, units: [make(0, "Earlier publisher note: «", ["Chapter 1"]), ...source.units.slice(1)] };
  assert.deepEqual(readPreparedProvision(unrelated, target).ordinals, [1, 2, 3, 4, 5, 6]);
  const replacement = { ...source, units: source.units.map(unit => ({ ...unit,
    hierarchy: ["Article 1. Replace the following chapters", ...unit.hierarchy] })) };
  assert.throws(() => readPreparedProvision(replacement, { ...target, wholeSection: true }), /PREPARED_SECTION_UNAVAILABLE/);
  assert.equal(readPreparedProvision(replacement, target).ordinals.length, source.units.length);
  const quotedAncestor = { ...source, units: source.units.map(unit => ({ ...unit,
    hierarchy: ["«Replacement chapters", ...unit.hierarchy] })) };
  assert.throws(() => readPreparedProvision(quotedAncestor, { ...target, wholeSection: true }), /PREPARED_SECTION_UNAVAILABLE/);
  const quotedChapters = { ...prepared, units: [make(0, "Replace the annex with: «", []),
    make(1, "Chapter A", ["Chapter A"]), make(2, "Rule A.", ["Chapter A"]),
    make(3, "Chapter B", ["Chapter B"]), make(4, "Other rule.»", ["Chapter B"]),
    make(5, "Commencement qualification.", [])] };
  assert.equal(readPreparedProvision(quotedChapters, target).ordinals.length, 6);
  assert.throws(() => readPreparedProvision(quotedChapters, { ...target, wholeSection: true }), /PREPARED_SECTION_UNAVAILABLE/);
  assert.throws(() => readPreparedProvision({ ...source, units: source.units.map(unit => unit.ordinal === 6 ? { ...unit, text: "Unclosed «" } : unit) },
    { ...target, wholeSection: true }), /PREPARED_SECTION_UNAVAILABLE/);
  const mixed = { ...source, units: source.units.map(unit => unit.ordinal === 6 ? { ...unit, language: "ru" } : unit) };
  assert.deepEqual(readPreparedProvision(mixed, target).ordinals, [1, 2, 3, 4, 5, 6]);
  assert.ok(readPreparedProvision(mixed, target).text.includes(source.units[6].text));
  assert.throws(() => readPreparedProvision(mixed, { ...target, language: "ru" }), /CORPUS_SOURCE_IDENTITY/);
});

test("uncertain article boundaries use the nearest safe complete stored container", () => {
  const make = (n: number, text: string, hierarchy: string[]) => ({ ...unit(n, text), hierarchy });
  const source = { ...prepared, units: [make(0, "Earlier unclosed publisher note: «", ["Other"]),
    make(1, "Chapter A", ["Chapter A"]), make(2, "Article 1. Rule", ["Chapter A"]),
    make(3, "Complete rule and condition.", ["Chapter A"]), make(4, "Article 2. Exception", ["Chapter A"]),
    make(5, "Complete exception.", ["Chapter A"]), make(6, "Chapter B", ["Chapter B"])] };
  const target = { work: "work:one", position: "103", language: "en" };
  const read = readPreparedProvision(source, target);
  assert.equal(read.sectionTitle, "Chapter A");
  assert.deepEqual(read.ordinals, [1, 2, 3, 4, 5]);
  assert.equal(read.position, "101");
  assert.equal(readPreparedProvision(source, { ...target, wholeSection: false }).ordinals.length, 7);
  assert.throws(() => readPreparedProvision(source, { ...target, wholeSection: true }), /PREPARED_SECTION_UNAVAILABLE/);
});

test("unsafe nested sections widen to a complete safe ancestor or preserve the whole act", () => {
  const make = (n: number, text: string, hierarchy: string[]) => ({ ...unit(n, text), hierarchy });
  const source = { ...prepared, units: [make(0, "Unrelated earlier note: «", ["Other"]),
    make(1, "Chapter A", ["Chapter A"]), make(2, "Replace both sections with: «", ["Chapter A"]),
    make(3, "Section X", ["Chapter A", "Section X"]), make(4, "Complete X rule.", ["Chapter A", "Section X"]),
    make(5, "Section Y", ["Chapter A", "Section Y"]), make(6, "Complete Y rule.»", ["Chapter A", "Section Y"]),
    make(7, "Commencement condition.", ["Chapter A"]), make(8, "Chapter B", ["Chapter B"])] };
  const target = { work: "work:one", position: "104", language: "en" };
  const read = readPreparedProvision(source, target);
  assert.equal(read.sectionTitle, "Chapter A");
  assert.deepEqual(read.ordinals, [1, 2, 3, 4, 5, 6, 7]);
  const ambiguous = { ...source, units: source.units.map(unit => ({ ...unit, hierarchy: ["Article 1. Quoted replacement", ...unit.hierarchy] })) };
  assert.equal(readPreparedProvision(ambiguous, target).ordinals.length, 9);
});
