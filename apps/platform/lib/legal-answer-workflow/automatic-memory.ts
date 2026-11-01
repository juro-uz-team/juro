import { randomUUID } from "node:crypto";
import { identityLookupHmac, protectIdentityValue, type IdentityKeyring } from "../auth/keyring";

type MemoryFact = { category: "language" | "answer_style" | "profile_name" | "company"; statement: string };

/** Explicit presentation preferences and bounded self-identification can become memory.
 * Circumstances, identifiers and open-ended instructions require manual consent.
 * Accept only messages wholly composed of recognized first-person declarations.
 * Any unrecognized context can change attribution or consent, so skip the message.
 */
function automaticFacts(question: string): MemoryFact[] {
  if (/[?？"«»“”`]|:\s*\n/u.test(question)) return [];
  // Do not mine a message containing secrets, payment data or sensitive personal context.
  if (/\d{4}|password|passcode|secret|api.?key|token|credit.?card|bank.?account|medical|diagnos|religio|politic|criminal|парол|секрет|банковск|диагноз|болезн|религи|политич|судим|parol|maxfiy|tashxis|kasallik|karta\s*raqam|jinoyat/iu.test(question)) return [];
  const found = new Map<string, MemoryFact>();
  const name = String.raw`\p{Lu}[\p{L}\p{M}'’ʻ-]{1,29}`;
  const person = new RegExp(String.raw`^(?:[Mm]y name is|[Мм]еня зовут|[Mm]ening ismim) (${name}(?: ${name}){1,3})$`, "u");
  const company = new RegExp(String.raw`^(?:[Mm]y company is|[Мм]оя компания(?: —)?|[Mm]ening kompaniyam) (${name}(?: ${name}){0,5}) (?:LLC|Ltd|ООО|АО|MChJ)$`, "u");
  const languages = [
    { name: "English", pattern: /^(?:please (?:always )?answer in english|i prefer (?:answers in )?english|отвечайте (?:всегда )?на английском|ingliz tilida javob bering)$/iu },
    { name: "Russian", pattern: /^(?:please (?:always )?answer in russian|i prefer (?:answers in )?russian|отвечайте (?:всегда )?на русском|rus tilida javob bering)$/iu },
    { name: "Uzbek", pattern: /^(?:please (?:always )?answer in uzbek|i prefer (?:answers in )?uzbek|отвечайте (?:всегда )?на узбекском|o['’ʻ]zbek tilida javob bering)$/iu },
  ];
  for (const sentence of question.split(/[.!?\r\n]+/u).map(value => value.trim()).filter(Boolean)) {
    let recognized = false;
    const remember = (fact: MemoryFact) => { recognized = true; found.set(fact.category, fact); };
    if (person.test(sentence)) remember({ category: "profile_name", statement: sentence });
    if (company.test(sentence)) remember({ category: "company", statement: sentence });
    const language = languages.find(value => value.pattern.test(sentence));
    if (language) remember({ category: "language", statement: `Preferred answer language: ${language.name}.` });
    if (/^(?:i prefer concise answers|please keep answers concise|предпочитаю краткие ответы|qisqa javoblarni afzal ko['’ʻ]raman)$/iu.test(sentence)) {
      remember({ category: "answer_style", statement: "Prefers concise answers." });
    }
    if (/^(?:i prefer detailed answers|please give detailed answers|предпочитаю подробные ответы|batafsil javoblarni afzal ko['’ʻ]raman)$/iu.test(sentence)) {
      remember({ category: "answer_style", statement: "Prefers detailed answers." });
    }
    if (!recognized) return [];
  }
  return [...found.values()];
}

/** Called before batch execution; all writes and the opt-in check commit with the answer. */
export async function automaticAnswerMemoryStatements(input: {
  db: D1Database; keyring?: IdentityKeyring; userId: string; workspaceId: string;
  question: string; conversationId: string; requestMessageId: string; now: string;
}): Promise<D1PreparedStatement[]> {
  const candidates = automaticFacts(input.question);
  if (!input.keyring || !candidates.length) return [];
  const statements = [
    input.db.prepare(`INSERT INTO user_memory_settings(user_id,automatic_enabled,created_at,updated_at)
      VALUES(?,1,?,?) ON CONFLICT(user_id) DO NOTHING`).bind(input.userId, input.now, input.now),
    // Serialize with settings updates, including a concurrent opt-out.
    input.db.prepare("UPDATE user_memory_settings SET updated_at=updated_at WHERE user_id=?").bind(input.userId),
  ];
  for (const candidate of candidates) {
    const id = randomUUID();
    const encrypted = await protectIdentityValue(input.keyring, candidate.statement,
      { purpose: "user-memory-statement-v1", subjectId: input.userId, recordId: id });
    const identity = await identityLookupHmac(input.keyring,
      JSON.stringify([input.userId, input.workspaceId, candidate.category, candidate.statement]), "answer-memory-identity");
    const digest = Buffer.from(identity.digest, "base64url").toString("hex");
    statements.push(input.db.prepare(`INSERT INTO user_memories
      (id,user_id,workspace_id,scope,scope_key,category,ciphertext,iv,key_version,content_sha256,source_kind,status,created_at,updated_at)
      SELECT ?,?,?,'workspace',?,?,?, ?,?,?,'automatic','active',?,?
      WHERE EXISTS (SELECT 1 FROM user_memory_settings WHERE user_id=? AND automatic_enabled=1)
        AND (SELECT count(*) FROM user_memories WHERE user_id=? AND status='active') < 100
        AND NOT EXISTS (SELECT 1 FROM user_memories WHERE user_id=? AND scope_key=? AND content_sha256=? AND status='active')
      ON CONFLICT DO NOTHING`).bind(id, input.userId, input.workspaceId, `workspace:${input.workspaceId}`,
      candidate.category, encrypted.ciphertext, encrypted.iv, encrypted.keyVersion, digest, input.now, input.now,
      input.userId, input.userId, input.userId, `workspace:${input.workspaceId}`, digest),
    input.db.prepare(`INSERT INTO memory_sources(id,memory_id,conversation_id,message_id,source_type,created_at)
      SELECT ?,id,?,?,'chat',? FROM user_memories WHERE id=? AND user_id=? AND workspace_id=? AND status='active'`)
      .bind(randomUUID(), input.conversationId, input.requestMessageId, input.now, id, input.userId, input.workspaceId));
  }
  return statements;
}
