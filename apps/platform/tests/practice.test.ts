import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import { minorUnits, invoiceStatus } from "../lib/practice/money";
import { sanitizeHtml, importDocx, contentText } from "../lib/practice/content";
import { parseImport, csvExport } from "../lib/practice/import";
import { database, closeRuntimeDatabases } from "../lib/storage/connection";
import { practiceHttp } from "../lib/practice/http";
import { initializePractice } from "../lib/practice/crm";
import {
  practiceActor,
  transaction,
  legacyPracticeAccessDenied,
} from "../lib/practice/access";
import { createEmailOtpSession } from "../lib/auth/session-management";
import { SESSION_COOKIE } from "../lib/auth/session-token";
import { LocalObjectStore } from "../lib/storage/objects";
import { exportDocx, exportPdf } from "../lib/practice/export";
import {
  oauthStart,
  oauthCallback,
  syncGoogle,
  resolveGoogleConflict,
} from "../lib/practice/calendar";
import { localEmailCapture } from "../lib/runtime/email";
import { runPracticeJobs } from "../lib/practice/jobs";
import { env } from "./helpers/runtime-env";

test("Practice money preserves decimal amounts and rejects precision loss", () => {
  assert.equal(minorUnits("0.10", "UZS") + minorUnits("0.20", "UZS"), 30);
  assert.equal(minorUnits("123.456", "KWD"), 123456);
  assert.equal(minorUnits("123", "JPY"), 123);
  assert.throws(() => minorUnits("1.001", "USD"));
  assert.throws(() => minorUnits("9007199254740992", "UZS"));
  assert.equal(
    invoiceStatus(90000, 30000, "2026-10-31", "2026-10-15"),
    "partial",
  );
});
test("Practice document and import boundaries keep structure and reject active content", async () => {
  const clean = sanitizeHtml(
    '<h1>Договор · Shartnoma</h1><script>secret()</script><p onclick="bad()"><strong>Text</strong></p><table><tr><td>Bir</td><td>Два</td></tr></table>',
  );
  assert.ok(!clean.includes("script") && !clean.includes("onclick"));
  const docx = await exportDocx(clean, "Practice test", "uz");
  const parsed = importDocx(docx);
  assert.match(parsed.html, /<table>/);
  assert.match(contentText(parsed.html), /Два/);
  const archive = new PizZip(docx);
  archive.file("word/vbaProject.bin", "fake macro");
  assert.throws(() => importDocx(archive.generate({ type: "uint8array" })));
  const csv = parseImport(
    "clients.csv",
    new TextEncoder().encode(
      'name,email\n"Компания, A",a@example.test\n"Line\nTwo",b@example.test',
    ),
  );
  assert.equal(csv.rows.length, 2);
  assert.equal(csv.rows[0][0], "Компания, A");
  assert.match(csvExport([{ name: "=HYPERLINK(1)" }]), /'=HYPERLINK/);
  const xlsx = new PizZip();
  xlsx.file(
    "xl/workbook.xml",
    '<workbook><sheets><sheet name="Data" sheetId="2" r:id="rId2"/></sheets></workbook>',
  );
  xlsx.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
  );
  xlsx.file(
    "xl/worksheets/sheet2.xml",
    '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>email</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>O‘zbek — Клиент</t></is></c><c r="B2"><f>HYPERLINK()</f><v>123</v></c></row></sheetData></worksheet>',
  );
  const sheet = parseImport("test.xlsx", xlsx.generate({ type: "uint8array" }));
  assert.equal(sheet.rows[0][0], "O‘zbek — Клиент");
  assert.equal(sheet.rows[0][1], "");
  const pdf = await exportPdf(
    clean +
      Array(100)
        .fill("<p>Русский текст. O‘zbekcha shartnoma. English legal draft.</p>")
        .join(""),
    "Multilingual pagination",
    "en",
  );
  assert.ok((await PDFDocument.load(pdf)).getPageCount() > 1);
});

