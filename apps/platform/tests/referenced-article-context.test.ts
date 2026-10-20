import assert from "node:assert/strict";
import test from "node:test";
import {sameInstrumentArticleReferences} from "../lib/legal/referenced-article-context";

test("explicit same-instrument lists retain every complementary article",()=>{
  assert.deepEqual(sameInstrumentArticleReferences(
    "Дополнительные отпуска, предусмотренные статьями 137 и 138 настоящего Кодекса, используются в натуре."),
  ["137","138"]);
  assert.deepEqual(sameInstrumentArticleReferences(
    "В соответствии со статьями 131, 134 и 137 настоящего Кодекса и статьей 134 этого Кодекса."),
  ["131","134","137"]);
  assert.deepEqual(sameInstrumentArticleReferences(
    "Articles 7, 8 and 9 of this Act; article 12-1 of this Code."),
  ["7","8","9","12-1"]);
  assert.deepEqual(sameInstrumentArticleReferences("Articles 7, 8, and 9 of this Act."),["7","8","9"]);
});

test("bare, external and ambiguous range references do not establish same-instrument targets",()=>{
  for(const text of ["(статья 137)","статьи 137 и 138 Трудового кодекса",
    "Articles 7 and 8 of the Civil Code","Articles 7–9 of this Act","Articles 7-9 of this Act",
    "статьи 7 и 8 другого Кодекса"]){
    assert.deepEqual(sameInstrumentArticleReferences(text),[]);
  }
});
