import { database } from "../storage/connection";
import { transaction, notify, practiceActor, requireCase } from "./access";
import { syncGoogle } from "./calendar";
import { insertInvoice } from "./finance";
import { userIdentityById } from "../auth/identity-protection";
import { runtimeIdentityProtection } from "../auth/identity-runtime";
import { requireD1, runtimeEnv } from "../document-builder/storage/runtime";
import { sendEmailRequest } from "../runtime/email";

/** Called by JURO's existing five-minute job loop, never by a new scheduler. */
export async function runPracticeJobs() {
  if (process.env.PRACTICE_ENABLED !== "true") return;
  await transaction(async (client) => {
    const lock = (
      await client.query(
        `SELECT pg_try_advisory_xact_lock(hashtextextended('practice-jobs',0)) AS locked`,
      )
    ).rows[0];
    if (!lock.locked) return;
    const configs = (
      await client.query(`SELECT * FROM practice_workspaces WHERE enabled`)
    ).rows;
    for (const config of configs) {
      if (config.settings.reminders !== false) {
        const hours = Number.isInteger(config.settings.reminderHours)
          ? config.settings.reminderHours
          : 24;
        const tasks = (
          await client.query(
            `SELECT t.id,t.due_at,t.updated_at,p.assignee_user_id FROM tasks t JOIN practice_tasks p ON p.task_id=t.id WHERE t.workspace_id=$1 AND t.status NOT IN ('completed','cancelled') AND t.due_at::timestamptz <= now()+$2::integer*interval '1 hour'`,
            [config.workspace_id, hours],
          )
        ).rows;
        for (const task of tasks)
          await notify(
            client,
            config.workspace_id,
            task.assignee_user_id,
            `reminder:task:${task.id}:${task.updated_at}`,
            "task_reminder",
            task.id,
          );
        const events = (
          await client.query(
            `SELECT e.*,p.linked_user_id FROM practice_events e JOIN practice_matters m ON m.case_id=e.case_id JOIN practice_contacts p ON p.contact_id=m.contact_id AND p.workspace_id=m.workspace_id WHERE e.workspace_id=$1 AND e.status='confirmed' AND e.starts_at>now() AND e.starts_at<=now()+$2::integer*interval '1 hour'`,
            [config.workspace_id, hours],
          )
        ).rows;
        for (const event of events) {
          const key = `reminder:event:${event.id}:${event.revision}`;
          await notify(
            client,
            config.workspace_id,
            event.organizer_user_id,
            key,
            "consultation_reminder",
            event.id,
          );
          if (event.client_visible && event.linked_user_id)
            await notify(
              client,
              config.workspace_id,
              event.linked_user_id,
              key,
              "consultation_reminder",
              event.id,
            );
        }
        const invoices = (
          await client.query(
            `SELECT i.id,p.linked_user_id,m.responsible_user_id FROM practice_invoices i JOIN practice_matters m ON m.case_id=i.case_id JOIN practice_contacts p ON p.contact_id=m.contact_id AND p.workspace_id=m.workspace_id WHERE i.workspace_id=$1 AND i.due_on<=(now() AT TIME ZONE 'Asia/Tashkent')::date AND i.total_minor>(SELECT coalesce(sum(amount_minor),0) FROM practice_payments WHERE invoice_id=i.id)`,
            [config.workspace_id],
          )
        ).rows;
        for (const invoice of invoices)
          for (const userId of new Set(
            [invoice.linked_user_id, invoice.responsible_user_id].filter(
              Boolean,
            ),
          ))
            await notify(
              client,
              config.workspace_id,
              userId,
              `reminder:invoice:${invoice.id}`,
              "invoice_reminder",
              invoice.id,
            );
      }
      const services = (
        await client.query(
          `SELECT * FROM practice_recurring_services WHERE workspace_id=$1 AND active AND next_on<=(now() AT TIME ZONE 'Asia/Tashkent')::date FOR UPDATE`,
          [config.workspace_id],
        )
      ).rows;
      for (const service of services) {
        await client.query("SAVEPOINT recurring_service");
        try {
          const actor = await practiceActor(
            client,
            service.created_by,
            config.workspace_id,
            true,
          );
          await requireCase(client, actor, service.case_id, "finance");
          if (!["owner", "admin", "lawyer", "accountant"].includes(actor.role))
            continue;
          if (!String(config.provider_details.name ?? "").trim()) continue;
          const period = new Date(service.next_on).toISOString().slice(0, 10);
          const prior = (
            await client.query(
              `SELECT 1 FROM practice_recurring_runs WHERE service_id=$1 AND period_on=$2`,
              [service.id, period],
            )
          ).rows[0];
          if (!prior) {
            const customer = (
              await client.query(
                `SELECT c.full_name AS name,p.requisites FROM practice_matters m JOIN practice_contacts p ON p.contact_id=m.contact_id AND p.workspace_id=m.workspace_id JOIN contacts c ON c.id=p.contact_id WHERE m.case_id=$1`,
                [service.case_id],
              )
            ).rows[0];
            const id = crypto.randomUUID();
            await insertInvoice(client, actor, {
              id,
              language: service.language,
              caseId: service.case_id,
              number: `R-${service.id.slice(0, 8)}-${period}`,
              issuedOn: period,
              dueOn: period,
              currency: service.currency,
              lines: [
                {
                  description: service.description,
                  quantity: 1,
                  unitMinor: service.amount_minor,
                  totalMinor: service.amount_minor,
                },
              ],
              total: service.amount_minor,
              provider: config.provider_details,
              customer,
            });
            await client.query(
              `INSERT INTO practice_recurring_runs(service_id,period_on,invoice_id) VALUES($1,$2,$3)`,
              [service.id, period, id],
            );
          }
          await client.query(
            `UPDATE practice_recurring_services SET next_on=(next_on+interval '1 month'*interval_months)::date WHERE id=$1`,
            [service.id],
          );
          await client.query("RELEASE SAVEPOINT recurring_service");
        } catch {
          await client.query("ROLLBACK TO SAVEPOINT recurring_service");
          await client.query("RELEASE SAVEPOINT recurring_service");
        }
      }
    }
    await client.query(`DELETE FROM practice_imports WHERE expires_at<now()`);
    await client.query(
      `DELETE FROM practice_oauth_states WHERE expires_at<now()`,
    );
  });
  // A provider failure is recorded per integration and never reported as a successful delivery.
  const connections = (
    await database().pool.query(
      `SELECT c.id,c.workspace_id,c.user_id FROM practice_calendar_connections c JOIN practice_workspaces w ON w.workspace_id=c.workspace_id WHERE w.enabled AND c.calendar_id IS NOT NULL AND c.state<>'reauth_required' LIMIT 50`,
    )
  ).rows;
  for (const conn of connections) {
    try {
      await transaction(async (client) => {
        const actor = await practiceActor(
          client,
          conn.user_id,
          conn.workspace_id,
          true,
        );
        await syncGoogle(client, actor);
      });
    } catch (error) {
      const code = (error as { code?: string }).code ?? "GOOGLE_SYNC_FAILED";
      await database().pool.query(
        `UPDATE practice_calendar_connections SET last_error=$2,state=CASE WHEN $2='GOOGLE_REAUTH_REQUIRED' THEN 'reauth_required' ELSE state END WHERE id=$1`,
        [conn.id, code],
      );
    }
  }
  await dispatchPracticeMail();
}
async function dispatchPracticeMail() {
  const env = runtimeEnv();
  for (let i = 0; i < 50; i++) {
    const claimed = await transaction(async (client) => {
      const row = (
        await client.query(`SELECT n.*,w.settings,p.locale FROM practice_notifications n JOIN practice_workspaces w ON w.workspace_id=n.workspace_id JOIN user_profiles p ON p.id=n.user_id
        WHERE n.email_state IN ('pending','retry','not_configured','sending') AND n.next_attempt_at<=now() AND w.enabled AND n.attempts<5 AND n.created_at>now()-interval '23 hours'
        ORDER BY n.created_at FOR UPDATE OF n SKIP LOCKED LIMIT 1`)
      ).rows[0];
      if (!row) return null;
      await client.query(
        `UPDATE practice_notifications SET email_state='sending',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE id=$1`,
        [row.id],
      );
      return row;
    });
    if (!claimed) break;
    let state = "sent",
      errorCode: string | null = null;
    try {
      // Recheck membership/client grants before resolving or sending an email.
      await transaction(async (client) => {
        await practiceActor(client, claimed.user_id, claimed.workspace_id);
      });
      if (claimed.settings.email === false) state = "disabled";
      else if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
        state = "not_configured";
        errorCode = "EMAIL_NOT_CONFIGURED";
      } else {
        const recipient = await userIdentityById(
          requireD1(),
          runtimeIdentityProtection(),
          claimed.user_id,
        );
        if (!recipient) throw new Error("recipient unavailable");
        const copy = {
          ru: [
            "Обновление JURO Practice",
            "У вас есть новое уведомление. Откройте защищённый кабинет JURO Practice.",
          ],
          uz: [
            "JURO Practice yangilanishi",
            "Sizda yangi bildirishnoma bor. Himoyalangan JURO Practice kabinetini oching.",
          ],
          en: [
            "JURO Practice update",
            "You have a new notification. Open your secure JURO Practice workspace.",
          ],
        }[claimed.locale as "ru" | "uz" | "en"] ?? [
          "JURO Practice",
          "Open JURO Practice.",
        ];
        const response = await sendEmailRequest({
          method: "POST",
          headers: {
            authorization: `Bearer ${env.RESEND_API_KEY}`,
            "content-type": "application/json",
            "idempotency-key": `juro_practice_${claimed.id}`,
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: [recipient.email],
            subject: copy[0],
            text: copy[1],
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("delivery rejected");
        const payload = await response.json();
        if (!payload.id) throw new Error("delivery unconfirmed");
        state =
          process.env.EMAIL_DELIVERY_MODE === "capture" ||
          (process.env.PRIVATE_DEVELOPMENT === "true" &&
            !process.env.EMAIL_DELIVERY_MODE)
            ? "captured"
            : "sent";
      }
    } catch {
      state = claimed.attempts >= 4 ? "failed" : "retry";
      errorCode = "EMAIL_DELIVERY_FAILED";
    }
    await database().pool.query(
      `UPDATE practice_notifications SET email_state=$2,error_code=$3,next_attempt_at=now()+interval '1 hour' WHERE id=$1`,
      [claimed.id, state, errorCode],
    );
  }
  await database().pool.query(
    `UPDATE practice_notifications SET email_state='unconfirmed',error_code='EMAIL_RETRY_WINDOW_EXPIRED' WHERE email_state IN ('pending','retry','sending','not_configured') AND created_at<=now()-interval '23 hours'`,
  );
}