test(
  "Practice authenticated pilot: client, case, review, signed PDF, invoice, partial payment and isolation",
  { skip: !process.env.PRACTICE_TEST_DATABASE_URL, timeout: 180000 },
  async (t) => {
    const connection = new URL(process.env.PRACTICE_TEST_DATABASE_URL!);
    assert.ok(["127.0.0.1", "localhost"].includes(connection.hostname));
    assert.match(
      connection.pathname,
      /^\/juro_practice_verification(?:_\w+)?$/,
    );
    process.env.DATABASE_URL = connection.href;
    process.env.PRACTICE_ENABLED = "true";
    process.env.PRIVATE_DEVELOPMENT = "true";
    process.env.EMAIL_DELIVERY_MODE = "capture";
    const db = database(),
      pool = db.pool,
      root = await mkdtemp(join(tmpdir(), "juro-practice-test-"));
    Object.assign(env, {
      DB: db,
      IDENTITY_PROTECTION_MODE: "legacy",
      BUCKET: new LocalObjectStore(pool, root, "practice-test"),
      QUARANTINE_BUCKET: new LocalObjectStore(
        pool,
        root,
        "practice-quarantine-test",
      ),
      EMAIL_DELIVERY: localEmailCapture,
      RESEND_API_KEY: "local-capture",
      EMAIL_FROM: "test@localhost",
      MALWARE_SCAN_ENABLED: "true",
      MALWARE_SCANNER: {
        async fetch(_url: string, init: RequestInit) {
          const source = new Request("http://scanner.test", {
            ...init,
            duplex: "half",
          } as RequestInit);
          await source.arrayBuffer();
          return Response.json({
            schemaVersion: 1,
            verdict: "clean",
            provider: "synthetic-test",
            engine: "fixture",
            engineVersion: "1",
            signatureVersion: "1",
            scanId: crypto.randomUUID(),
            sourceSha256: source.headers.get("x-content-sha256"),
            threats: [],
            completedAt: new Date().toISOString(),
          });
        },
      },
    });
    const users = Object.fromEntries(
        [
          "owner",
          "lawyer",
          "otherLawyer",
          "assistant",
          "accountant",
          "client",
          "stranger",
        ].map((role) => [role, crypto.randomUUID()]),
      ),
      ws = `ws_${crypto.randomUUID().replaceAll("-", "")}`,
      otherWs = `ws_${crypto.randomUUID().replaceAll("-", "")}`,
      now = new Date().toISOString();
    const sessions: Record<string, string> = {};
    async function request(
      role: string,
      path: string,
      input?: unknown,
      expected = 200,
      key = crypto.randomUUID(),
      form?: FormData,
    ) {
      const response = await practiceHttp(
        new Request(
          `http://localhost:3000/api/practice/${path}${path.includes("?") ? "&" : "?"}workspaceId=${ws}`,
          {
            method: input !== undefined || form ? "POST" : "GET",
            headers: {
              cookie: `${SESSION_COOKIE}=${sessions[role]}`,
              "x-juro-csrf": "1",
              "idempotency-key": key,
              origin: "http://localhost:3000",
              ...(form ? {} : { "content-type": "application/json" }),
            },
            ...(form
              ? { body: form }
              : input !== undefined
                ? { body: JSON.stringify(input) }
                : {}),
          },
        ),
        path.split("?")[0].split("/"),
      );
      const result = response.headers
        .get("content-type")
        ?.includes("application/json")
        ? await response.json()
        : new Uint8Array(await response.arrayBuffer());
      assert.equal(response.status, expected, JSON.stringify(result));
      return result;
    }
    try {
      await pool.query(
        `INSERT INTO workspaces(id,type,name,full_name,short_name,locale,created_at,updated_at) VALUES($1,'business','Synthetic Practice firm','Synthetic Practice firm','Synthetic','ru',$3,$3),($2,'business','Other synthetic firm','Other synthetic firm','Other','ru',$3,$3)`,
        [ws, otherWs, now],
      );
      for (const [role, id] of Object.entries(users)) {
        const workspace = role === "stranger" ? otherWs : ws;
        await pool.query(
          `INSERT INTO user_profiles(id,email,full_name,locale,account_type,timezone,default_workspace_id,email_verified_at,created_at,updated_at) VALUES($1,$2,$3,'ru','lawyer','Asia/Tashkent',$4,$5,$5,$5)`,
          [id, `${id}@example.test`, `Synthetic ${role}`, workspace, now],
        );
        if (role !== "client")
          await pool.query(
            `INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES($1,$2,$3,$4,'active',$5,$5,$5)`,
            [
              crypto.randomUUID(),
              workspace,
              id,
              role === "stranger"
                ? "owner"
                : role === "otherLawyer"
                  ? "lawyer"
                  : role,
              now,
            ],
          );
        const session = await createEmailOtpSession(
          db as unknown as D1Database,
          { userId: id, userAgent: "Practice integration test" },
        );
        sessions[role] = session.token;
      }
      await pool.query(
        `INSERT INTO practice_workspaces(workspace_id,enabled,pilot_until,settings,provider_details,granted_by) VALUES($1,true,now()+interval '1 day','{"email":true,"reminders":true}','{"name":"Synthetic legal firm","details":"Test details"}',$2)`,
        [ws, users.owner],
      );
      await transaction((client) => initializePractice(client, ws, "ru"));
      await request("client", "bootstrap", undefined, 403);
      const contact = await request("lawyer", "commands", {
        action: "contact.create",
        name: "Синтетический клиент — O‘zbek",
        kind: "person",
      });
      const source = `synthetic:${ws}`;
      const matter = await request("lawyer", "commands", {
        action: "case.create",
        title: "Синтетическое дело",
        description: "Internal confidential circumstances",
        contactId: contact.id,
        pipelineId: `${ws}:pipeline:0`,
        stageId: "new",
        source,
        responsibleUserId: users.lawyer,
      });
      await request("owner", "commands", {
        action: "case.assign",
        caseId: matter.id,
        userIds: [users.lawyer, users.assistant],
      });
      const invitation = await request("owner", "commands", {
        action: "invitation.create",
        contactId: contact.id,
      });
      await request("client", "invitation/accept", { token: invitation.token });
      await request("client", "bootstrap", undefined, 403);
      await request("owner", "commands", {
        action: "invitation.confirm",
        invitationId: invitation.id,
      });
      await request("client", "bootstrap");
      await request("lawyer", "commands", {
        action: "entry.create",
        caseId: matter.id,
        kind: "note",
        body: "secret internal note",
        clientVisible: false,
      });
      await request("lawyer", "commands", {
        action: "entry.create",
        caseId: matter.id,
        kind: "message",
        body: "Published message",
        clientVisible: true,
      });
      assert.equal(
        (await request("client", `entries?caseId=${matter.id}`)).items.length,
        1,
      );
      assert.ok(
        !JSON.stringify(
          await request("client", `cases?caseId=${matter.id}`),
        ).includes("confidential"),
      );
      const doc = await request("lawyer", "commands", {
        action: "document.create",
        caseId: matter.id,
        title: "Договор — Shartnoma — Agreement",
        language: "uz",
        content:
          "<h1>Договор — Shartnoma</h1><p>Client version 1</p><table><tr><td>Услуги</td><td>UZS</td></tr></table>",
      });
      await request("client", `document?documentId=${doc.id}`, undefined, 404);
      let revision = (
        await request("lawyer", "commands", {
          action: "document.transition",
          documentId: doc.id,
          revision: 1,
          state: "review",
        })
      ).revision;
      const proposal = await request("client", "commands", {
        action: "document.review",
        documentId: doc.id,
        revision,
        kind: "proposal",
        body: "Please change scope",
        proposal:
          "<h1>Келишув — O‘zbek</h1><p>Agreed scope</p><table><tr><td>Услуги</td><td>900 UZS</td></tr></table>",
      });
      revision = (
        await request("lawyer", "commands", {
          action: "document.resolve",
          documentId: doc.id,
          revision,
          reviewId: proposal.id,
          accept: true,
        })
      ).revision;
      revision = (
        await request("lawyer", "commands", {
          action: "document.transition",
          documentId: doc.id,
          revision,
          state: "review",
        })
      ).revision;
      await request("client", "commands", {
        action: "document.review",
        documentId: doc.id,
        revision,
        kind: "approval",
        body: "Approved",
      });
      revision = (
        await request("lawyer", "commands", {
          action: "document.transition",
          documentId: doc.id,
          revision,
          state: "agreed",
        })
      ).revision;
      await request(
        "lawyer",
        "commands",
        {
          action: "document.save",
          documentId: doc.id,
          revision,
          content: "<p>silently replaced</p>",
        },
        409,
      );
      revision = (
        await request("lawyer", "commands", {
          action: "document.transition",
          documentId: doc.id,
          revision,
          state: "awaiting_signed",
        })
      ).revision;
      const pdf = await request(
          "lawyer",
          `export/document/${doc.id}?format=pdf`,
        ),
        docx = await request("lawyer", `export/document/${doc.id}?format=docx`);
      assert.ok((await PDFDocument.load(pdf)).getPageCount() > 0);
      assert.match(
        new PizZip(docx).file("word/document.xml")!.asText(),
        /<w:tbl>/,
      );
      const approved = (
        await request("lawyer", `document?documentId=${doc.id}`)
      ).document.agreed_version_id;
      const signed = new FormData();
      signed.set(
        "file",
        new File([pdf], "synthetic-signed.pdf", { type: "application/pdf" }),
      );
      signed.set("caseId", matter.id);
      signed.set("documentId", doc.id);
      signed.set("purpose", "signed");
      signed.set("versionId", approved);
      signed.set("clientVisible", "true");
      const file = await request(
        "client",
        "uploads",
        undefined,
        200,
        crypto.randomUUID(),
        signed,
      );
      await request(
        "client",
        "commands",
        {
          action: "document.transition",
          documentId: doc.id,
          revision,
          state: "signed_confirmed",
          signedFileId: file.id,
        },
        403,
      );
      revision = (
        await request("lawyer", "commands", {
          action: "document.transition",
          documentId: doc.id,
          revision,
          state: "signed_confirmed",
          signedFileId: file.id,
        })
      ).revision;
      await request("client", `files/${file.id}`);
      await request("accountant", `files/${file.id}`, undefined, 403);
      await request("stranger", `files/${file.id}`, undefined, 403);
      await request(
        "accountant",
        `document?documentId=${doc.id}`,
        undefined,
        403,
      );
      await request(
        "otherLawyer",
        `document?documentId=${doc.id}`,
        undefined,
        404,
      );
      await request("otherLawyer", `files/${file.id}`, undefined, 404);
      await request(
        "otherLawyer",
        "commands",
        {
          action: "case.create",
          title: "Denied unassigned client",
          contactId: contact.id,
          pipelineId: `${ws}:pipeline:0`,
          stageId: "new",
          source,
          responsibleUserId: users.otherLawyer,
        },
        404,
      );
      const rule = crypto.randomUUID();
      await pool.query(
        `INSERT INTO practice_commission_rules(id,version,source,plan_code,service_type,rate_bps,active,created_by) VALUES($1,1,$3,'free','legal_services',750,true,$2)`,
        [rule, users.owner, source],
      );
      const invoice = await request("accountant", "commands", {
        action: "invoice.create",
        caseId: matter.id,
        documentId: doc.id,
        number: `SYN-${crypto.randomUUID()}`,
        issuedOn: "2026-10-15",
        dueOn: "2026-10-31",
        currency: "UZS",
        lines: [
          {
            description: "Synthetic service",
            quantity: 1,
            unitPrice: "900.00",
          },
        ],
        provider: { name: "Synthetic legal firm", details: "Test only" },
      });
      const key = crypto.randomUUID(),
        paymentInput = {
          action: "payment.confirm",
          invoiceId: invoice.id,
          amount: "300.00",
          receivedOn: "2026-10-15",
          method: "bank",
        };
      const posted = await Promise.all([
        request("accountant", "commands", paymentInput, 200, key),
        request("accountant", "commands", paymentInput, 200, key),
      ]);
      assert.equal(posted[0].id, posted[1].id);
      assert.equal(posted[0].outstandingMinor, 60000);
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM practice_commissions WHERE payment_id=$1`,
            [posted[0].id],
          )
        ).rows[0].count,
        1,
      );
      await request(
        "accountant",
        "commands",
        { ...paymentInput, amount: "400.00" },
        409,
        key,
      );
      const refund = await request("accountant", "commands", {
        action: "payment.refund",
        paymentId: posted[0].id,
        amount: "100.00",
        receivedOn: "2026-10-16",
        reason: "Synthetic refund",
      });
      assert.equal(refund.outstandingMinor, 70000);
      const reverse = await request("accountant", "commands", {
        action: "payment.reverse",
        paymentId: posted[0].id,
        receivedOn: "2026-10-16",
        reason: "Synthetic correction",
      });
      assert.equal(reverse.outstandingMinor, 90000);
      assert.equal(
        (
          await pool.query(
            `SELECT sum(c.amount_minor)::bigint AS amount FROM practice_commissions c JOIN practice_payments p ON p.id=c.payment_id WHERE p.invoice_id=$1`,
            [invoice.id],
          )
        ).rows[0].amount,
        0,
      );
      assert.ok(
        !JSON.stringify(await request("client", "payments")).includes(
          '"rate_bps":750',
        ),
      );
      assert.equal(
        await legacyPracticeAccessDenied(users.lawyer, "/api/platform/search"),
        true,
      );
      await request("assistant", "reports", undefined, 403);
      await request("accountant", "reports");
      const importFile = new FormData();
      importFile.set(
        "file",
        new File(
          [
            `name,email\nСинтетический клиент — O‘zbek,\nImported ${ws},new@example.test\nInvalid ${ws},not-an-email`,
          ],
          "clients.csv",
          { type: "text/csv" },
        ),
      );
      const preview = await request(
          "lawyer",
          "imports/preview",
          undefined,
          200,
          crypto.randomUUID(),
          importFile,
        ),
        importKey = crypto.randomUUID();
      const importInput = {
        importId: preview.id,
        kind: "contacts",
        mapping: { name: 0, email: 1 },
        duplicate: "skip",
      };
      const imported = await request(
        "lawyer",
        "imports/confirm",
        importInput,
        200,
        importKey,
      );
      assert.deepEqual(
        [imported.created, imported.skipped, imported.failed],
        [1, 1, 1],
      );
      assert.equal(imported.errors[0].row, 4);
      assert.equal(imported.errors[0].field, "email");
      assert.deepEqual(
        await request("lawyer", "imports/confirm", importInput, 200, importKey),
        imported,
      );
      await request("owner", "commands", {
        action: "settings.save",
        providerDetails: {
          name: "Synthetic legal firm",
          details: "Test details",
        },
        settings: {
          reminders: true,
          email: true,
          reminderHours: 24,
          sources: [],
          aiConsent: false,
          baseCurrency: "UZS",
        },
      });
      await request("accountant", "commands", {
        action: "fx.save",
        currency: "USD",
        baseCurrency: "UZS",
        rate: "12345",
        rateOn: "2026-10-15",
      });
      const foreignInvoice = await request("accountant", "commands", {
        action: "invoice.create",
        caseId: matter.id,
        number: `FX-${crypto.randomUUID()}`,
        issuedOn: "2026-10-15",
        dueOn: "2026-10-31",
        currency: "USD",
        lines: [
          {
            description: "Synthetic foreign currency service",
            quantity: 1,
            unitPrice: "100.00",
          },
        ],
        provider: { name: "Synthetic legal firm" },
      });
      await request("accountant", "commands", {
        action: "fx.save",
        currency: "USD",
        baseCurrency: "UZS",
        rate: "30000",
        rateOn: "2026-10-16",
      });
      const historical = (
        await pool.query(
          `SELECT fx_snapshot FROM practice_invoices WHERE id=$1`,
          [foreignInvoice.id],
        )
      ).rows[0].fx_snapshot;
      assert.equal(historical.rate, "12345.000000000000");
      const report = await request(
        "accountant",
        "reports?from=2026-10-15&to=2026-10-16",
      );
      assert.equal(
        report.conversions.find(
          (row: any) => row.kind === "invoices" && row.base_currency === "UZS",
        ).converted_minor,
        "123450000",
      );
      const timeEntry = await request("lawyer", "commands", {
        action: "time.create",
        caseId: matter.id,
        minutes: 17,
        hourlyRate: "60.00",
        currency: "UZS",
        workedOn: "2026-10-15",
        description: "Synthetic hourly work",
      });
      const timeInvoiceInput = {
          action: "time.invoice",
          timeEntryIds: [timeEntry.id],
          number: `TIME-${crypto.randomUUID()}`,
          language: "uz",
          issuedOn: "2026-10-15",
          dueOn: "2026-10-31",
          provider: { name: "Synthetic provider" },
        },
        timeKey = crypto.randomUUID();
      const timeInvoice = await request(
        "accountant",
        "commands",
        timeInvoiceInput,
        200,
        timeKey,
      );
      assert.deepEqual(
        await request("accountant", "commands", timeInvoiceInput, 200, timeKey),
        timeInvoice,
      );
      await request(
        "accountant",
        "commands",
        { ...timeInvoiceInput, number: `DUP-${crypto.randomUUID()}` },
        409,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT total_minor FROM practice_invoices WHERE id=$1`,
            [timeInvoice.id],
          )
        ).rows[0].total_minor,
        1700,
      );
      assert.match(
        new PizZip(
          await request(
            "accountant",
            `export/invoice/${timeInvoice.id}?format=docx`,
          ),
        )
          .file("word/document.xml")!
          .asText(),
        /Hisob/,
      );
      await request("stranger", `cases?caseId=${matter.id}`, undefined, 403);
      const eventInput = {
        action: "event.save",
        caseId: matter.id,
        organizerUserId: users.lawyer,
        title: "Synthetic consultation",
        startsAt: "2026-11-02T10:00:00+05:00",
        endsAt: "2026-11-02T11:00:00+05:00",
        timezone: "Asia/Tashkent",
        clientVisible: true,
      };
      await request("lawyer", "commands", eventInput);
      await request("client", "commands", eventInput, 409);

      await t.test(
        "Google adapter performs real protocol branches against a synthetic provider",
        async () => {
          process.env.GOOGLE_CLIENT_ID = "synthetic-client";
          process.env.GOOGLE_CLIENT_SECRET = "synthetic-secret";
          process.env.PRACTICE_GOOGLE_REDIRECT_URI =
            "http://localhost:3000/api/practice/google/callback";
          process.env.PRACTICE_GOOGLE_TOKEN_KEY = "01".repeat(32);
          let remoteEvents: any[] = [],
            posts = 0,
            puts = 0,
            deletes = 0;
          const provider: typeof fetch = async (input, init) => {
            const url = new URL(String(input));
            if (url.hostname === "oauth2.googleapis.com")
              return Response.json({
                access_token: "synthetic-access",
                refresh_token: "synthetic-refresh",
                expires_in: 3600,
              });
            if (init?.method === "POST") {
              posts++;
              const value = JSON.parse(String(init.body));
              if (remoteEvents.some((event) => event.id === value.id))
                return Response.json({}, { status: 409 });
              remoteEvents = [{ ...value, etag: `etag-${posts}` }];
              return Response.json(remoteEvents[0]);
            }
            if (init?.method === "PUT") {
              puts++;
              const value = JSON.parse(String(init.body));
              remoteEvents = [{ ...value, etag: `put-${puts}` }];
              return Response.json(remoteEvents[0]);
            }
            if (init?.method === "DELETE") {
              deletes++;
              remoteEvents = [];
              return new Response(null, { status: 204 });
            }
            if (url.pathname.split("/").at(-1) !== "events") {
              const event = remoteEvents.find(
                (event) => event.id === url.pathname.split("/").at(-1),
              );
              return event
                ? Response.json(event)
                : Response.json({}, { status: 404 });
            }
            return Response.json({
              items: remoteEvents,
              nextSyncToken: "synthetic-sync",
            });
          };
          await transaction(async (client) => {
            const actor = await practiceActor(client, users.lawyer, ws, true),
              start = await oauthStart(client, actor);
            await oauthCallback(
              client,
              users.lawyer,
              "synthetic-code",
              new URL(start.url).searchParams.get("state")!,
              provider,
            );
          });
          const conn = (
            await pool.query(
              `UPDATE practice_calendar_connections SET calendar_id='synthetic-calendar' WHERE workspace_id=$1 AND user_id=$2 RETURNING *`,
              [ws, users.lawyer],
            )
          ).rows[0];
          assert.ok(!conn.encrypted_tokens.includes("synthetic-access"));
          const synchronize = () =>
            transaction(async (client) =>
              syncGoogle(
                client,
                await practiceActor(client, users.lawyer, ws, true),
                provider,
              ),
            );
          assert.equal((await synchronize()).pushed, 1);
          await synchronize();
          assert.equal(posts, 1);
          const event = (await request("lawyer", "events")).items[0];
          remoteEvents[0] = {
            ...remoteEvents[0],
            etag: "remote-update",
            start: { dateTime: "2026-11-02T07:00:00Z" },
            end: { dateTime: "2026-11-02T08:00:00Z" },
          };
          assert.equal((await synchronize()).received, 1);
          assert.equal(
            new Date(
              (await request("lawyer", "events")).items[0].starts_at,
            ).toISOString(),
            "2026-11-02T07:00:00.000Z",
          );
          await request("lawyer", "commands", {
            ...eventInput,
            eventId: event.id,
            startsAt: "2026-11-03T10:00:00+05:00",
            endsAt: "2026-11-03T11:00:00+05:00",
          });
          await synchronize();
          assert.equal(puts, 1);
          await request("lawyer", "commands", {
            ...eventInput,
            eventId: event.id,
            startsAt: "2026-11-04T10:00:00+05:00",
            endsAt: "2026-11-04T11:00:00+05:00",
          });
          remoteEvents[0] = {
            ...remoteEvents[0],
            etag: "conflict-update",
            start: { dateTime: "2026-11-05T07:00:00Z" },
            end: { dateTime: "2026-11-05T08:00:00Z" },
          };
          assert.equal((await synchronize()).conflicts.length, 1);
          await pool.query(
            `DELETE FROM practice_assignments WHERE case_id=$1 AND user_id=$2`,
            [matter.id, users.lawyer],
          );
          await assert.rejects(
            transaction(async (client) =>
              resolveGoogleConflict(
                client,
                await practiceActor(client, users.lawyer, ws, true),
                event.id,
                "remote",
              ),
            ),
            { code: "NOT_FOUND" },
          );
          await pool.query(
            `INSERT INTO practice_assignments(case_id,user_id) VALUES($1,$2)`,
            [matter.id, users.lawyer],
          );
          await transaction(async (client) =>
            resolveGoogleConflict(
              client,
              await practiceActor(client, users.lawyer, ws, true),
              event.id,
              "remote",
            ),
          );
          await pool.query(
            `DELETE FROM practice_google_events WHERE connection_id=$1`,
            [conn.id],
          );
          remoteEvents[0] = {
            id: remoteEvents[0].id,
            etag: "cancelled-after-reconnect",
            status: "cancelled",
          };
          assert.equal((await synchronize()).conflicts.length, 1);
          await transaction(async (client) =>
            resolveGoogleConflict(
              client,
              await practiceActor(client, users.lawyer, ws, true),
              event.id,
              "remote",
            ),
          );
          await request("lawyer", "commands", {
            action: "event.cancel",
            eventId: event.id,
          });
          await synchronize();
          assert.equal(deletes, 1);
          await pool.query(
            `DELETE FROM practice_calendar_connections WHERE id=$1`,
            [conn.id],
          );
        },
      );
      await t.test(
        "existing JURO case, materials, plan and consultation retain their canonical identities",
        async () => {
          const clientWorkspace = (
            await pool.query(
              `SELECT default_workspace_id FROM user_profiles WHERE id=$1`,
              [users.client],
            )
          ).rows[0].default_workspace_id;
          assert.notEqual(clientWorkspace, ws);
          const originalCase = crypto.randomUUID(),
            requestId = crypto.randomUUID(),
            profileId = crypto.randomUUID(),
            grantId = crypto.randomUUID(),
            consultationId = crypto.randomUUID(),
            sourceDocument = crypto.randomUUID(),
            originalPlan = crypto.randomUUID(),
            originalStep = crypto.randomUUID();
          await pool.query(
            `INSERT INTO lawyer_profiles(id,user_id,display_name,status,marketplace_status,created_at,updated_at) VALUES($1,$2,'Synthetic provider','public_approved','public_approved',$3,$3)`,
            [profileId, users.lawyer, now],
          );
          await pool.query(
            `INSERT INTO cases(id,workspace_id,owner_user_id,account_type,locale,title,description,legal_area,status,created_at,updated_at) VALUES($1,$2,$3,'individual','ru','Existing JURO case','Original shared circumstances','other','open',$4,$4)`,
            [originalCase, clientWorkspace, users.client, now],
          );
          await pool.query(
            `INSERT INTO lawyer_requests(id,workspace_id,case_id,requester_user_id,lawyer_profile_id,status,anonymized_summary,requested_scope_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'accepted','Synthetic request','[]',$6,$6)`,
            [
              requestId,
              clientWorkspace,
              originalCase,
              users.client,
              profileId,
              now,
            ],
          );
          await pool.query(
            `INSERT INTO lawyer_access_grants(id,lawyer_request_id,case_id,lawyer_user_id,granted_by_user_id,created_at) VALUES($1,$2,$3,$4,$5,$6)`,
            [grantId, requestId, originalCase, users.lawyer, users.client, now],
          );
          assert.ok(
            (await request("lawyer", "juro-cases")).items.some(
              (row: any) => row.id === originalCase,
            ),
          );
          const unlinked = await request("lawyer", "commands", {
            action: "contact.create",
            name: "Unverified account link",
            kind: "person",
          });
          const attach = {
            action: "case.create",
            existingCaseId: originalCase,
            title: "Must not replace the original title",
            contactId: contact.id,
            pipelineId: `${ws}:pipeline:0`,
            stageId: "new",
            source: "own_client",
            responsibleUserId: users.lawyer,
          };
          await request(
            "lawyer",
            "commands",
            { ...attach, contactId: unlinked.id },
            409,
          );
          assert.equal(
            (await request("lawyer", "commands", attach)).id,
            originalCase,
          );
          const canonical = (
            await pool.query(
              `SELECT c.workspace_id,c.title,m.source FROM cases c JOIN practice_matters m ON m.case_id=c.id WHERE c.id=$1`,
              [originalCase],
            )
          ).rows[0];
          assert.equal(canonical.workspace_id, clientWorkspace);
          assert.equal(canonical.title, "Existing JURO case");
          assert.equal(canonical.source, "juro_marketplace");
          await request("owner", "commands", {
            action: "case.assign",
            caseId: originalCase,
            userIds: [users.lawyer, users.assistant],
          });
          await pool.query(
            `INSERT INTO documents(id,workspace_id,owner_user_id,template_id,language,participant_mode,title,category,status,case_id,created_at,updated_at) VALUES($1,$2,$3,'practice-editable-v1','ru','parties','Original client document','Original','Черновик',$4,$5,$5)`,
            [sourceDocument, clientWorkspace, users.client, originalCase, now],
          );
          await pool.query(
            `INSERT INTO document_current_content(document_id,auto_content,final_content,manually_edited,updated_at) VALUES($1,'Original content','Original content',1,$2)`,
            [sourceDocument, now],
          );
          const materials = await request(
            "lawyer",
            `materials?caseId=${originalCase}`,
          );
          assert.equal(materials.items[0].id, sourceDocument);
          assert.equal(
            (
              await pool.query(
                `SELECT count(*)::int AS count FROM practice_documents WHERE document_id=$1`,
                [sourceDocument],
              )
            ).rows[0].count,
            0,
          );
          const originalPdf = await request(
            "client",
            `export/material/${sourceDocument}?format=pdf`,
          );
          assert.ok((await PDFDocument.load(originalPdf)).getPageCount());
          await request(
            "accountant",
            `materials?caseId=${originalCase}`,
            undefined,
            403,
          );
          await request(
            "otherLawyer",
            `export/material/${sourceDocument}?format=pdf`,
            undefined,
            404,
          );
          const privateDocument = crypto.randomUUID();
          await pool.query(
            `INSERT INTO documents(id,workspace_id,owner_user_id,template_id,language,participant_mode,title,category,status,case_id,created_at,updated_at) VALUES($1,$2,$3,'practice-editable-v1','ru','parties','Unshared third-party material','Original','Черновик',$4,$5,$5)`,
            [
              privateDocument,
              clientWorkspace,
              users.otherLawyer,
              originalCase,
              now,
            ],
          );
          await pool.query(
            `INSERT INTO document_current_content(document_id,auto_content,final_content,manually_edited,updated_at) VALUES($1,'Private third-party content','Private third-party content',1,$2)`,
            [privateDocument, now],
          );
          await request(
            "owner",
            `export/material/${privateDocument}?format=pdf`,
            undefined,
            404,
          );
          await request(
            "client",
            `export/material/${privateDocument}?format=pdf`,
            undefined,
            404,
          );
          assert.ok(
            !(
              await request("lawyer", `materials?caseId=${originalCase}`)
            ).items.some((row: any) => row.id === privateDocument),
          );
          const firmDocument = await request("lawyer", "commands", {
            action: "document.create",
            caseId: originalCase,
            title: "Firm agreement for the same case",
            language: "en",
            content: "<p>Shared case, separate agreement</p>",
          });
          assert.ok(firmDocument.id);
          await pool.query(
            `INSERT INTO action_plans(id,case_id,created_by_user_id,title,status,progress_percent,current_revision,created_at,updated_at) VALUES($1,$2,$3,'Original JURO plan','in_progress',0,1,$4,$4)`,
            [originalPlan, originalCase, users.client, now],
          );
          await pool.query(
            `INSERT INTO action_plan_steps(id,plan_id,ordinal,title,status,deadline_type,revision,created_at,updated_at) VALUES($1,$2,1,'Original step','not_started','calendar_days',1,$3,$3)`,
            [originalStep, originalPlan, now],
          );
          assert.equal(
            (await request("lawyer", `plan?caseId=${originalCase}`)).items[0]
              .id,
            originalStep,
          );
          await request("lawyer", "commands", {
            action: "task.create",
            caseId: originalCase,
            title: "Internal firm task",
            assigneeUserId: users.lawyer,
            dueAt: null,
            priority: "normal",
            clientVisible: false,
          });
          assert.equal(
            (await request("client", `plan?caseId=${originalCase}`)).items
              .length,
            1,
          );
          await pool.query(
            `INSERT INTO lawyer_consultations(id,lawyer_request_id,lawyer_profile_id,client_user_id,case_id,starts_at,ends_at,timezone,format,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'2026-11-10T05:00:00Z','2026-11-10T06:00:00Z','Asia/Tashkent','video','proposed',$6,$6)`,
            [
              consultationId,
              requestId,
              profileId,
              users.client,
              originalCase,
              now,
            ],
          );
          await request("client", "commands", {
            action: "event.confirm",
            eventId: `juro:${consultationId}`,
          });
          assert.equal(
            (await request("lawyer", `events?caseId=${originalCase}`)).items[0]
              .id,
            `juro:${consultationId}`,
          );
          await request("lawyer", "commands", {
            action: "event.save",
            eventId: `juro:${consultationId}`,
            caseId: originalCase,
            organizerUserId: users.lawyer,
            title: "JURO consultation",
            startsAt: "2026-11-11T10:00:00+05:00",
            endsAt: "2026-11-11T11:00:00+05:00",
            timezone: "Asia/Tashkent",
            clientVisible: true,
          });
          assert.equal(
            (
              await pool.query(
                `SELECT count(*)::int AS count FROM practice_events WHERE case_id=$1`,
                [originalCase],
              )
            ).rows[0].count,
            0,
          );
          const events = new Map<string, any>();
          let serial = 0;
          const provider: typeof fetch = async (input, init) => {
            const url = new URL(String(input));
            if (url.hostname === "oauth2.googleapis.com")
              return Response.json({
                access_token: "synthetic-access",
                refresh_token: "synthetic-refresh",
                expires_in: 3600,
              });
            const eventId = url.pathname.split("/").at(-1)!;
            if (init?.method === "POST") {
              const value = JSON.parse(String(init.body));
              if (events.has(value.id))
                return Response.json({}, { status: 409 });
              const event = { ...value, etag: `created-${++serial}` };
              events.set(event.id, event);
              return Response.json(event);
            }
            if (init?.method === "PUT") {
              const event = {
                ...JSON.parse(String(init.body)),
                etag: `updated-${++serial}`,
              };
              events.set(event.id, event);
              return Response.json(event);
            }
            if (init?.method === "DELETE") {
              events.delete(eventId);
              return new Response(null, { status: 204 });
            }
            if (eventId !== "events")
              return events.has(eventId)
                ? Response.json(events.get(eventId))
                : Response.json({}, { status: 404 });
            return Response.json({
              items: [...events.values()],
              nextSyncToken: `sync-${serial}`,
            });
          };
          const connect = () =>
            transaction(async (client) => {
              const actor = await practiceActor(client, users.lawyer, ws, true),
                start = await oauthStart(client, actor);
              await oauthCallback(
                client,
                users.lawyer,
                "synthetic-code",
                new URL(start.url).searchParams.get("state")!,
                provider,
              );
              await client.query(
                `UPDATE practice_calendar_connections SET calendar_id='synthetic-calendar' WHERE workspace_id=$1 AND user_id=$2`,
                [ws, users.lawyer],
              );
            });
          const synchronize = () =>
            transaction(async (client) =>
              syncGoogle(
                client,
                await practiceActor(client, users.lawyer, ws, true),
                provider,
              ),
            );
          await connect();
          await synchronize();
          assert.equal(events.size, 1);
          const remote = [...events.values()][0];
          events.set(remote.id, {
            ...remote,
            etag: "source-remote",
            start: { dateTime: "2026-11-12T05:00:00Z" },
            end: { dateTime: "2026-11-12T06:00:00Z" },
          });
          await synchronize();
          assert.equal(
            (
              await pool.query(
                `SELECT starts_at FROM lawyer_consultations WHERE id=$1`,
                [consultationId],
              )
            ).rows[0].starts_at,
            "2026-11-12T05:00:00Z",
          );
          await pool.query(
            `DELETE FROM practice_calendar_connections WHERE workspace_id=$1 AND user_id=$2`,
            [ws, users.lawyer],
          );
          await connect();
          await synchronize();
          assert.equal(events.size, 1);
          const remoteCurrent = [...events.values()][0];
          events.set(remoteCurrent.id, {
            ...remoteCurrent,
            etag: "source-deleted",
            status: "cancelled",
          });
          await synchronize();
          assert.equal(
            (
              await pool.query(
                `SELECT status FROM lawyer_consultations WHERE id=$1`,
                [consultationId],
              )
            ).rows[0].status,
            "cancelled",
          );
          await pool.query(
            `DELETE FROM practice_calendar_connections WHERE workspace_id=$1 AND user_id=$2`,
            [ws, users.lawyer],
          );
          await pool.query(
            `UPDATE lawyer_access_grants SET revoked_at=$2 WHERE id=$1`,
            [grantId, new Date().toISOString()],
          );
          await request(
            "lawyer",
            `materials?caseId=${originalCase}`,
            undefined,
            404,
          );
          await request(
            "owner",
            `cases?caseId=${originalCase}`,
            undefined,
            404,
          );
          await request("client", `materials?caseId=${originalCase}`);
        },
      );
      await runPracticeJobs();
      const count = (
        await pool.query(
          `SELECT count(*)::int AS count FROM storage.captured_emails WHERE idempotency_key LIKE 'juro_practice_%'`,
        )
      ).rows[0].count;
      await runPracticeJobs();
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM storage.captured_emails WHERE idempotency_key LIKE 'juro_practice_%'`,
          )
        ).rows[0].count,
        count,
      );
      assert.ok(count > 0);
      await request("owner", "commands", {
        action: "invitation.revoke",
        invitationId: invitation.id,
      });
      await request("client", `files/${file.id}`, undefined, 403);
      const roleKey = crypto.randomUUID(),
        roleInput = {
          action: "contact.create",
          name: "Role-bound retry",
          kind: "person",
        };
      await request("lawyer", "commands", roleInput, 200, roleKey);
      await pool.query(
        `UPDATE workspace_members SET role='accountant' WHERE workspace_id=$1 AND user_id=$2`,
        [ws, users.lawyer],
      );
      await request("lawyer", "commands", roleInput, 409, roleKey);
      await pool.query(
        `UPDATE workspace_members SET role='lawyer' WHERE workspace_id=$1 AND user_id=$2`,
        [ws, users.lawyer],
      );
      await pool.query(
        `UPDATE practice_workspaces SET pilot_until=now()-interval '1 minute' WHERE workspace_id=$1`,
        [ws],
      );
      assert.equal(
        (await request("lawyer", "bootstrap")).actor.writable,
        false,
      );
      await request("lawyer", `export/document/${doc.id}?format=pdf`);
      await request(
        "lawyer",
        "commands",
        {
          action: "contact.create",
          name: "Blocked expired write",
          kind: "person",
        },
        403,
      );
    } finally {
      await closeRuntimeDatabases();
      await rm(root, { recursive: true, force: true });
    }
  },
);
