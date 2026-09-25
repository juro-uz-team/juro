import assert from "node:assert/strict";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {createD1SourceObservationStore} from "../lib/legal/source-observation-store";
import {createSourceObservationReader, isCurrentSourceObservation, sourceObservationSchema, type SourceObservation} from "../lib/legal/source-observation";
import {refreshPublicSourceObservations, reserveSourceObservationCrawlWindow} from "../lib/legal/source-observation-refresh";
import {createSharedSourceObservationRefresh} from "../lib/legal/shared-source-observation";

test("a slow publisher owner renews its lease and acquisition rechecks completed observations", async (context) => {
  context.mock.timers.enable({apis: ["setInterval"]});
  const sqlite = new DatabaseSync(":memory:");
  let time = Date.parse("2026-09-11T00:00:00.000Z");
  const url = "https://lex.uz/ru/docs/777";
  const observation = (): SourceObservation => ({version: 2, officialUrl: url, observedAt: new Date(time).toISOString(),
    current: true, normalizedTextSha256: "a".repeat(64), rawContentSha256: "b".repeat(64), normalizedTextSha256V2: "d".repeat(64),normalizationPolicy:"e".repeat(64)});
  let beforeAcquire: (() => Promise<void>) | undefined;
  const db = {prepare(sql: string) {return {bind(...values: (string | number)[]) {return {
    async first() {return sqlite.prepare(sql).get(...values) ?? null;},
    async run() {
      if (sql.startsWith("INSERT INTO legal_source_observation_refresh_leases") && beforeAcquire) {
        const run = beforeAcquire; beforeAcquire = undefined; await run();
      }
      return {meta: {changes: sqlite.prepare(sql).run(...values).changes}};
    },
  };}};}} as unknown as D1Database;
  try {
    sqlite.exec(readFileSync("legal-drizzle/0032_public_source_observations.sql", "utf8"));
    sqlite.exec(readFileSync("legal-drizzle/0033_publisher_status_observations.sql", "utf8"));
    sqlite.exec(readFileSync("postgres/0025-publisher-normalization-fingerprint.sql", "utf8").replace("legal.legal_publisher_status_observations", "legal_publisher_status_observations"));
    sqlite.exec(readFileSync("postgres/0026-publisher-fingerprint-observation-binding.sql", "utf8").replace("legal.legal_publisher_status_observations", "legal_publisher_status_observations"));
    sqlite.exec("ALTER TABLE legal_publisher_status_observations ADD COLUMN normalization_policy text; ALTER TABLE legal_publisher_status_observations ADD COLUMN normalization_policy_observed_at text; ALTER TABLE legal_publisher_status_observations ADD COLUMN lifecycle_repealed_on text; ALTER TABLE legal_publisher_status_observations ADD COLUMN lifecycle_observed_at text;");
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => {entered = resolve;});
    const blocked = new Promise<void>(resolve => {release = resolve;});
    let calls = 0;
    const owner = createSharedSourceObservationRefresh({db, now: () => time, readPublisher: async () => {
      calls++; entered(); await blocked; return observation();
    }})(url);
    await started;
    for (let tick = 0; tick < 6; tick++) {
      time += 5_000; context.mock.timers.tick(5_000);
      await new Promise(resolve => setImmediate(resolve));
    }
    const joined = createSharedSourceObservationRefresh({db, now: () => time,
      wait: async () => {release(); await owner;},
      readPublisher: async () => {assert.fail("The active publisher owner still holds the renewed lease");}})(url);
    await Promise.all([owner, joined]);
    assert.equal(calls, 1);
    time += 300_000;
    beforeAcquire = () => createD1SourceObservationStore(db).put(observation());
    const afterRace = await createSharedSourceObservationRefresh({db, now: () => time,
      readPublisher: async () => {assert.fail("An observation completed before acquisition must be reused");}})(url);
    assert.equal(afterRace.observedAt, new Date(time).toISOString());
  } finally {sqlite.close();}
});

