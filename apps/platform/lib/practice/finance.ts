import type { PoolClient } from "pg";
import { applyBasisPoints } from "../billing/money";
import { audit, notify, requireCase } from "./access";
import {
  isFinance,
  minorUnits,
  PracticeError,
  safeSum,
  type Actor,
  type Command,
  type Locale,
} from "./domain";

export async function financeCommand(
  client: PoolClient,
  actor: Actor,
  command: Command,
): Promise<object | undefined> {
  if (
    !/^(invoice\.|payment\.|expense\.|time\.|recurring\.|fx\.)/.test(
      command.action,
    )
  )
    return;
  if (!isFinance(actor)) throw new PracticeError("ACCESS_DENIED", 403);
  const id = crypto.randomUUID();
  switch (command.action) {
    case "invoice.create": {
      const matter = await requireCase(
        client,
        actor,
        command.caseId,
        "finance",
      );
      if (
        command.dueOn < command.issuedOn ||
        !String(command.provider.name ?? "").trim()
      )
        throw new PracticeError("INVALID_INVOICE");
      if (command.documentId) {
        const doc = (
          await client.query(
            `SELECT document_id FROM practice_documents WHERE document_id=$1 AND workspace_id=$2 AND case_id=$3`,
            [command.documentId, actor.workspaceId, command.caseId],
          )
        ).rows[0];
        if (!doc) throw new PracticeError("NOT_FOUND", 404);
      }
      let stage: { id: string; name: string } | undefined;
      if (command.stageId) {
        const pipeline = (
          await client.query(
            `SELECT stages FROM practice_pipelines WHERE workspace_id=$1 AND id=$2`,
            [actor.workspaceId, matter.pipeline_id],
          )
        ).rows[0];
        stage = pipeline.stages.find(
          (value: { id: string }) => value.id === command.stageId,
        );
        if (!stage) throw new PracticeError("INVALID_STAGE");
      }
      const lines = command.lines.map((line) => {
        const unitMinor = minorUnits(line.unitPrice, command.currency),
          totalMinor = Number(BigInt(unitMinor) * BigInt(line.quantity));
        if (!Number.isSafeInteger(totalMinor))
          throw new PracticeError("INVALID_MONEY");
        return {
          description: line.description,
          quantity: line.quantity,
          unitMinor,
          totalMinor,
          ...(stage ? { stageId: stage.id, stageName: stage.name } : {}),
        };
      });
      const total = safeSum(lines.map((line) => line.totalMinor));
      const customer = (
        await client.query(
          `SELECT c.full_name AS name,p.email,c.phone,p.company_name,p.requisites FROM practice_matters m JOIN practice_contacts p ON p.contact_id=m.contact_id AND p.workspace_id=m.workspace_id JOIN contacts c ON c.id=p.contact_id WHERE m.case_id=$1 AND m.workspace_id=$2`,
          [command.caseId, actor.workspaceId],
        )
      ).rows[0];
      await insertInvoice(client, actor, {
        id,
        language: command.language,
        caseId: command.caseId,
        documentId: command.documentId,
        number: command.number,
        issuedOn: command.issuedOn,
        dueOn: command.dueOn,
        currency: command.currency,
        lines,
        total,
        provider: command.provider,
        customer,
      });
      await audit(client, actor, "invoice", id, command.action);
      return { id, totalMinor: total };
    }
    case "payment.confirm": {
      const invoice = await invoiceAllowed(client, actor, command.invoiceId);
      const amount = minorUnits(command.amount, invoice.currency);
      if (!amount) throw new PracticeError("INVALID_MONEY");
      if (command.evidenceFileId) {
        const file = (
          await client.query(
            `SELECT file_id FROM practice_files WHERE file_id=$1 AND case_id=$2 AND purpose='payment_evidence'`,
            [command.evidenceFileId, invoice.case_id],
          )
        ).rows[0];
        if (!file) throw new PracticeError("NOT_FOUND", 404);
      }
      await client.query(
        `INSERT INTO practice_payments(id,workspace_id,invoice_id,amount_minor,currency,received_on,method,note,evidence_file_id,confirmed_by,fx_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          actor.workspaceId,
          invoice.id,
          amount,
          invoice.currency,
          command.receivedOn,
          command.method,
          command.note,
          command.evidenceFileId ?? null,
          actor.userId,
          JSON.stringify(
            await fxSnapshot(
              client,
              actor.workspaceId,
              invoice.currency,
              command.receivedOn,
            ),
          ),
        ],
      );
      const matter = await requireCase(
        client,
        actor,
        invoice.case_id,
        "finance",
      );
      const rule = (
        await client.query(
          `SELECT * FROM practice_commission_rules WHERE source=$1 AND plan_code=$2 AND service_type=$3 ORDER BY version DESC LIMIT 1`,
          [matter.source, actor.planCode, matter.service_type],
        )
      ).rows[0];
      if (rule?.active)
        await postCommission(
          client,
          id,
          rule,
          amount,
          applyBasisPoints(amount, rule.rate_bps),
        );
      await audit(client, actor, "payment", id, command.action, {
        invoiceId: invoice.id,
      });
      return { id, ...(await invoiceBalance(client, invoice.id)) };
    }
    case "payment.reverse":
    case "payment.refund": {
      const original = (
        await client.query(
          `SELECT * FROM practice_payments WHERE id=$1 AND workspace_id=$2 AND amount_minor>0 FOR UPDATE`,
          [command.paymentId, actor.workspaceId],
        )
      ).rows[0];
      if (!original) throw new PracticeError("NOT_FOUND", 404);
      const invoice = await invoiceAllowed(client, actor, original.invoice_id);
      const corrections = (
        await client.query(
          `SELECT coalesce(sum(amount_minor),0)::bigint AS amount FROM practice_payments WHERE reverses_id=$1 OR refund_of_id=$1`,
          [original.id],
        )
      ).rows[0].amount;
      const remaining = safeSum([original.amount_minor, corrections]);
      const amount =
        command.action === "payment.reverse"
          ? remaining
          : minorUnits(command.amount, original.currency);
      if (amount <= 0 || amount > remaining)
        throw new PracticeError("INVALID_REFUND", 409);
      await client.query(
        `INSERT INTO practice_payments(id,workspace_id,invoice_id,amount_minor,currency,received_on,method,note,reverses_id,refund_of_id,confirmed_by,fx_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          actor.workspaceId,
          invoice.id,
          -amount,
          original.currency,
          command.receivedOn,
          command.action === "payment.reverse" ? "correction" : "refund",
          command.reason,
          command.action === "payment.reverse" ? original.id : null,
          command.action === "payment.refund" ? original.id : null,
          actor.userId,
          JSON.stringify(original.fx_snapshot),
        ],
      );
      const commission = (
        await client.query(
          `SELECT * FROM practice_commissions WHERE payment_id=$1`,
          [original.id],
        )
      ).rows[0];
      if (commission) {
        const oldFee = applyBasisPoints(remaining, commission.rate_bps),
          newFee = applyBasisPoints(remaining - amount, commission.rate_bps);
        await postCommission(
          client,
          id,
          {
            id: commission.rule_id,
            version: commission.rule_version,
            rate_bps: commission.rate_bps,
          },
          -amount,
          newFee - oldFee,
        );
      }
      await audit(client, actor, "payment", id, command.action, {
        originalId: original.id,
      });
      return { id, ...(await invoiceBalance(client, invoice.id)) };
    }
    case "expense.create": {
      await requireCase(client, actor, command.caseId, "finance");
      const amount = minorUnits(command.amount, command.currency);
      if (!amount) throw new PracticeError("INVALID_MONEY");
      await client.query(
        `INSERT INTO practice_expenses(id,workspace_id,case_id,amount_minor,currency,incurred_on,paid,description,recorded_by,fx_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          actor.workspaceId,
          command.caseId,
          amount,
          command.currency,
          command.incurredOn,
          command.paid,
          command.description,
          actor.userId,
          JSON.stringify(
            await fxSnapshot(
              client,
              actor.workspaceId,
              command.currency,
              command.incurredOn,
            ),
          ),
        ],
      );
      await audit(client, actor, "expense", id, command.action);
      return { id };
    }
    case "time.create": {
      if (actor.role === "accountant")
        throw new PracticeError("ACCESS_DENIED", 403);
      await requireCase(client, actor, command.caseId);
      await client.query(
        `INSERT INTO practice_time_entries(id,case_id,user_id,minutes,hourly_minor,currency,worked_on,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          command.caseId,
          actor.userId,
          command.minutes,
          minorUnits(command.hourlyRate, command.currency),
          command.currency,
          command.workedOn,
          command.description,
        ],
      );
      await audit(client, actor, "time", id, command.action);
      return { id };
    }
    case "time.invoice": {
      if (
        command.dueOn < command.issuedOn ||
        !String(command.provider.name ?? "").trim()
      )
        throw new PracticeError("INVALID_INVOICE");
      const rows = (
        await client.query(
          `SELECT t.* FROM practice_time_entries t JOIN practice_matters m ON m.case_id=t.case_id WHERE t.id=ANY($1::text[]) AND m.workspace_id=$2 FOR UPDATE OF t`,
          [command.timeEntryIds, actor.workspaceId],
        )
      ).rows;
      if (
        rows.length !== new Set(command.timeEntryIds).size ||
        rows.some(
          (row) =>
            row.invoice_id ||
            row.case_id !== rows[0].case_id ||
            row.currency !== rows[0].currency,
        )
      )
        throw new PracticeError("INVALID_TIME_INVOICE", 409);
      await requireCase(client, actor, rows[0].case_id, "finance");
      const lines = rows.map((row) => {
        const amount = Number(
          (BigInt(row.hourly_minor) * BigInt(row.minutes) + 30n) / 60n,
        );
        if (!Number.isSafeInteger(amount))
          throw new PracticeError("INVALID_MONEY");
        return {
          description: row.description,
          quantity: 1,
          unitMinor: amount,
          totalMinor: amount,
          timeEntryId: row.id,
          minutes: row.minutes,
          hourlyMinor: row.hourly_minor,
        };
      });
      const customer = (
        await client.query(
          `SELECT c.full_name AS name,p.requisites FROM practice_matters m JOIN practice_contacts p ON p.contact_id=m.contact_id AND p.workspace_id=m.workspace_id JOIN contacts c ON c.id=p.contact_id WHERE m.case_id=$1`,
          [rows[0].case_id],
        )
      ).rows[0];
      await insertInvoice(client, actor, {
        id,
        language: command.language,
        caseId: rows[0].case_id,
        number: command.number,
        issuedOn: command.issuedOn,
        dueOn: command.dueOn,
        currency: rows[0].currency,
        lines,
        total: safeSum(lines.map((line) => line.totalMinor)),
        provider: command.provider,
        customer,
      });
      await client.query(
        `UPDATE practice_time_entries SET invoice_id=$2 WHERE id=ANY($1::text[])`,
        [command.timeEntryIds, id],
      );
      await audit(client, actor, "invoice", id, command.action, {
        timeEntryIds: command.timeEntryIds,
      });
      return { id };
    }
    case "recurring.create": {
      await requireCase(client, actor, command.caseId, "finance");
      const amount = minorUnits(command.amount, command.currency);
      if (!amount) throw new PracticeError("INVALID_MONEY");
      await client.query(
        `INSERT INTO practice_recurring_services(id,workspace_id,case_id,amount_minor,currency,description,next_on,interval_months,created_by,language) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          actor.workspaceId,
          command.caseId,
          amount,
          command.currency,
          command.description,
          command.nextOn,
          command.intervalMonths,
          actor.userId,
          command.language,
        ],
      );
      await audit(client, actor, "service", id, command.action);
      return { id };
    }
    case "recurring.toggle": {
      const service = (
        await client.query(
          `SELECT * FROM practice_recurring_services WHERE id=$1 AND workspace_id=$2 FOR UPDATE`,
          [command.serviceId, actor.workspaceId],
        )
      ).rows[0];
      if (!service) throw new PracticeError("NOT_FOUND", 404);
      await requireCase(client, actor, service.case_id, "finance");
      await client.query(
        `UPDATE practice_recurring_services SET active=$2 WHERE id=$1`,
        [service.id, command.active],
      );
      return { ok: true };
    }
    case "fx.save": {
      if (
        !(Number(command.rate) > 0) ||
        command.currency === command.baseCurrency
      )
        throw new PracticeError("INVALID_RATE");
      await client.query(
        `INSERT INTO practice_fx_rates(workspace_id,currency,base_currency,rate,rate_on,recorded_by) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          actor.workspaceId,
          command.currency,
          command.baseCurrency,
          command.rate,
          command.rateOn,
          actor.userId,
        ],
      );
      await audit(client, actor, "fx", command.currency, command.action);
      return { ok: true };
    }
  }
}

