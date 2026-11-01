import assert from "node:assert/strict";
import test from "node:test";
import { transliterateUzbekQueries } from "../lib/legal/uzbek-query-transliterator";
import { restoreMultilingualSearch } from "../lib/legal-answer-workflow/multilingual-search";

test("the pinned package supplies its exception dictionary and suffix behavior through the real Python bridge", async () => {
  assert.deepEqual(await transliterateUzbekQueries(["mulk obyekti", "tadbirkorlik subyekti", "sentabr oktabr", "hayotsiz ketsa"]),
    ["мулк объекти", "тадбиркорлик субъекти", "сентябрь октябрь", "ҳаётсиз кетса"]);
  assert.deepEqual(await transliterateUzbekQueries(["mehnat shartnomasi", "O‘zbekiston", "ta'til e'tiroz", "yer huquqi"]),
    ["меҳнат шартномаси", "Ўзбекистон", "таътил эътироз", "ер ҳуқуқи"]);
  // Preserve upstream behavior, including known spelling limitations; do not hide a local override.
  assert.deepEqual(await transliterateUzbekQueries(["budjet", "byudjet", "konstitutsiya", "Is’hoq"]),
    ["буджет", "бюджет", "конституция", "Исъҳоқ"]);
});

test("search expansion uses the package while retaining the exact original Latin and other languages", async () => {
  const queries = { en: "property object", ru: "объект имущества", "uz-Latn": "mulk obyekti" };
  const input = { queries, facts: ["Original fact"] };
  assert.deepEqual(await restoreMultilingualSearch(input), {
    queries: [queries.en, queries.ru, queries["uz-Latn"], "мулк объекти"], facts: input.facts,
  });
  assert.deepEqual(input.queries, queries);
});

test("transliteration rejects invalid batches and honors cancellation without fallback", async () => {
  await assert.rejects(transliterateUzbekQueries([]));
  await assert.rejects(transliterateUzbekQueries(Array(5).fill("query")));
  await assert.rejects(transliterateUzbekQueries(["x".repeat(2001)]));
  await assert.rejects(transliterateUzbekQueries(["query"], AbortSignal.abort()));
  const controller = new AbortController();
  const pending = transliterateUzbekQueries(["mulk obyekti"], controller.signal);
  controller.abort();
  await assert.rejects(pending, /UZBEK_TRANSLITERATION_CANCELLED/);
});
