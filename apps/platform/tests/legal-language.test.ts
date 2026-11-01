import assert from "node:assert/strict";
import test from "node:test";

import {
  detectArticleNumbers,
  detectDocumentAliases,
  detectLegalQueryLanguage,
  expandLegalAbbreviations,
  normalizeArticleNumber,
  normalizeLegalSearchQuery,
  normalizeUzbekLatin,
  transliterateUzbek,
  transliterateUzbekToCyrillic,
} from "../lib/legal/legal-language";

test("Uzbek normalization keeps Latin official text separate from Cyrillic query transliteration", () => {
  assert.equal(normalizeUzbekLatin("O’ZBEKISTON"), "OʻZBEKISTON");
  assert.equal(
    transliterateUzbek("Ўзбекистон Республикасининг Меҳнат кодекси"),
    "oʻzbekiston respublikasining mehnat kodeksi",
  );
  assert.match(
    normalizeLegalSearchQuery("Меҳнат кодекси 12-моддаси", "uz"),
    /mehnat kodeksi 12-modda/iu,
  );
});

test("legal reference detection retains every explicit article number in order", () => {
  assert.deepEqual(
    detectArticleNumbers("статья 12 Трудового кодекса и 289-1-modda"),
    ["12", "289-1"],
  );
  assert.deepEqual(detectArticleNumbers("просто 2026 год"), []);
  assert.deepEqual(
    detectArticleNumbers("289¹-modda, статья 24 prim и 173-2-modda"),
    ["289-1", "24-prim", "173-2"],
  );
});

test("document aliases work for Russian, Latin Uzbek and Cyrillic Uzbek", () => {
  assert.deepEqual(detectDocumentAliases("Гражданский кодекс, статья 8"), ["civil_code"]);
  assert.deepEqual(detectDocumentAliases("Soliq kodeksi 12-modda"), ["tax_code"]);
  assert.deepEqual(detectDocumentAliases("Меҳнат кодекси 12-модда"), ["labor_code"]);
});

test("language detection and abbreviation expansion keep cross-language query variants explicit", () => {
  assert.equal(detectLegalQueryLanguage("Какой срок по ГК?"), "ru");
  assert.equal(detectLegalQueryLanguage("Меҳнат кодекси 12-модда"), "uz-Cyrl");
  assert.equal(detectLegalQueryLanguage("What does Article 12 say?"), "en");
  assert.equal(detectLegalQueryLanguage("ГК бўйича modda 12"), "mixed");
  assert.deepEqual(expandLegalAbbreviations("ГК 12-модда"), [
    "гражданский кодекс",
    "fuqarolik kodeksi",
  ]);
  assert.equal(normalizeArticleNumber("289¹"), "289-1");
  assert.equal(normalizeArticleNumber("24 prim"), "24-prim");
});

test("Uzbek query transliteration handles legal wording and apostrophe variants without changing numbers", () => {
  for (const apostrophe of ["'", "‘", "’", "ʻ", "ʼ", "`", "´"]) {
    assert.equal(transliterateUzbekToCyrillic(`O${apostrophe}zbekiston g${apostrophe}ayriqonuniy ta${apostrophe}til e${apostrophe}tiroz`),
      "ўзбекистон ғайриқонуний таътил эътироз");
  }
  for (const [latin, cyrillic] of [
    ["mehnat intizomiy jazo bekor qilish 2026", "меҳнат интизомий жазо бекор қилиш 2026"],
    ["yer huquqi shartnoma yo‘q", "ер ҳуқуқи шартнома йўқ"],
    ["shaxs ma’naviy zarar Is’hoq", "шахс маънавий зарар исҳоқ"],
    ["elektron e’lon yechim", "электрон эълон ечим"],
  ]) assert.equal(transliterateUzbekToCyrillic(latin), cyrillic);
});
