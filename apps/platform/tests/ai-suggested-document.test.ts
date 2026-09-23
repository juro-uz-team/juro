import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {POST} from "../app/api/platform/ai/suggested-document/route";
import { DOCUMENT_REGISTRY } from "../lib/document-builder/registry";
import {
  AiSuggestedDocumentError,
  createAiSuggestedDocumentDraft,
  previewAiSuggestedDocument,
  resolveAiSuggestedDocument,
} from "../lib/ai/suggested-document";
import type { UserProfile } from "../lib/document-builder/types";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const USER_ID = "user_ai_document";
const WORKSPACE_ID = `ws_${"a".repeat(32)}`;
const CONVERSATION_ID = "conversation_ai_document";
const ASSISTANT_MESSAGE_ID = "121f218d-30a1-49f7-8602-5f1b04ccd63b";
const NOW = "2026-08-03T09:00:00.000Z";
const TEMPLATE = DOCUMENT_REGISTRY.find((item) => item.status === "published");
if (!TEMPLATE) throw new Error("A published builder template is required for this test");
const PUBLISHED_TEMPLATE: NonNullable<typeof TEMPLATE> = TEMPLATE;
const SELF_PREFIXES = new Set(["applicant", "claimant", "employee", "creditor", "consumer", "requester", "principal", "author"]);
const PREFILL_TEMPLATE = DOCUMENT_REGISTRY.find((item) => item.status === "published" && item.questionnaire.some((step) =>
  step.fields.some((field) => SELF_PREFIXES.has(field.id.split(".")[0] ?? "") && field.id.endsWith(".fullName")),
));
if (!PREFILL_TEMPLATE) throw new Error("A published builder template with an eligible profile field is required");

const USER: UserProfile = {
  id: USER_ID,
  email: "ai-document@example.invalid",
  fullName: "Тестовый Пользователь",
  birthDate: "1990-01-01",
  idDocumentType: null,
  idDocumentNumber: null,
  idIssuedBy: null,
  idIssueDate: null,
  pinfl: null,
  registeredAddress: "Тестовый адрес",
  phone: "+998900000000",
};

function structuredAnswer(templateCode: string | null = PUBLISHED_TEMPLATE.code) {
  return {
    responseKind: "answer" as const,
    summary: "Подготовка документа",
    answer: "Сохранённый структурированный ответ JURO.",
    language: "ru" as const, jurisdiction: "UZ" as const,
    answerMode: "detailed" as const, reasoningMode: "deep" as const,
    clarificationQuestions: [], confirmedFindings: [], assumptions: [], risks: [], sources: [], requiredDocuments: [], actionPlan: [], deadlines: [], successOutlook: null,
    urgency: "normal" as const,
    suggestedDocument: { templateCode, title: "Непроверенное название модели", reason: "Нужен проект документа." },
    suggestLawyer: false, legalDatabaseAsOf: NOW,
  };
}