test("independent runtimes reuse the original observation and late writes cannot replace newer publisher evidence", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(readFileSync("legal-drizzle/0032_public_source_observations.sql", "utf8"));
    sqlite.exec(readFileSync("legal-drizzle/0033_publisher_status_observations.sql", "utf8"));
    sqlite.exec(readFileSync("postgres/0025-publisher-normalization-fingerprint.sql", "utf8").replace("legal.legal_publisher_status_observations", "legal_publisher_status_observations"));
    sqlite.exec(readFileSync("postgres/0026-publisher-fingerprint-observation-binding.sql", "utf8").replace("legal.legal_publisher_status_observations", "legal_publisher_status_observations"));
    sqlite.exec("ALTER TABLE legal_publisher_status_observations ADD COLUMN normalization_policy text; ALTER TABLE legal_publisher_status_observations ADD COLUMN normalization_policy_observed_at text; ALTER TABLE legal_publisher_status_observations ADD COLUMN lifecycle_repealed_on text; ALTER TABLE legal_publisher_status_observations ADD COLUMN lifecycle_observed_at text;");
    const db = {prepare(sql: string) {return {bind(...values: (string | number)[]) {return {
      async first() {return sqlite.prepare(sql).get(...values) ?? null;},
      async run() {return {meta: {changes: sqlite.prepare(sql).run(...values).changes}};},
    };}};}} as unknown as D1Database;
    const url = "https://lex.uz/ru/docs/777";
    const old: SourceObservation = {version: 2, officialUrl: url, observedAt: "2026-09-11T00:00:00.000Z", current: true,
      normalizedTextSha256: "a".repeat(64), rawContentSha256: "b".repeat(64)};
    const current = {...old, lifecycle:{repealedOn:null}, normalizationPolicy:"f".repeat(64), normalizedTextSha256V2: "d".repeat(64), observedAt: "2026-09-11T00:01:00.000Z", normalizedTextSha256: "c".repeat(64)};
    const writer = createD1SourceObservationStore(db);
    // An old producer can still write its own table during a rolling update.
    // Its decision must never be promoted into corrected publisher status.
    sqlite.prepare('INSERT INTO legal_source_observations VALUES (?,?,?,?,?,?)')
      .run(url, 1, current.observedAt, 1, current.normalizedTextSha256, current.rawContentSha256);
    assert.equal(await writer.get(url), null);
    await writer.put(old);
    const retained = await writer.get(url);
    assert.equal(isCurrentSourceObservation(retained, {officialUrl:url, normalizedTextSha256:old.normalizedTextSha256,
      now:Date.parse(old.observedAt)}), true);
    assert.equal(isCurrentSourceObservation(retained, {officialUrl:url, normalizedTextSha256:current.normalizedTextSha256V2,
      now:Date.parse(old.observedAt)}), false, "A fresh older observation must not invent the new profile fingerprint");
    await writer.put(current);
    await writer.put(old);
    sqlite.prepare('UPDATE legal_source_observations SET observed_at=?,is_current=0 WHERE official_url=?')
      .run('2026-09-11T00:05:00.000Z', url);
    assert.deepEqual(await writer.get(url), current, 'Old worker writes cannot alter corrected observations');
    const independent = createSourceObservationReader({store: createD1SourceObservationStore(db),
      now: () => Date.parse("2026-09-11T00:03:00.000Z"), async readPublisher() {assert.fail("The shared observation is fresh");}});
    assert.deepEqual(await independent(url), current);
    let publisherCalls = 0;
    const refresh = async (): Promise<SourceObservation> => {
      publisherCalls++; await new Promise(resolve => setTimeout(resolve, 15));
      return {...current, observedAt: "2026-09-11T00:04:00.000Z"};
    };
    const createOwner = () => createSharedSourceObservationRefresh({db, readPublisher: refresh,
      now: () => Date.parse("2026-09-11T00:04:00.000Z"), wait: () => new Promise(resolve => setTimeout(resolve, 5))});
    const parallel = await Promise.all([createOwner()(url), createOwner()(url)]);
    assert.equal(publisherCalls, 1, "Only one independent runtime refreshes the public document");
    assert.deepEqual(parallel[0], parallel[1]);
    // A pre-upgrade writer updates only the original columns.
    sqlite.prepare("UPDATE legal_publisher_status_observations SET observed_at=?,normalized_text_sha256=? WHERE official_url=?")
      .run("2026-09-11T00:05:00.000Z", "e".repeat(64), url);
    const mixed = sourceObservationSchema.parse(await writer.get(url));
    assert.equal(mixed.normalizedTextSha256V2, undefined);
    assert.equal(mixed.lifecycle,undefined,"An old writer cannot renew lifecycle evidence");
    assert.equal(mixed.normalizationPolicy,undefined,"An old writer cannot renew normalizer provenance");
    assert.equal(isCurrentSourceObservation(mixed, {officialUrl:url,normalizedTextSha256:current.normalizedTextSha256V2,
      now:Date.parse(mixed.observedAt)}), false, "An old writer cannot renew the structured fingerprint");
    await assert.rejects(writer.put({...current, officialUrl: "https://example.com/private"}));
    await assert.rejects(writer.put({...current, officialUrl: `${url}?ONDATE=01.01.2018`}));
  } finally {sqlite.close();}
});

