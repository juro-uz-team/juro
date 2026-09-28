import { ru } from "./ru";
import type { LandingContent } from "./types";

/**
 * Public English copy. Legal instruments intentionally remain outside this
 * dictionary: they are displayed through the English legal centre with links
 * to the published Russian and Uzbek originals until approved translations
 * are issued.
 */
export const en: LandingContent = {
  ...ru,
  meta: {
    title: "JURO — legal clarity, from question to next step",
    description: "JURO — AI assistance, documents and legal professionals in one service.",
  },
  hero: {
    ...ru.hero,
    eyebrow: "JURO · Legal guidance in your pocket",
    subtitle: "Turn a legal question into verified facts, risks and a clear next step.",
    primary: "Start with JURO",
    secondary: "See how it works",
    jurobekAlt: "JURO guide pointing to the next step",
  },
  audience: {
    ...ru.audience,
    top: [
      { id: "self", title: "For individuals", body: "Understand a situation, prepare a document and keep the next step clear.", scenarios: ["A personal legal question", "A deadline or dispute", "A document to review"], cta: "Explore your situation" },
      { id: "business", title: "For businesses", body: "Bring contracts, responsibilities and legal work into one understandable flow.", scenarios: ["Commercial contracts", "Operational deadlines", "A shared case history"], cta: "Create a business workspace" },
      { id: "lawyer", title: "For legal professionals", body: "Receive a prepared context instead of starting from an empty chat.", scenarios: ["Structured facts", "Documents and risks", "A client-approved handoff"], cta: "Find a professional" },
    ],
  },
  security: {
    ...ru.security,
    items: [
      { title: "Public pages do not receive case files", body: "A question or document is handled only after the user enters a protected account." },
      { title: "The user chooses what to share", body: "Context is transferred to a professional only after a separate action and confirmation." },
      { title: "Claims are separated from verified facts", body: "JURO publishes confirmed product information and marks anything still being clarified." },
    ],
  },
  faq: {
    ...ru.faq,
    items: [
      { question: "Can I begin on the public website?", answer: "You can explore JURO here without uploading case materials. Work with a question or document begins in a protected account." },
      { question: "Does AI replace a lawyer?", answer: "No. JURO helps structure a situation, identify facts and prepare the next step. A qualified professional is appropriate where individual legal advice is required." },
      { question: "Which law does JURO focus on?", answer: "JURO is designed around the law of Uzbekistan and directs users to official legal sources when a source needs to be checked." },
      { question: "Can I consult a legal professional?", answer: "The public catalogue lets you review available profiles. Any transfer of case context requires your separate confirmation." },
      { question: "Are the legal documents available in English?", answer: "The published Russian and Uzbek originals are available in the Legal Centre. English summaries identify the document and link to those originals; they are not legal translations." },
    ],
  },
};
