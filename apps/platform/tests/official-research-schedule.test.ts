import assert from "node:assert/strict";
import test from "node:test";
import {scheduleOfficialDiscovery} from "../lib/legal/official-research-schedule";

test("slow indexed work can overlap one request-owned discovery and reuse its exact query", async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => {started = resolve;});
  let complete!: (urls: string[]) => void;
  const calls: string[] = [];
  const research = scheduleOfficialDiscovery({query: Promise.resolve("complete user question\nsemantic formulation"), locale: "ru",
    delayMs: 1, discover: async (query) => {calls.push(query); started(); return new Promise(resolve => {complete = resolve;});}});
  await ready;
  const required = research.discover("complete user question\nsemantic formulation", "ru", new AbortController().signal);
  complete(["https://lex.uz/ru/docs/42"]);
  assert.deepEqual(await required, ["https://lex.uz/ru/docs/42"]);
  await research.close();
  assert.equal(calls.length, 1);
});

test("adequate indexed evidence cancels and drains unused discovery", async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => {started = resolve;});
  let settled = false;
  const research = scheduleOfficialDiscovery({query: Promise.resolve("question"), locale: "ru", delayMs: 1,
    discover: async (_query, _locale, signal) => {started(); return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {settled = true; reject(signal.reason);}, {once: true});
    });}});
  await ready;
  await research.close();
  assert.equal(settled, true);
});

test("an early indexed completion starts no public discovery, and requests never share results", async () => {
  let calls = 0;
  const discover = async () => {calls++; return ["https://lex.uz/ru/docs/42"];};
  const first = scheduleOfficialDiscovery({query: Promise.resolve("same question"), locale: "ru", delayMs: 1000, discover});
  await first.close();
  assert.equal(calls, 0);
  const second = scheduleOfficialDiscovery({query: Promise.resolve("same question"), locale: "ru", delayMs: 1000, discover});
  await second.discover("same question", "ru", new AbortController().signal);
  await second.close();
  assert.equal(calls, 1);
});

test("failed discovery remains a failure, and a different formulation is never served the prefetched result", async () => {
  const calls: string[] = [];
  const research = scheduleOfficialDiscovery({query: Promise.resolve("original"), locale: "ru", delayMs: 1000,
    discover: async query => {calls.push(query); if(query === "original") throw new Error("upstream unavailable"); return [];}});
  await assert.rejects(research.discover("original", "ru", new AbortController().signal), /upstream unavailable/);
  assert.deepEqual(await research.discover("corrected", "ru", new AbortController().signal), []);
  await research.close();
  assert.deepEqual(calls, ["original", "corrected"]);
});

test("closing aborts a pending formulation wait without starting discovery", async () => {
  let resolveQuery!: (query: string) => void;
  const query = new Promise<string>(resolve => {resolveQuery = resolve;});
  const research = scheduleOfficialDiscovery({query, locale: "ru", delayMs: 1,
    discover: async () => {assert.fail("cancelled discovery must not start");}});
  await new Promise(resolve => setTimeout(resolve, 10));
  let closed = false;
  const closing = research.close().then(() => {closed = true;});
  await new Promise(resolve => setImmediate(resolve));
  const closedWithoutQuery = closed;
  resolveQuery("late formulation");
  await closing;
  assert.equal(closedWithoutQuery, true);
});