test("scheduled refresh leases public targets, preserves failed observation age and honors the shared crawl window", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(readFileSync("legal-drizzle/0032_public_source_observations.sql", "utf8"));
    sqlite.exec(readFileSync("legal-drizzle/0033_publisher_status_observations.sql", "utf8"));
    sqlite.exec(readFileSync("postgres/0025-publisher-normalization-fingerprint.sql", "utf8").replace("legal.legal_publisher_status_observations", "legal_publisher_status_observations"));
    sqlite.exec(readFileSync("postgres/0026-publisher-fingerprint-observation-binding.sql", "utf8").replace("legal.legal_publisher_status_observations", "legal_publisher_status_observations"));
    sqlite.exec("ALTER TABLE legal_publisher_status_observations ADD COLUMN normalization_policy text; ALTER TABLE legal_publisher_status_observations ADD COLUMN normalization_policy_observed_at text; ALTER TABLE legal_publisher_status_observations ADD COLUMN lifecycle_repealed_on text; ALTER TABLE legal_publisher_status_observations ADD COLUMN lifecycle_observed_at text;");
    const db = {prepare(sql: string) {return {bind(...values: (string | number)[]) {return {
      async first() {return sqlite.prepare(sql).get(...values) ?? null;},
      async all() {return {results: sqlite.prepare(sql).all(...values)};},
      async run() {return {meta: {changes: sqlite.prepare(sql).run(...values).changes}};},
    };}};}} as unknown as D1Database;
    const urls = ["https://lex.uz/ru/docs/777", "https://lex.uz/ru/docs/888"];
    const time = Date.parse("2026-09-11T00:05:00.000Z");
    for (const url of urls) sqlite.prepare("INSERT INTO legal_source_observation_targets(official_url,refresh_after) VALUES (?,?)")
      .run(url, "2026-09-11T00:00:00.000Z");
    const store = createD1SourceObservationStore(db);
    await store.put({version: 2, officialUrl: urls[1]!, observedAt: "2026-09-11T00:00:00.000Z", current: true,
      normalizedTextSha256: "a".repeat(64), rawContentSha256: "b".repeat(64)});
    const calls: string[] = [];
    const observe = async (officialUrl: string): Promise<SourceObservation> => {
      calls.push(officialUrl); await new Promise(resolve => setTimeout(resolve, 5));
      if (officialUrl === urls[1]) throw new Error("LEGAL_SOURCE_UPSTREAM_UNAVAILABLE");
      return {version: 2, officialUrl, observedAt: new Date(time).toISOString(), current: true,
        normalizedTextSha256: "a".repeat(64), rawContentSha256: "b".repeat(64)};
    };
    const results = await Promise.all([refreshPublicSourceObservations({db, observe, now: () => time}),
      refreshPublicSourceObservations({db, observe, now: () => time})]);
    assert.equal(results.reduce((sum, result) => sum + result.refreshed, 0), 1);
    assert.equal(results.reduce((sum, result) => sum + result.failed, 0), 1);
    assert.deepEqual(calls.sort(), urls);
    assert.equal(sourceObservationSchema.parse(await store.get(urls[1]!)).observedAt, "2026-09-11T00:00:00.000Z");
    const failed = sqlite.prepare("SELECT last_error_code FROM legal_source_observation_targets WHERE official_url=?").get(urls[1]!);
    assert.equal(failed!.last_error_code, "LEGAL_SOURCE_UPSTREAM_UNAVAILABLE");
    assert.equal(await reserveSourceObservationCrawlWindow(db, 20_000, time), true);
    assert.equal(await reserveSourceObservationCrawlWindow(db, 20_000, time + 19_999), false);
    assert.equal(await reserveSourceObservationCrawlWindow(db, 20_000, time + 20_000), true);
  } finally {sqlite.close();}
});

