import { currencyScales } from "./money";
export { PracticeError } from "./errors";
export { minorUnits, displayMoney, safeSum, invoiceStatus } from "./money";
import { createHash } from "node:crypto";
import { z } from "zod";

export const locales = ["ru", "uz", "en"] as const;
export type Locale = (typeof locales)[number];
export const roles = [
  "owner",
  "admin",
  "lawyer",
  "assistant",
  "accountant",
] as const;
export type Role = (typeof roles)[number];
export type Actor = {
  userId: string;
  workspaceId: string;
  role: Role | "client";
  writable: boolean;
  planCode: string;
};
export const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const isManager = (actor: Actor) =>
  actor.role === "owner" || actor.role === "admin";
export const isLegal = (actor: Actor) =>
  isManager(actor) || actor.role === "lawyer" || actor.role === "assistant";
export const isFinance = (actor: Actor) =>
  isManager(actor) || actor.role === "lawyer" || actor.role === "accountant";

const id = z.string().min(1).max(100);
const text = z.string().trim().min(1).max(300);
const date = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const currency = z.enum(Object.keys(currencyScales) as [string, ...string[]]);
const amount = z
  .string()
  .regex(/^\d+(?:\.\d{1,3})?$/)
  .max(20);
const html = z.string().min(1).max(250_000);
const fields = z.record(
  z.string().max(80),
  z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()]),
);
export const stagesSchema = z
  .array(z.object({ id, name: text }).strict())
  .min(1)
  .max(30)
  .refine(
    (stages) => new Set(stages.map((stage) => stage.id)).size === stages.length,
  );
