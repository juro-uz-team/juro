import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresDatabase } from "../lib/storage/postgres";
import { LocalObjectStore } from "../lib/storage/objects";
import { database, corpusDatabase, closeRuntimeDatabases } from "../lib/storage/connection";

test("shared corpus connections stay separate from writable application and observation connections", async () => {
  const previous = process.env.CORPUS_DATABASE_URL;
  try {
    delete process.env.CORPUS_DATABASE_URL;
    assert.equal(corpusDatabase("legal"), database("legal"));
    process.env.CORPUS_DATABASE_URL = process.env.DATABASE_URL;
    const corpus = corpusDatabase("legal");
    assert.notEqual(corpus, database("legal"));
    assert.equal(corpusDatabase("legal"), corpus);
    assert.equal((await corpus.pool.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
    assert.equal((await database("legal").pool.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "off");
    await assert.rejects(corpus.pool.query("CREATE TABLE public.corpus_write_must_fail (id integer)"), {code: "25006"});
  } finally {
    await closeRuntimeDatabases();
    if (previous === undefined) delete process.env.CORPUS_DATABASE_URL;
    else process.env.CORPUS_DATABASE_URL = previous;
  }
});

test("read-only corpus objects reject writes before connecting or creating files", async () => {
  const root = await mkdtemp(join(tmpdir(), "juro-corpus-readonly-"));
  const unavailable = new PostgresDatabase("postgresql://unavailable@127.0.0.1:1/unavailable");
  try {
    const corpus = new LocalObjectStore(unavailable.pool, root, "public-corpus", true);
    await assert.rejects(corpus.put("example", "bytes"), /Public corpus objects are read-only/);
    await assert.rejects(corpus.delete("example"), /Public corpus objects are read-only/);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await unavailable.close();
    await rm(root, {recursive: true});
  }
});