test("the scheduled publisher path reserves real crawl windows and retries at the publisher's next slot", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(readFileSync("legal-drizzle/0032_public_source_observations.sql", "utf8"));
    sqlite.exec(readFileSync("legal-drizzle/0033_publisher_status_observations.sql", "utf8"));
    sqlite.exec(readFileSync("postgres/0025-publisher-normalization-fingerprint.sql", "utf8").replace("legal.legal_publisher_status_observations", "legal_publisher_status_observations"));
    sqlite.exec(readFileSync("postgres/0026-publisher-fingerprint-observation-binding.sql", "utf8").replace("legal.legal_publisher_status_observations", "legal_publisher_status_observations"));
    sqlite.exec("ALTER TABLE legal_publisher_status_observations ADD COLUMN normalization_policy text; ALTER TABLE legal_publisher_status_observations ADD COLUMN normalization_policy_observed_at text; ALTER TABLE legal_publisher_status_observations ADD COLUMN lifecycle_repealed_on text; ALTER TABLE legal_publisher_status_observations ADD COLUMN lifecycle_observed_at text;");
    const db = {prepare(sql: string) {return {bind(...values: (string | number)[]) {return {
      async first() {return sqlite.prepare(sql).get(...values) ?? null;},
      async all() {return {results: sqlite.prepare(sql).all(...values)};},
      async run() {return {meta: {changes: sqlite.prepare(sql).run(...values).changes}};},
    };}};}} as unknown as D1Database;
    let time = Date.parse("2026-09-11T00:05:00.000Z");
    for (const id of [777, 888, 999]) sqlite.prepare("INSERT INTO legal_source_observation_targets(official_url,refresh_after) VALUES (?,?)")
      .run(`https://lex.uz/ru/docs/${id}`, "2026-09-11T00:00:00.000Z");
    const fetchedAt: number[] = [];
    for (let window = 0; window < 3; window++) {
      const summary = await refreshPublicSourceObservations({db, now: () => time, readPublisher: async (officialUrl, options) => {
        assert.ok(options, "Scheduled fetches require publisher pacing");
        await options.wait(20_000); fetchedAt.push(time);
        return {version: 2, officialUrl, observedAt: new Date(time).toISOString(), current: true,
          normalizedTextSha256: "a".repeat(64), rawContentSha256: "b".repeat(64)};
      }});
      assert.equal(summary.refreshed, 1);
      assert.equal(summary.failed, 2 - window);
      time += 20_000;
    }
    assert.deepEqual(fetchedAt, [0, 20_000, 40_000].map(offset => Date.parse("2026-09-11T00:05:00.000Z") + offset));
  } finally {sqlite.close();}
});
