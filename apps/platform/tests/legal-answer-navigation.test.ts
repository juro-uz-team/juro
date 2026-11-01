import assert from "node:assert/strict";
import test from "node:test";
import { ResearchNavigation } from "../lib/legal-answer-workflow/research-navigation";

test("retained result pages reopen stable IDs without executing search", () => {
  const navigation = new ResearchNavigation();
  const scope = { kind: "current" as const };
  const ids = Array.from({ length: 53 }, (_, index) => `c${index + 1}`);
  navigation.beginBatch();
  const first = navigation.retain("first", { kind: "search", query: "first", scope }, ids);
  assert.deepEqual([...navigation.visibleIds()], ids.slice(0, 50));
  navigation.beginBatch();
  const second = navigation.retain("second", { kind: "literal", query: "phrase", scope }, ["c54"]);
  assert.deepEqual([...navigation.visibleIds()], ["c54"]);
  const before = navigation.listings;
  navigation.beginBatch();
  assert.equal(navigation.list(first, 1), true);
  assert.equal(navigation.listings, before + 1);
  assert.deepEqual([...navigation.visibleIds()], ids.slice(50));
  assert.equal(navigation.list(first, 1), false);
  assert.equal(navigation.listings, before + 1);
  navigation.beginBatch();
  assert.equal(navigation.list(first, 0), true);
  navigation.beginBatch();
  assert.equal(navigation.list(second, 0), true);
  navigation.beginBatch();
  assert.equal(navigation.list(first, 0), true);
  assert.deepEqual([...navigation.visibleIds()], ids.slice(0, 50));
  assert.equal(navigation.list(first, 0), false);
  assert.deepEqual(navigation.catalog(new Set(["c1"])).map(item =>
    [item.id, item.retainedCount, item.attemptedReadCount, item.pageCount]), [[first, 53, 1, 2], [second, 1, 0, 1]]);
  assert.throws(() => navigation.list("unknown", 0), /RESEARCH_RESULT_SET_INVALID/);
  assert.throws(() => navigation.list(first, 2), /RESEARCH_RESULT_PAGE_INVALID/);
  assert.throws(() => navigation.list(first, -1), /RESEARCH_RESULT_PAGE_INVALID/);
});

test("result membership is immutable and scope-specific with explicit empty sets", () => {
  const navigation = new ResearchNavigation();
  const ids = ["c1"];
  const scope = { kind: "historical" as const, at: "2020-01-01" };
  navigation.beginBatch();
  const first = navigation.retain("historical", { kind: "search", query: "same", scope }, ids);
  ids.push("c2"); scope.at = "2021-01-01";
  const empty = navigation.retain("current", { kind: "search", query: "same", scope: { kind: "current" } }, []);
  assert.deepEqual([...navigation.visibleIds()], ["c1"]);
  assert.deepEqual(navigation.catalog(new Set())[0].scope, { kind: "historical", at: "2020-01-01" });
  assert.equal(navigation.catalog(new Set())[1].pageCount, 0);
  assert.throws(() => navigation.list(empty, 0), /RESEARCH_RESULT_PAGE_INVALID/);
  assert.equal(navigation.retain("historical", { kind: "search", query: "same", scope }, []), first);
  assert.deepEqual(navigation.catalog(new Set()).map(item => item.retainedCount), [1, 0]);
});

test("batch listings preserve an already visible requested page regardless of action order", () => {
  const views: string[][] = [];
  for (const reverse of [false, true]) {
    const navigation = new ResearchNavigation();
    const description = { kind: "search" as const, query: "query", scope: { kind: "current" as const } };
    navigation.beginBatch();
    const second = navigation.retain("second", description, ["c2"]);
    navigation.beginBatch();
    const first = navigation.retain("first", description, ["c1"]);
    navigation.beginBatch();
    const results = (reverse ? [second, first] : [first, second]).map(id => navigation.list(id, 0));
    assert.ok(results.some(Boolean));
    views.push([...navigation.visibleIds()].sort());
    navigation.beginBatch();
    const before = navigation.listings;
    assert.equal(navigation.list(first, 0), false);
    assert.equal(navigation.listings, before);
  }
  assert.deepEqual(views, [["c1", "c2"], ["c1", "c2"]]);
});
