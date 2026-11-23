import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { classifyLegalSourceUrl } from "./source-fetch";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const updateSchema = z.object({
  sequence: z.number().int().positive(),
  id: hash,
  source: z.string().regex(/^-?\d+$/u),
  url: z.string(),
  title: z.string().trim().min(1),
  language: z.string().nullable(),
  kind: z.enum(["new_act", "edition", "metadata_changed"]),
  observed: z.number().positive(),
  work: hash.nullable(),
  catchup: z.union([z.literal(0), z.literal(1)]),
});

/**
 * Copy publisher observations from the local maintenance journal. The app
 * commits feed entries, notices and its checkpoint in the same transaction.
 */
export async function syncCorpusPublicationFeed(pool: Pool, path: string) {
  const journal = new DatabaseSync(path, { readOnly: true });
  try {
    journal.exec("BEGIN");
    const baseline = hash.parse(journal.prepare("SELECT pin FROM baseline").get()?.pin);
    const activation = journal.prepare("SELECT activated FROM catchup_handoff WHERE id=1").get()?.activated;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const acquired = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('corpus-publication-feed')) AS locked");
      if (!acquired.rows[0].locked) {
        await client.query("ROLLBACK");
        return;
      }
      const checkpoint = await client.query<{ last_sequence: string; catchup_summary_sent: boolean }>(
        "SELECT last_sequence,catchup_summary_sent FROM app.corpus_publication_checkpoint WHERE baseline=$1", [baseline]);
      let sequence = Number(checkpoint.rows[0]?.last_sequence ?? 0);
      let summarySent = checkpoint.rows[0]?.catchup_summary_sent ?? false;
      const entries = journal.prepare(`SELECT u.rowid AS sequence,u.id,u.source,u.url,u.title,u.language,
        u.kind,u.observed,u.work,r.catchup FROM updates u JOIN runs r ON r.day=u.day
        WHERE u.rowid>? ORDER BY u.rowid LIMIT 500`).all(sequence);
      for (const raw of entries) {
        const entry = updateSchema.parse(raw);
        const source = classifyLegalSourceUrl(entry.url);
        if (source.sourceKind !== "lex" || source.canonicalId !== entry.source) throw new Error("CORPUS_UPDATE_SOURCE");
        const observed = new Date(entry.observed * 1_000).toISOString();
        const catchup = typeof activation !== "number" || entry.observed <= activation;
        const saved = await client.query(`INSERT INTO app.corpus_publication_updates
          (id,canonical_id,official_url,title,language,kind,observed_at,edition_date,work,catchup)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING RETURNING id`,
        [entry.id, entry.source, entry.url, entry.title.slice(0, 2_000), entry.language, entry.kind,
          observed, source.revisionDate ?? null, entry.work, catchup]);
        if (saved.rowCount && !catchup) {
          await enqueueNotices(client, entry.id, entry.title, observed);
        }
        sequence = entry.sequence;
      }
      const last = journal.prepare("SELECT MAX(completed) AS latest FROM runs").get()?.latest;
      const catchup = typeof activation === "number" ? journal.prepare(`SELECT count(id) AS total,
        coalesce(max(rowid),0) AS lastSequence FROM updates WHERE observed<=?`).get(activation) : undefined;
      if (!summarySent && typeof activation === "number" && catchup && typeof catchup.lastSequence === "number"
        && sequence >= catchup.lastSequence && typeof catchup.total === "number") {
        await enqueueCatchupSummary(client, baseline, catchup.total, new Date(activation * 1_000).toISOString());
        summarySent = true;
      }
      await client.query(`INSERT INTO app.corpus_publication_checkpoint (baseline,last_sequence,last_success_at,catchup_summary_sent)
        VALUES ($1,$2,$3,$4) ON CONFLICT(baseline) DO UPDATE SET last_sequence=excluded.last_sequence,
          last_success_at=excluded.last_success_at,catchup_summary_sent=excluded.catchup_summary_sent`,
      [baseline, sequence, typeof last === "number" ? new Date(last * 1_000).toISOString() : null, summarySent]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    journal.close();
  }
}

async function enqueueCatchupSummary(client: PoolClient, baseline: string, total: number, completed: string) {
  await client.query(`INSERT INTO app.notifications (id,workspace_id,user_id,type,title,body,created_at)
    SELECT 'corpus_catchup_' || md5($1 || ':' || p.workspace_id || ':' || p.user_id),
      p.workspace_id,p.user_id,'legislation_monitor',
      CASE p.locale WHEN 'en' THEN 'Legislation catch-up' WHEN 'uz' THEN 'Qonunchilik yangilanishlari'
      ELSE 'Обновления законодательства' END,
      CASE p.locale WHEN 'en' THEN 'Recovered publication updates in Monitoring: '
      WHEN 'uz' THEN 'Monitoringda qayd etilgan yangilanishlar: '
      ELSE 'Обновлений в разделе «Мониторинг»: ' END || $2,$3
    FROM app.monitoring_preferences p JOIN app.workspace_members m
      ON m.workspace_id=p.workspace_id AND m.user_id=p.user_id
    WHERE m.status='active' AND p.channels_json LIKE '%"in_app"%'
    ON CONFLICT(id) DO NOTHING`, [baseline, String(total), completed]);
}

async function enqueueNotices(client: PoolClient, id: string, title: string, observed: string) {
  await client.query(`INSERT INTO app.notifications (id,workspace_id,user_id,type,title,body,created_at)
    SELECT 'corpus_update_' || md5($1 || ':' || p.workspace_id || ':' || p.user_id),
      p.workspace_id,p.user_id,'legislation_monitor',
      CASE p.locale WHEN 'en' THEN 'Legislation update' WHEN 'uz' THEN 'Qonunchilik yangilanishi'
      ELSE 'Обновление законодательства' END,$2,$3
    FROM app.monitoring_preferences p JOIN app.workspace_members m
      ON m.workspace_id=p.workspace_id AND m.user_id=p.user_id
    WHERE m.status='active' AND p.channels_json LIKE '%"in_app"%'
    ON CONFLICT(id) DO NOTHING`, [id, title.slice(0, 2_000), observed]);
}