export async function invoiceAllowed(
  client: PoolClient,
  actor: Actor,
  invoiceId: string,
) {
  const invoice = (
    await client.query(
      `SELECT * FROM practice_invoices WHERE id=$1 AND workspace_id=$2`,
      [invoiceId, actor.workspaceId],
    )
  ).rows[0];
  if (!invoice) throw new PracticeError("NOT_FOUND", 404);
  await requireCase(client, actor, invoice.case_id, "finance");
  return invoice;
}
export async function invoiceBalance(client: PoolClient, invoiceId: string) {
  const row = (
    await client.query(
      `SELECT i.total_minor,coalesce(sum(p.amount_minor),0)::bigint AS paid_minor FROM practice_invoices i LEFT JOIN practice_payments p ON p.invoice_id=i.id WHERE i.id=$1 GROUP BY i.id`,
      [invoiceId],
    )
  ).rows[0];
  return {
    totalMinor: row.total_minor,
    paidMinor: row.paid_minor,
    outstandingMinor: Math.max(0, row.total_minor - row.paid_minor),
    creditMinor: Math.max(0, row.paid_minor - row.total_minor),
  };
}
async function postCommission(
  client: PoolClient,
  paymentId: string,
  rule: { id: string; version: number; rate_bps: number },
  base: number,
  amount: number,
) {
  await client.query(
    `INSERT INTO practice_commissions(id,payment_id,rule_id,rule_version,base_minor,rate_bps,amount_minor) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      crypto.randomUUID(),
      paymentId,
      rule.id,
      rule.version,
      base,
      rule.rate_bps,
      amount,
    ],
  );
}
async function fxSnapshot(
  client: PoolClient,
  workspaceId: string,
  currency: string,
  on: string,
) {
  const config = (
    await client.query(
      `SELECT settings FROM practice_workspaces WHERE workspace_id=$1`,
      [workspaceId],
    )
  ).rows[0];
  const base = config?.settings?.baseCurrency;
  if (!base) return {};
  if (base === currency) return { baseCurrency: base, rate: "1", rateOn: on };
  const rate = (
    await client.query(
      `SELECT rate::text,rate_on::text FROM practice_fx_rates WHERE workspace_id=$1 AND currency=$2 AND base_currency=$3 AND rate_on<=$4 ORDER BY rate_on DESC LIMIT 1`,
      [workspaceId, currency, base, on],
    )
  ).rows[0];
  return rate
    ? { baseCurrency: base, rate: rate.rate, rateOn: rate.rate_on }
    : { baseCurrency: base, missing: true };
}
export async function insertInvoice(
  client: PoolClient,
  actor: Actor,
  value: {
    id: string;
    language?: Locale;
    caseId: string;
    documentId?: string;
    number: string;
    issuedOn: string;
    dueOn: string;
    currency: string;
    lines: object[];
    total: number;
    provider: object;
    customer: object;
  },
) {
  await client.query(
    `INSERT INTO practice_invoices(id,workspace_id,case_id,document_id,number,issued_on,due_on,currency,lines,total_minor,provider_snapshot,customer_snapshot,issued_by,fx_snapshot,language)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      value.id,
      actor.workspaceId,
      value.caseId,
      value.documentId ?? null,
      value.number,
      value.issuedOn,
      value.dueOn,
      value.currency,
      JSON.stringify(value.lines),
      value.total,
      JSON.stringify(value.provider),
      JSON.stringify(value.customer),
      actor.userId,
      JSON.stringify(
        await fxSnapshot(
          client,
          actor.workspaceId,
          value.currency,
          value.issuedOn,
        ),
      ),
      value.language ?? "ru",
    ],
  );
  const contact = (
    await client.query(
      `SELECT p.linked_user_id FROM practice_matters m JOIN practice_contacts p ON p.workspace_id=m.workspace_id AND p.contact_id=m.contact_id WHERE m.case_id=$1`,
      [value.caseId],
    )
  ).rows[0];
  if (contact?.linked_user_id)
    await notify(
      client,
      actor.workspaceId,
      contact.linked_user_id,
      `invoice:${value.id}`,
      "invoice",
      value.id,
    );
}
