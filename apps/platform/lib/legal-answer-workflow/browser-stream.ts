import { legalAnswerDeadlineMs } from "./deadline";
import { z } from "zod";
import { legalChatResponseSchema } from "../ai/legal-chat-schema";
import { withinSignal } from "./lifetime";
import type { WritingDraft } from "./writing-stream";

const writingSchema = z.object({ blocks: z.array(z.object({ key: z.string().max(240), text: z.string().max(4000) }).strict()).max(1024) }).strict();
const writingDeltaSchema = writingSchema.extend({ revision: z.number().int().nonnegative().optional() });
const writingRevisionSchema = writingSchema.extend({ revision: z.number().int().positive(),
  notices: z.array(z.string().min(1).max(2000)).min(1).max(100) });

const stageSchema = z.enum(["interpreting", "researching", "reviewing", "focused_research", "deeper_research", "writing", "verifying", "correcting", "saving"]);
export type AnswerStage = z.infer<typeof stageSchema>;
const deliverySchema = z.object({ runId: z.string(), conversationId: z.string().optional(),
  requestMessageId: z.string().optional(), messageId: z.string().optional(), branchId: z.string().optional(), result: legalChatResponseSchema });
export type LegalChatDelivery = z.infer<typeof deliverySchema>;

export class LegalChatClientError extends Error {
  constructor(readonly code: string, readonly retryable = true) { super(code); }
}

export async function requestLegalChatStream(url: string, init: RequestInit,
  onStage: (stage: AnswerStage) => void, submittedAt = Date.now(), onWriting?: (draft: WritingDraft) => void): Promise<LegalChatDelivery> {
  const controller = new AbortController();
  const remaining = submittedAt + legalAnswerDeadlineMs - Date.now();
  if (remaining <= 0 || remaining > legalAnswerDeadlineMs) throw new LegalChatClientError("REQUEST_DEADLINE");
  const signal = AbortSignal.any([controller.signal, ...(init.signal ? [init.signal] : [])]);
  const timer = setTimeout(() => controller.abort(new LegalChatClientError("REQUEST_DEADLINE")), remaining);
  try {
    const response = await withinSignal(signal, () => fetch(url, { ...init, signal }));
    return await readLegalChatStream(response, onStage, signal, onWriting);
  } finally { clearTimeout(timer); controller.abort(); }
}

/** Writing remains in progress; only the terminal result identifies a saved answer. */
export async function readLegalChatStream(response: Response, onStage: (stage: AnswerStage) => void,
  signal = new AbortController().signal, onWriting?: (draft: WritingDraft) => void): Promise<LegalChatDelivery> {
  if (!response.ok) {
    const error = await withinSignal(signal, () => response.json()).catch(() => ({}));
    const code = z.object({ code: z.string() }).safeParse(error);
    throw new LegalChatClientError(code.success ? code.data.code : "LEGAL_ANSWER_UNAVAILABLE",
      response.status >= 500 || response.status === 408 || (code.success && code.data.code === "AI_RUN_PROCESSING"));
  }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new LegalChatClientError("LEGAL_ANSWER_INVALID_DELIVERY");
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const writing = new Map<string, string>();
  let revision = 0;
  let notices: string[] = [];
  let buffer = "";
  try {
    while (true) {
      const next = await withinSignal(signal, () => reader.read());
      buffer = (buffer + decoder.decode(next.value, { stream: !next.done })).replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const lines = frame.split("\n"), event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const value: unknown = JSON.parse(data);
        if (event === "progress") {
          const progress = z.object({ stage: stageSchema, targetMissed: z.boolean().optional() }).parse(value);
          onStage(progress.targetMissed && ["interpreting", "researching", "focused_research"].includes(progress.stage)
            ? "deeper_research" : progress.stage);
        } else if (event === "writing") {
          const delta = writingDeltaSchema.parse(value);
          if ((revision > 0 && delta.revision === undefined) || (delta.revision !== undefined && delta.revision !== revision))
            throw new LegalChatClientError("LEGAL_ANSWER_INVALID_REVISION");
          for (const block of delta.blocks) writing.set(block.key, (writing.get(block.key) ?? "") + block.text);
          onWriting?.({ ...writingSchema.parse({ blocks: [...writing].map(([key, text]) => ({ key, text })) }),
            ...(revision ? { revision, notices: [...notices] } : {}) });
          onStage("writing");
        } else if (event === "writing-revision") {
          const update = writingRevisionSchema.parse(value);
          if (update.revision !== revision + 1 || update.notices.length <= notices.length
            || notices.some((notice, index) => update.notices[index] !== notice)) throw new LegalChatClientError("LEGAL_ANSWER_INVALID_REVISION");
          revision = update.revision; notices = [...update.notices]; writing.clear();
          for (const block of update.blocks) writing.set(block.key, block.text);
          onWriting?.({ revision, notices: [...notices], blocks: [...writing].map(([key, text]) => ({ key, text })) });
          onStage("writing");
        } else if (event === "result") return deliverySchema.parse(value);
        else if (event === "error") {
          const error = z.object({ code: z.string(), retryable: z.boolean().optional() }).parse(value);
          throw new LegalChatClientError(error.code, error.retryable ?? true);
        }
      }
      if (next.done) throw new LegalChatClientError("LEGAL_ANSWER_INCOMPLETE_DELIVERY");
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function shouldReuseLegalChatRequest(error: unknown): boolean {
  return !(error instanceof LegalChatClientError) || error.retryable;
}

export function chatStageLabel(stage: AnswerStage, locale: "ru" | "uz" | "en"): string {
  const labels = {
    en: { interpreting: "Understanding your question…", researching: "Researching the law…", focused_research: "Researching the law…",
      deeper_research: "This question needs deeper research. It is taking a little more time…", reviewing: "Reviewing sources and preparing the answer…", writing: "Writing the answer…",
      verifying: "Preparing the answer…", correcting: "Preparing the answer…", saving: "Saving the answer…" },
    ru: { interpreting: "Разбираемся в вашем вопросе…", researching: "Изучаем нормы права…", focused_research: "Изучаем нормы права…",
      deeper_research: "Исследование продолжается. Требуется немного больше времени…", reviewing: "Изучаем источники и готовим ответ…", writing: "Готовим ответ…",
      verifying: "Готовим ответ…", correcting: "Готовим ответ…", saving: "Сохраняем ответ…" },
    uz: { interpreting: "Savolingizni o‘rganmoqdamiz…", researching: "Huquqiy normalarni o‘rganmoqdamiz…", focused_research: "Huquqiy normalarni o‘rganmoqdamiz…",
      deeper_research: "Izlanish davom etmoqda. Biroz ko‘proq vaqt kerak…", reviewing: "Manbalarni o‘rganib, javob tayyorlamoqdamiz…", writing: "Javob tayyorlanmoqda…",
      verifying: "Javob tayyorlanmoqda…", correcting: "Javob tayyorlanmoqda…", saving: "Javob saqlanmoqda…" },
  };
  return labels[locale][stage];
}