function seed(
  templateCode?: string | null,
  options: { role?: string; caseId?: string | null } = {},
) {
  const fixture = sqliteD1Fixture();
  fixture.sqlite.prepare("INSERT INTO workspaces (id,type,name,full_name,short_name,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(WORKSPACE_ID, "individual", "AI document", null, null, "ru", NOW, NOW);
  fixture.sqlite.prepare("INSERT INTO user_profiles (id,email,full_name,locale,account_type,default_workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(USER_ID, "ai-document@example.invalid", "AI Document User", "ru", "individual", WORKSPACE_ID, NOW, NOW);
  fixture.sqlite.prepare("INSERT INTO workspace_members (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("member_ai_document", WORKSPACE_ID, USER_ID, options.role ?? "owner", "active", NOW, NOW, NOW);
  if (options.caseId) {
    fixture.sqlite.prepare(`INSERT INTO cases
      (id,workspace_id,owner_user_id,account_type,locale,title,legal_area,status,current_revision,created_at,updated_at)
      VALUES (?,?,?,'individual','ru','AI document case','contracts','open',1,?,?)`)
      .run(options.caseId, WORKSPACE_ID, USER_ID, NOW, NOW);
  }
  fixture.sqlite.prepare("INSERT INTO conversations (id,workspace_id,owner_user_id,case_id,title,locale,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(CONVERSATION_ID, WORKSPACE_ID, USER_ID, options.caseId ?? null, "Документ", "ru", "active", NOW, NOW);
  fixture.sqlite.prepare("INSERT INTO conversation_messages (id,conversation_id,author_type,content,structured_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(ASSISTANT_MESSAGE_ID, CONVERSATION_ID, "assistant", "Ответ", JSON.stringify(structuredAnswer(templateCode)), NOW);
  return fixture;
}

test("AI document handoff resolves only a published template from a tenant-owned persisted answer", async () => {
  const { sqlite, d1 } = seed();
  try {
    const result = await resolveAiSuggestedDocument({ db: d1, workspaceId: WORKSPACE_ID, userId: USER_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, locale: "ru" });
    assert.deepEqual(result, { templateCode: PUBLISHED_TEMPLATE.code, categorySlug: PUBLISHED_TEMPLATE.categorySlug, title: PUBLISHED_TEMPLATE.titleRu, reason: "Нужен проект документа." });
  } finally { sqlite.close(); }
});

test("AI document preview and confirmation persist only reviewed tenant-owned values exactly once", async () => {
  const { sqlite, d1 } = seed(PREFILL_TEMPLATE.code);
  try {
    const preview = await previewAiSuggestedDocument({
      db: d1, workspaceId: WORKSPACE_ID, user: USER,
      assistantMessageId: ASSISTANT_MESSAGE_ID, locale: "ru",
    });
    assert.equal(preview.templateCode, PREFILL_TEMPLATE.code);
    assert.equal(preview.title, PREFILL_TEMPLATE.titleRu);
    assert.ok(preview.candidates.length > 0);
    assert.equal(new Set(preview.candidates.map((candidate) => candidate.fieldId)).size, preview.candidates.length);

    const candidate = preview.candidates.find((item) => item.source === "profile") ?? preview.candidates[0]!;
    const reviewedValue = "Отредактировано пользователем перед созданием";
    const input = {
      db: d1, workspaceId: WORKSPACE_ID, workspaceRole: "owner", user: USER,
      assistantMessageId: ASSISTANT_MESSAGE_ID, locale: "ru" as const,
      fields: [{ fieldId: candidate.fieldId, value: reviewedValue }],
      idempotencyKey: "ai-document-test-request-0001",
    };
    const created = await createAiSuggestedDocumentDraft(input);
    assert.equal(created.replayed, false);

    const document = sqlite.prepare("SELECT workspace_id AS workspaceId,owner_user_id AS ownerUserId,template_code AS templateCode,status FROM documents WHERE id=?")
      .get(created.documentId) as { workspaceId: string; ownerUserId: string; templateCode: string; status: string };
    assert.deepEqual({ ...document }, { workspaceId: WORKSPACE_ID, ownerUserId: USER_ID, templateCode: PREFILL_TEMPLATE.code, status: "Черновик" });
    const answers = JSON.parse((sqlite.prepare("SELECT answers_json AS answersJson FROM document_answers WHERE document_id=?")
      .get(created.documentId) as { answersJson: string }).answersJson) as Record<string, unknown>;
    assert.equal(answers[candidate.fieldId], reviewedValue);

    const handoff = sqlite.prepare(`SELECT selected_field_ids_json AS selectedFieldIdsJson,
      selection_sha256 AS selectionSha256,idempotency_key_sha256 AS idempotencyKeySha256
      FROM ai_document_prefill_handoffs WHERE document_id=?`).get(created.documentId) as {
        selectedFieldIdsJson: string; selectionSha256: string; idempotencyKeySha256: string;
      };
    assert.deepEqual(JSON.parse(handoff.selectedFieldIdsJson), [candidate.fieldId]);
    assert.match(handoff.selectionSha256, /^[0-9a-f]{64}$/);
    assert.match(handoff.idempotencyKeySha256, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(handoff.selectedFieldIdsJson, /Отредактировано/u);
    assert.ok(!(sqlite.prepare("PRAGMA table_info(ai_document_prefill_handoffs)").all() as Array<{ name: string }>).some((column) => column.name === "idempotency_key"));

    const replay = await createAiSuggestedDocumentDraft(input);
    assert.deepEqual(replay, { documentId: created.documentId, replayed: true });
    assert.equal((sqlite.prepare("SELECT count(*) AS count FROM documents WHERE workspace_id=?").get(WORKSPACE_ID) as { count: number }).count, 1);

    await assert.rejects(
      () => createAiSuggestedDocumentDraft({ ...input, fields: [{ fieldId: candidate.fieldId, value: "Другое значение" }] }),
      (error: unknown) => error instanceof AiSuggestedDocumentError && error.code === "AI_SUGGESTED_DOCUMENT_CONFLICT",
    );

    sqlite.prepare("DELETE FROM documents WHERE id=?").run(created.documentId);
    assert.equal((sqlite.prepare("SELECT count(*) AS count FROM ai_document_prefill_handoffs WHERE document_id=?").get(created.documentId) as { count: number }).count, 0);
  } finally { sqlite.close(); }
});

test("AI document confirmation rejects fields not offered by the server without creating a draft", async () => {
  const { sqlite, d1 } = seed(PREFILL_TEMPLATE.code);
  try {
    await assert.rejects(
      () => createAiSuggestedDocumentDraft({
        db: d1, workspaceId: WORKSPACE_ID, workspaceRole: "owner", user: USER,
        assistantMessageId: ASSISTANT_MESSAGE_ID, locale: "ru",
        fields: [{ fieldId: "attacker.injectedField", value: "untrusted" }],
        idempotencyKey: "ai-document-test-request-0002",
      }),
      (error: unknown) => error instanceof AiSuggestedDocumentError && error.code === "AI_SUGGESTED_DOCUMENT_INVALID",
    );
    assert.equal((sqlite.prepare("SELECT count(*) AS count FROM documents WHERE workspace_id=?").get(WORKSPACE_ID) as { count: number }).count, 0);
  } finally { sqlite.close(); }
});

test("AI document confirmation requires a separate consent for selected sensitive values", async () => {
  const { sqlite, d1 } = seed(PREFILL_TEMPLATE.code);
  try {
    const preview = await previewAiSuggestedDocument({ db: d1, workspaceId: WORKSPACE_ID, user: USER, assistantMessageId: ASSISTANT_MESSAGE_ID, locale: "ru" });
    const sensitive = preview.candidates.find((candidate) => candidate.sensitive);
    if (!sensitive) throw new Error("Expected a sensitive prefill candidate");
    const input = { db: d1, workspaceId: WORKSPACE_ID, workspaceRole: "owner", user: USER, assistantMessageId: ASSISTANT_MESSAGE_ID, locale: "ru" as const, fields: [{ fieldId: sensitive.fieldId, value: sensitive.value }], idempotencyKey: "ai-document-sensitive-consent-0001" };
    await assert.rejects(
      () => createAiSuggestedDocumentDraft(input),
      (error: unknown) => error instanceof AiSuggestedDocumentError && error.code === "AI_SUGGESTED_DOCUMENT_SENSITIVE_CONSENT_REQUIRED",
    );
    const created = await createAiSuggestedDocumentDraft({ ...input, sensitiveDataConsent: true });
    assert.equal(created.replayed, false);
  } finally { sqlite.close(); }
});

test("AI document handoff rejects foreign workspaces and unavailable model template codes", async () => {
  const foreign = seed();
  try {
    await assert.rejects(
      () => resolveAiSuggestedDocument({ db: foreign.d1, workspaceId: "ws_foreign", userId: USER_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, locale: "ru" }),
      (error: unknown) => error instanceof AiSuggestedDocumentError && error.code === "AI_SUGGESTED_DOCUMENT_NOT_FOUND",
    );
  } finally { foreign.sqlite.close(); }
  const unavailable = seed("not-a-published-template");
  try {
    await assert.rejects(
      () => resolveAiSuggestedDocument({ db: unavailable.d1, workspaceId: WORKSPACE_ID, userId: USER_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, locale: "ru" }),
      (error: unknown) => error instanceof AiSuggestedDocumentError && error.code === "AI_SUGGESTED_DOCUMENT_UNAVAILABLE",
    );
  } finally { unavailable.sqlite.close(); }
});

test("read-only members keep private AI drafts but cannot create case-linked drafts", async () => {
  const privateDraft = seed(PREFILL_TEMPLATE.code, { role: "viewer" });
  try {
    const created = await createAiSuggestedDocumentDraft({
      db: privateDraft.d1,
      workspaceId: WORKSPACE_ID,
      workspaceRole: "viewer",
      user: USER,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      locale: "ru",
      fields: [],
      idempotencyKey: "ai-document-viewer-private-0001",
    });
    const document = privateDraft.sqlite.prepare(
      "SELECT case_id AS caseId FROM documents WHERE id=?",
    ).get(created.documentId) as { caseId: string | null };
    assert.equal(document.caseId, null);
  } finally {
    privateDraft.sqlite.close();
  }

  const caseLinked = seed(PREFILL_TEMPLATE.code, {
    role: "viewer",
    caseId: "case_ai_document",
  });
  try {
    await assert.rejects(
      () => createAiSuggestedDocumentDraft({
        db: caseLinked.d1,
        workspaceId: WORKSPACE_ID,
        workspaceRole: "owner",
        user: USER,
        assistantMessageId: ASSISTANT_MESSAGE_ID,
        locale: "ru",
        fields: [],
        idempotencyKey: "ai-document-viewer-case-0001",
      }),
      (error: unknown) => error instanceof Error
        && "status" in error
        && error.status === 403,
    );
    assert.equal(
      (caseLinked.sqlite.prepare(
        "SELECT count(*) AS count FROM documents WHERE workspace_id=?",
      ).get(WORKSPACE_ID) as { count: number }).count,
      0,
    );
  } finally {
    caseLinked.sqlite.close();
  }
});

test("answer prefill preserves whole qualified findings and citations only after explicit sensitive confirmation",async()=>{
  const template=DOCUMENT_REGISTRY.find(item=>item.status==='published'&&item.questionnaire.some(step=>step.fields.some(field=>field.id==='claim.legalGrounds')));
  assert.ok(template);
  const {sqlite,d1}=seed(template.code);
  try {
    const answer={...structuredAnswer(template.code),confirmedFindings:[
      {title:'Qualified rule',explanation:'The rule applies only under condition A.',sourceIds:['law']},
      {title:'Exception',explanation:'Exception B excludes that rule.',sourceIds:['law']},
    ],sources:[{sourceId:'law',actTitle:'Official source',actIdentifier:null,article:'1',excerpt:null,
      originalUrl:'https://lex.uz/docs/1',status:'current',effectiveDate:null,verifiedAt:NOW,sourceClass:'OFFICIAL_LEGISLATION'}],
      referenceNotes:[{title:'Private context',note:'Do not copy private notes as legal grounds.',sourceIds:[]}]};
    sqlite.prepare('UPDATE conversation_messages SET structured_json=? WHERE id=?').run(JSON.stringify(answer),ASSISTANT_MESSAGE_ID);
    const scope={db:d1,workspaceId:WORKSPACE_ID,user:USER,assistantMessageId:ASSISTANT_MESSAGE_ID,locale:'ru' as const};
    const candidate=(await previewAiSuggestedDocument(scope)).candidates.find(item=>item.source==='ai_answer');
    assert.ok(candidate);assert.equal(candidate.fieldId,'claim.legalGrounds');assert.equal(candidate.sensitive,true);
    assert.equal(candidate.value,'Qualified rule\nThe rule applies only under condition A.\nOfficial source — 1: https://lex.uz/docs/1\n\nException\nException B excludes that rule.\nOfficial source — 1: https://lex.uz/docs/1');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM documents').get()?.n,0);
    const input={...scope,workspaceRole:'owner',idempotencyKey:'answer-ground-prefill-0001',fields:[{fieldId:candidate.fieldId,value:candidate.value}]};
    await assert.rejects(()=>createAiSuggestedDocumentDraft(input),(error:unknown)=>error instanceof AiSuggestedDocumentError&&error.code==='AI_SUGGESTED_DOCUMENT_SENSITIVE_CONSENT_REQUIRED');
    const created=await createAiSuggestedDocumentDraft({...input,sensitiveDataConsent:true});
    const stored=sqlite.prepare('SELECT answers_json FROM document_answers WHERE document_id=?').get(created.documentId);
    assert.equal(JSON.parse(String(stored?.answers_json))['claim.legalGrounds'],candidate.value);
  }finally{sqlite.close();}
});

test("answer prefill never drops unsupported or historical qualifications to offer a partial legal basis",async()=>{
  const template=DOCUMENT_REGISTRY.find(item=>item.status==='published'&&item.questionnaire.some(step=>step.fields.some(field=>field.id==='claim.legalGrounds')));
  assert.ok(template);
  const {sqlite,d1}=seed(template.code);
  try {
    for(const variant of ['private','historical','missing','overflow']) {
      const answer={...structuredAnswer(template.code),confirmedFindings:Array.from({length:variant==='overflow'?16:2},(_,i)=>({
        title:'Rule',explanation:variant==='overflow'?'x'.repeat(4000):'Condition must remain with the rule.',sourceIds:[i===0?'official':'qualification'],
      })),sources:[{sourceId:'official',actTitle:'Official source',actIdentifier:null,article:null,excerpt:null,
        originalUrl:'https://lex.uz/docs/1',status:'current',effectiveDate:null,verifiedAt:NOW,sourceClass:'OFFICIAL_LEGISLATION'},
      ...(variant==='missing'?[]:[{sourceId:'qualification',actTitle:'Qualification',actIdentifier:null,article:null,excerpt:null,
        originalUrl:'https://lex.uz/docs/2',status:variant==='historical'?'historical':'current',effectiveDate:null,verifiedAt:NOW,
        sourceClass:variant==='private'?'USER_TRUSTED_PRIVATE':'OFFICIAL_LEGISLATION'}])]};
      sqlite.prepare('UPDATE conversation_messages SET structured_json=? WHERE id=?').run(JSON.stringify(answer),ASSISTANT_MESSAGE_ID);
      const preview=await previewAiSuggestedDocument({db:d1,workspaceId:WORKSPACE_ID,user:USER,assistantMessageId:ASSISTANT_MESSAGE_ID,locale:'ru'});
      assert.equal(preview.candidates.some(item=>item.source==='ai_answer'),false,variant);
    }
  }finally{sqlite.close();}
});

test("concurrent confirmations create one draft and replay survives profile changes but not revoked membership", async () => {
  const { sqlite, d1 } = seed(PREFILL_TEMPLATE.code);
  try {
    const input = { db: d1, workspaceId: WORKSPACE_ID, workspaceRole: "owner", user: USER,
      assistantMessageId: ASSISTANT_MESSAGE_ID, locale: "ru" as const, fields: [],
      idempotencyKey: "concurrent-document-confirmation" };
    const results = await Promise.all([createAiSuggestedDocumentDraft(input), createAiSuggestedDocumentDraft(input)]);
    assert.equal(results[0].documentId, results[1].documentId);
    assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
    assert.equal((sqlite.prepare("SELECT count(*) AS count FROM documents").get() as { count: number }).count, 1);
    assert.deepEqual(await createAiSuggestedDocumentDraft({ ...input, user: { ...USER, fullName: "Changed profile" } }),
      { documentId: results[0].documentId, replayed: true });
    await assert.rejects(() => createAiSuggestedDocumentDraft({ ...input, user: { ...USER, id: "foreign-user" } }),
      (error: unknown) => error instanceof AiSuggestedDocumentError && error.code === "AI_SUGGESTED_DOCUMENT_NOT_FOUND");
    sqlite.prepare("UPDATE workspace_members SET status='inactive' WHERE user_id=?").run(USER_ID);
    await assert.rejects(() => createAiSuggestedDocumentDraft(input),
      (error: unknown) => error instanceof AiSuggestedDocumentError && error.code === "AI_SUGGESTED_DOCUMENT_NOT_FOUND");
  } finally { sqlite.close(); }
});

test("document handoff HTTP boundary uses the selected workspace and saved template, with explicit replayable confirmation",async context=>{
  const {sqlite,d1}=seed(PREFILL_TEMPLATE.code);context.after(()=>sqlite.close());
  const bindings={DB:d1,APP_ENV:"development",ALLOW_PLATFORM_AUTH_HEADERS:"true",IDENTITY_PROTECTION_MODE:"legacy"};
  const previous=Object.fromEntries(Object.keys(bindings).map(key=>[key,Reflect.get(env,key)]));
  Object.assign(env,bindings);context.after(()=>Object.assign(env,previous));
  const otherWorkspace=`ws_${"b".repeat(32)}`;
  sqlite.prepare("INSERT INTO workspaces (id,type,name,locale,created_at,updated_at) VALUES (?,'individual','Other','ru',?,?)").run(otherWorkspace,NOW,NOW);
  sqlite.prepare("INSERT INTO workspace_members (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES ('other-member',?,?,'owner','active',?,?,?)").run(otherWorkspace,USER_ID,NOW,NOW,NOW);
  sqlite.prepare("UPDATE user_profiles SET default_workspace_id=? WHERE id=?").run(otherWorkspace,USER_ID);
  const request=(body:unknown,selected=WORKSPACE_ID)=>new Request("https://app.example/api/platform/ai/suggested-document",{method:"POST",
    headers:{"oai-authenticated-user-email":"ai-document@example.invalid",origin:"https://app.example","x-juro-csrf":"1",
      "content-type":"application/json","x-juro-workspace-id":selected,"idempotency-key":"http-document-confirmation-0001"},body:JSON.stringify(body)});
  const previewInput={action:"preview",assistantMessageId:ASSISTANT_MESSAGE_ID,locale:"ru"};
  const preview=await POST(request(previewInput));assert.equal(preview.status,200);
  assert.match(preview.headers.get("cache-control")??"",/no-store/);
  assert.equal((await preview.json() as {templateCode:string}).templateCode,PREFILL_TEMPLATE.code);
  assert.equal((await POST(request(previewInput,otherWorkspace))).status,404);
  assert.equal((await POST(request({...previewInput,templateCode:PUBLISHED_TEMPLATE.code}))).status,400);
  const crossOrigin=request(previewInput);crossOrigin.headers.set("origin","https://foreign.example");
  assert.equal((await POST(crossOrigin)).status,403);
  const noCsrf=request(previewInput);noCsrf.headers.delete("x-juro-csrf");assert.equal((await POST(noCsrf)).status,403);
  const noAuth=request(previewInput);noAuth.headers.delete("oai-authenticated-user-email");assert.equal((await POST(noAuth)).status,401);
  const confirm={...previewInput,action:"confirm",fields:[]};
  const noKey=request(confirm);noKey.headers.delete("idempotency-key");assert.equal((await POST(noKey)).status,400);
  const first=await POST(request(confirm));assert.equal(first.status,200);
  const created=await first.json() as {documentId:string;replayed:boolean};assert.equal(created.replayed,false);
  assert.deepEqual(await (await POST(request(confirm))).json(),{documentId:created.documentId,replayed:true});
  const stored=sqlite.prepare("SELECT workspace_id AS workspaceId FROM documents WHERE id=?").get(created.documentId) as {workspaceId:string};
  assert.equal(stored.workspaceId,WORKSPACE_ID);
  const answers=JSON.parse((sqlite.prepare("SELECT answers_json AS answersJson FROM document_answers WHERE document_id=?").get(created.documentId) as {answersJson:string}).answersJson);
  assert(!Object.values(answers).includes(USER.fullName),"Unselected profile values must not be copied");
});

test("Cyrillic answer prefill respects the complete HTTP byte budget without truncating qualifications",async context=>{
  const template=DOCUMENT_REGISTRY.find(item=>item.status==='published'&&item.questionnaire.some(step=>step.fields.some(field=>field.id==='claim.legalGrounds')));
  assert.ok(template);
  const {sqlite,d1}=seed(template.code);context.after(()=>sqlite.close());
  const bindings={DB:d1,APP_ENV:'development',ALLOW_PLATFORM_AUTH_HEADERS:'true',IDENTITY_PROTECTION_MODE:'legacy'};
  const previous=Object.fromEntries(Object.keys(bindings).map(key=>[key,Reflect.get(env,key)]));
  Object.assign(env,bindings);context.after(()=>Object.assign(env,previous));
  const request=(body:unknown)=>new Request('https://app.example/api/platform/ai/suggested-document',{method:'POST',
    headers:{'oai-authenticated-user-email':'ai-document@example.invalid',origin:'https://app.example','x-juro-csrf':'1',
      'content-type':'application/json','x-juro-workspace-id':WORKSPACE_ID,'idempotency-key':'multilingual-prefill-http-0001'},body:JSON.stringify(body)});
  const scope={assistantMessageId:ASSISTANT_MESSAGE_ID,locale:'ru'};
  for(const count of [10,6]) {
    const answer={...structuredAnswer(template.code),confirmedFindings:Array.from({length:count},()=>({
      title:'Условие',explanation:'я'.repeat(3900)+' Только при сохранении условия.',sourceIds:['law'],
    })),sources:[{sourceId:'law',actTitle:'Закон',actIdentifier:null,article:'1',excerpt:null,
      originalUrl:'https://lex.uz/docs/1',status:'current',effectiveDate:null,verifiedAt:NOW,sourceClass:'OFFICIAL_LEGISLATION'}]};
    sqlite.prepare('UPDATE conversation_messages SET structured_json=? WHERE id=?').run(JSON.stringify(answer),ASSISTANT_MESSAGE_ID);
    const response=await POST(request({...scope,action:'preview'}));assert.equal(response.status,200);
    const preview=await response.json() as {candidates:Array<{fieldId:string;value:string;source:string}>};
    const grounds=preview.candidates.find(item=>item.source==='ai_answer');
    if(count===10){assert.equal(grounds,undefined);continue;}
    assert.ok(grounds);assert.equal(grounds.value.split('Только при сохранении условия.').length-1,6);
    const body={...scope,action:'confirm',sensitiveDataConsent:true,fields:preview.candidates.map(({fieldId,value})=>({fieldId,value}))};
    assert.ok(new TextEncoder().encode(JSON.stringify(body)).byteLength<=64_000);
    const confirmed=await POST(request(body));assert.equal(confirmed.status,200);
    const created=await confirmed.json() as {documentId:string};
    const row=sqlite.prepare('SELECT answers_json FROM document_answers WHERE document_id=?').get(created.documentId);
    assert.equal(JSON.parse(String(row?.answers_json))['claim.legalGrounds'],grounds.value);
  }
});
