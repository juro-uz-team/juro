import {z} from "zod";

export const legalChatRequestSchema=z.object({
  question:z.string().trim().max(8_000).default(""),
  conversationId:z.string().uuid().nullable().default(null),
  sourceMessageId:z.string().uuid().nullable().default(null),
  voiceRecordingId:z.string().uuid().optional(),
  operation:z.enum(["new","follow_up","edit","regenerate"]).optional(),
  locale:z.enum(["ru","uz","en"]),
  answerMode:z.enum(["short","detailed"]).default("detailed"),
  reasoningMode:z.enum(["fast","deep"]).default("fast"),
  legalContextDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idempotencyKey:z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict().refine(value=>Boolean(value.question)||value.operation==="regenerate",{message:"Question required"});
export type LegalChatRequest=z.infer<typeof legalChatRequestSchema>;
