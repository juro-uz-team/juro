import assert from "node:assert/strict";
import test from "node:test";
import {citationPreview} from "../lib/legal/citation-preview";

test("citation label and excerpt come from the same verified article, not the document's first ranked article", () => {
  const source = {article: "Статья 27. Документация", excerpt: "Document preview",
    spans: [{article: "Статья 27. Документация", text: "Текст документации"},
      {article: "Статья 40. Обязанности", text: "Обязанности юридических лиц"}]};
  assert.deepEqual(citationPreview(source, "Статья 40. Обязанности"), {
    article: "Статья 40. Обязанности", excerpt: "Обязанности юридических лиц",
  });
  assert.throws(() => citationPreview(source, "Статья 99. Не существует"), /CITATION_ARTICLE_MISMATCH/u);
  assert.deepEqual(citationPreview({article: null, excerpt: "Context only"}, null), {
    article: null, excerpt: "Context only",
  });
});

test("an unlabelled span cannot impersonate the requested article", () => {
  const source = {article: "Article 27", spans: [
    {article: null, text: "Unlabelled preamble"}, {article: "Article 27", text: "Verified article text"},
  ]};
  assert.deepEqual(citationPreview(source, "Article 27"), {article: "Article 27", excerpt: "Verified article text"});
  assert.throws(() => citationPreview({...source, spans: source.spans.slice(0, 1)}, "Article 27"), /CITATION_ARTICLE_MISMATCH/u);
});