export const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("contact.create"),
      name: text,
      kind: z.enum(["person", "company"]),
      email: z.union([z.email(), z.literal("")]).default(""),
      phone: z.string().max(60).default(""),
      companyName: z.string().max(300).default(""),
      requisites: fields.default({}),
    })
    .strict(),
  z
    .object({
      action: z.literal("contact.update"),
      contactId: id,
      name: text,
      email: z.union([z.email(), z.literal("")]),
      phone: z.string().max(60),
      requisites: fields,
    })
    .strict(),
  z
    .object({
      action: z.literal("pipeline.save"),
      pipelineId: id.optional(),
      name: text,
      stages: stagesSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("case.create"),
      existingCaseId: id.optional(),
      title: text,
      description: z.string().max(20_000).default(""),
      category: text.default("other"),
      contactId: id,
      pipelineId: id,
      stageId: id,
      source: text,
      serviceType: text.default("legal_services"),
      responsibleUserId: id,
      expected: amount.default("0"),
      currency: currency.default("UZS"),
      nextAction: z.string().max(1000).default(""),
      customFields: fields.default({}),
      templateId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("case.update"),
      caseId: id,
      revision: z.number().int().positive(),
      stageId: id,
      nextAction: z.string().max(1000),
      clientStatus: z.string().max(1000),
      customFields: fields,
    })
    .strict(),
  z
    .object({
      action: z.literal("case.assign"),
      caseId: id,
      userIds: z.array(id).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("task.create"),
      caseId: id,
      title: text,
      description: z.string().max(4000).default(""),
      assigneeUserId: id,
      dueAt: instant.nullable(),
      priority: z.enum(["low", "normal", "high", "urgent"]),
      clientVisible: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal("task.update"),
      caseId: id,
      taskId: id,
      status: z.enum(["planned", "in_progress", "completed", "cancelled"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("entry.create"),
      caseId: id,
      kind: z.enum(["note", "message", "milestone"]),
      body: z.string().trim().min(1).max(10_000),
      clientVisible: z.boolean().default(false),
    })
    .strict(),
  z
    .object({ action: z.literal("entry.confirm"), caseId: id, entryId: id })
    .strict(),
  z.object({ action: z.literal("invitation.create"), contactId: id }).strict(),
  z
    .object({ action: z.literal("invitation.confirm"), invitationId: id })
    .strict(),
  z
    .object({ action: z.literal("invitation.revoke"), invitationId: id })
    .strict(),
  z
    .object({
      action: z.literal("document.create"),
      caseId: id,
      title: text,
      language: z.enum(locales),
      content: html,
      templateId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("document.save"),
      documentId: id,
      revision: z.number().int().positive(),
      content: html,
      checkpoint: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal("document.transition"),
      documentId: id,
      revision: z.number().int().positive(),
      state: z.enum([
        "draft",
        "review",
        "changes_requested",
        "agreed",
        "awaiting_signed",
        "signed_confirmed",
        "cancelled",
        "archived",
      ]),
      signedFileId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("document.review"),
      documentId: id,
      revision: z.number().int().positive(),
      kind: z.enum(["comment", "proposal", "approval"]),
      anchor: z.string().max(300).default(""),
      body: z.string().trim().min(1).max(4000),
      proposal: html.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("document.resolve"),
      documentId: id,
      reviewId: id,
      revision: z.number().int().positive(),
      accept: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("template.save"),
      templateId: id.optional(),
      name: text,
      kind: text,
      language: z.enum(locales),
      content: html,
      fields: z.array(text).max(50),
      global: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal("template.publication"),
      templateId: id,
      requested: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("invoice.create"),
      language: z.enum(locales).default("ru"),
      caseId: id,
      documentId: id.optional(),
      stageId: id.optional(),
      number: text,
      issuedOn: date,
      dueOn: date,
      currency,
      lines: z
        .array(
          z
            .object({
              description: text,
              quantity: z.number().int().min(1).max(100000),
              unitPrice: amount,
            })
            .strict(),
        )
        .min(1)
        .max(100),
      provider: fields,
    })
    .strict(),
  z
    .object({
      action: z.literal("payment.confirm"),
      invoiceId: id,
      amount,
      receivedOn: date,
      method: text,
      note: z.string().max(1000).default(""),
      evidenceFileId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("payment.reverse"),
      paymentId: id,
      receivedOn: date,
      reason: z.string().trim().min(3).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("payment.refund"),
      paymentId: id,
      amount,
      receivedOn: date,
      reason: z.string().trim().min(3).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("expense.create"),
      caseId: id,
      amount,
      currency,
      incurredOn: date,
      paid: z.boolean(),
      description: text,
    })
    .strict(),
  z
    .object({
      action: z.literal("time.create"),
      caseId: id,
      minutes: z.number().int().min(1).max(1440),
      hourlyRate: amount,
      currency,
      workedOn: date,
      description: text,
    })
    .strict(),
  z
    .object({
      action: z.literal("time.invoice"),
      language: z.enum(locales).default("ru"),
      timeEntryIds: z.array(id).min(1).max(100),
      number: text,
      issuedOn: date,
      dueOn: date,
      provider: fields,
    })
    .strict(),
  z
    .object({
      action: z.literal("recurring.create"),
      language: z.enum(locales).default("ru"),
      caseId: id,
      amount,
      currency,
      description: text,
      nextOn: date,
      intervalMonths: z.number().int().min(1).max(12),
    })
    .strict(),
  z
    .object({
      action: z.literal("recurring.toggle"),
      serviceId: id,
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("fx.save"),
      currency,
      baseCurrency: currency,
      rate: z.string().regex(/^[1-9]\d{0,15}(?:\.\d{1,12})?$|^0\.\d{1,12}$/),
      rateOn: date,
    })
    .strict(),
  z
    .object({
      action: z.literal("event.save"),
      eventId: id.optional(),
      caseId: id,
      organizerUserId: id,
      title: text,
      startsAt: instant,
      endsAt: instant,
      timezone: z.string().min(1).max(80),
      clientVisible: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal("event.cancel"), eventId: id }).strict(),
  z.object({ action: z.literal("event.confirm"), eventId: id }).strict(),
  z
    .object({
      action: z.literal("settings.save"),
      providerDetails: fields,
      settings: z
        .object({
          reminders: z.boolean(),
          email: z.boolean(),
          reminderHours: z.number().int().min(1).max(720),
          sources: z.array(text).max(30),
          aiConsent: z.boolean(),
          baseCurrency: currency.default("UZS"),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("preferences.save"),
      blocks: z
        .array(
          z
            .object({
              id: z.enum(["tasks", "cases", "calendar", "finance", "leads"]),
              visible: z.boolean(),
            })
            .strict(),
        )
        .max(5),
    })
    .strict(),
  z
    .object({
      action: z.literal("member.role"),
      memberId: id,
      role: z.enum(["lawyer", "assistant", "accountant"]),
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("case-template.save"),
      name: text,
      fields: z
        .array(
          z
            .object({
              key: id,
              label: z.string().trim().min(1).max(80),
              type: z.enum(["text", "number", "date", "boolean"]),
            })
            .strict(),
        )
        .max(30)
        .refine(
          (fields) =>
            new Set(fields.map((field) => field.label)).size === fields.length,
        ),
      tasks: z.array(text).max(30),
      stages: z.array(text).max(30),
    })
    .strict(),
  z
    .object({ action: z.literal("case.start"), caseId: id, templateId: id })
    .strict(),
  z
    .object({ action: z.literal("notification.read"), notificationId: id })
    .strict(),
  z
    .object({
      action: z.literal("file.visibility"),
      fileId: id,
      clientVisible: z.boolean(),
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;

export const transitionAllowed: Record<string, readonly string[]> = {
  draft: ["review", "cancelled", "archived"],
  review: ["changes_requested", "agreed", "cancelled"],
  changes_requested: ["draft", "review", "cancelled"],
  agreed: ["awaiting_signed", "draft", "cancelled"],
  awaiting_signed: ["signed_confirmed", "draft", "cancelled"],
  signed_confirmed: ["draft", "archived"],
  cancelled: ["archived"],
  archived: ["draft"],
};
