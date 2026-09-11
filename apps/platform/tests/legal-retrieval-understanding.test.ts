import assert from "node:assert/strict";
import test from "node:test";
import { planFromQuestionPlanningHints } from "../lib/legal-corpus/target-retrieval";
import { targetRequirementSupportContext } from "../lib/legal-corpus/target-reasoning-service";
import { parseCompactQuestionInterpretation, questionInterpretationInput, questionInterpretationJsonSchemaForQuestions } from "../lib/legal/question-interpretation";

test("provider origin ranges are bounded separately by each supplied question", () => {
  const schema = questionInterpretationJsonSchemaForQuestions(["Current question", "A longer prior question here"]);
  const origin = JSON.parse(JSON.stringify(schema)).properties.requirements.items.properties.origin;
  assert.equal(origin?.anyOf?.[0]?.properties?.questionIndex?.const,0);
  assert.equal(origin?.anyOf?.[0]?.properties?.endToken?.maximum,1);
  assert.equal(origin?.anyOf?.[1]?.properties?.questionIndex?.const,1);
  assert.equal(origin?.anyOf?.[1]?.properties?.endToken?.maximum,4);
  assert.throws(() => questionInterpretationJsonSchemaForQuestions([" "]), /QUESTION_SOURCE_EMPTY/u);
});

test("discovery retains each question's action and object despite incomplete shared context", () => {
  const cases = [
    {questions:["Can a purchaser obtain residence? May a person carry a kitchen knife in public?"],
      quotation:"in public?",questionIndex:0,context:"a purchaser",expected:["kitchen knife", "carry"]},
    {questions:["What changes if some goods are resold?", "Which storage and reporting rules apply to a buyer?"],
      quotation:"reporting",questionIndex:1,context:"some goods",expected:["resold", "reporting", "buyer"]},
    {questions:["What filing periods for a buyer and seller did Article 17 establish on 2018-01-01?"],
      quotation:"seller",questionIndex:0,context:"buyer and seller",expected:["filing periods", "Article 17", "2018-01-01"]},
  ];
  for (const fixture of cases) {
    const understanding = projectLegalRetrievalPlan({scopeSource:"user_question",answerLanguage:"en",
      relationship:fixture.questions.length > 1 ? "continuation" : "independent",
      questionAccounting:Object.fromEntries(fixture.questions.map((_,index)=>[`q${index}`,{
        disposition:"active",contextQuotation:index===0?fixture.context:null,currentQuestionQuotation:null,explanation:null,
      }])),
      requirements:[{origin:{kind:"explicit_question",questionIndex:fixture.questionIndex,quotation:fixture.quotation},
        scopeKind:"general",priority:"core",unresolvedDimensions:[]}],temporalEndpoint:null,comparison:null,missingFacts:[]},
    fixture.questions[0]!,fixture.questions.slice(1));
    const hints = targetQuestionPlanningHints(understanding,"en")!;
    const plan = planFromQuestionPlanningHints("complete-discovery-context",hints);
    const scoped = plan.formulations.find(item=>item.text.startsWith(fixture.quotation));
    assert.ok(scoped);
    for (const expected of fixture.expected) assert.ok(scoped.text.includes(expected),expected);
  }
});

test("indexed source spans reopen exact user text without model-authored quotations", () => {
  const question = "Must a buyer hire  special staff?";
  const input = questionInterpretationInput([question], "en");
  assert.deepEqual(input.questions[0]?.tokens, [[0,"Must"],[1,"a"],[2,"buyer"],[3,"hire"],[4,"special"],[5,"staff?"]]);
  const value = {scopeSource:"user_question",relationship:"independent",answerLanguage:"en",
    requirements:[{origin:{kind:"explicit_question",questionIndex:0,startToken:3,endToken:5},
      scopeKind:"general",priority:"core",unresolvedDimensions:[]}],
    questionAccounting:{q0:{disposition:"active",contextRange:{startToken:1,endToken:2},currentQuestionRange:null,explanation:null}},
    temporalEndpoint:null,comparison:null,missingFacts:[]};
  const parsed = parseCompactQuestionInterpretation(value,[question],{requireQuestionAccounting:true});
  assert.equal(parsed.requirements[0]?.origin.quotation,"hire  special staff?");
  assert.equal(parsed.questionAccounting?.q0?.contextQuotation,"a buyer");
  assert.throws(()=>parseCompactQuestionInterpretation({...value,requirements:[{...value.requirements[0],
    origin:{...value.requirements[0]!.origin,endToken:90}}]},[question]),/QUESTION_SOURCE_RANGE_INVALID/u);
});

test("indexed follow-up spans retain late facts, original whitespace and independent repeated scopes", () => {
  const current = "Now the buyer resells. " + "Context ".repeat(950) + "Only outside the city.";
  const prior = "Buyer reporting; seller reporting; café\tstaff.";
  assert.ok(current.length < 8_000);
  const input = questionInterpretationInput([current, prior], "en");
  const tokens = input.questions[0]!.tokens;
  assert.deepEqual(tokens.at(-1), [tokens.length - 1, "city."]);
  const value = {scopeSource:"user_question",relationship:"continuation",answerLanguage:"en",
    requirements: [
      {origin:{kind:"explicit_question",questionIndex:1,startToken:1,endToken:1},scopeKind:"general",priority:"core",unresolvedDimensions:[]},
      {origin:{kind:"explicit_question",questionIndex:1,startToken:3,endToken:3},scopeKind:"general",priority:"core",unresolvedDimensions:[]},
      {origin:{kind:"explicit_question",questionIndex:1,startToken:4,endToken:5},scopeKind:"general",priority:"core",unresolvedDimensions:[]},
    ],
    questionAccounting:{
      q0:{disposition:"active",contextRange:{startToken:0,endToken:3},currentQuestionRange:null,explanation:null},
      q1:{disposition:"active",contextRange:null,currentQuestionRange:null,explanation:null},
    },temporalEndpoint:null,comparison:null,missingFacts:[]};
  const parsed = parseCompactQuestionInterpretation(value,[current,prior],{requireQuestionAccounting:true});
  assert.deepEqual(parsed.requirements.map(item => item.origin.quotation), ["reporting;", "reporting;", "café\tstaff."]);
  const projected = projectLegalRetrievalPlan(parsed,current,[prior]);
  assert.equal(projected.requiredConcepts.length,3);
  const context = targetRequirementSupportContext(planFromQuestionPlanningHints("repeated-source-occurrences",
    targetQuestionPlanningHints(projected,"en")!));
  assert.deepEqual(context[0]?.origin, {kind:"explicit_question",questionIndex:1,quotation:"reporting;",tokenRange:{startToken:1,endToken:1}});
  assert.deepEqual(context[1]?.origin, {kind:"explicit_question",questionIndex:1,quotation:"reporting;",tokenRange:{startToken:3,endToken:3}});
  assert.deepEqual(context[0]?.questionSelection,{before:"Buyer ",selected:"reporting;",after:" seller reporting; café\tstaff."});
  assert.deepEqual(context[1]?.questionSelection,{before:"Buyer reporting; seller ",selected:"reporting;",after:" café\tstaff."});
  for (const requirement of projected.requiredConcepts) {
    assert.deepEqual(requirement.questionContext,{questions:[current,prior],sourceQuestionIndex:1});
  }
  assert.deepEqual(parsed.questionAccounting?.q0?.requirementIndexes,[0,1,2]);
  assert.deepEqual(parsed.questionAccounting?.q1?.requirementIndexes,[0,1,2]);
  assert.throws(() => parseCompactQuestionInterpretation({...parsed,requirements:[{...parsed.requirements[0],
    origin:{...parsed.requirements[0]!.origin,tokenRange:{startToken:0,endToken:0}}},...parsed.requirements.slice(1)]},[current,prior]),
  /QUESTION_REQUIREMENT_RANGE_MISMATCH/u);
  for (const origin of [
    {kind:"explicit_question",questionIndex:1,startToken:3,endToken:1},
    {kind:"explicit_question",questionIndex:1,startToken:0,endToken:tokens.length - 1},
    {kind:"explicit_question",questionIndex:2,startToken:0,endToken:1},
  ]) assert.throws(() => parseCompactQuestionInterpretation({...value,
    requirements:[{...value.requirements[0],origin}]},[current,prior],{requireQuestionAccounting:true}),/QUESTION_SOURCE_RANGE_INVALID/u);
});

test("a continuation must explicitly account for prior user questions and retain an active antecedent", () => {
  const questions = ["What if part is resold?", "Which registration and reporting obligations apply?"];
  const value = {scopeSource: "user_question", relationship: "continuation", answerLanguage: "en",
    requirements: [{statement: "reporting rules", scopeKind: "general", priority: "core", unresolvedDimensions: [],
      origin: {kind: "explicit_question", questionIndex: 1, quotation: "reporting"}}],
    questionAccounting: {q0: {disposition: "active", requirementIndexes: [0], currentQuestionQuotation: null,
      explanation: "Current facts change the earlier reporting question."},
      q1: {disposition: "active", requirementIndexes: [0], currentQuestionQuotation: null,
        explanation: "The earlier question remains active."}}, temporalEndpoint: null, comparison: null, missingFacts: []};
  assert.equal(parseCompactQuestionInterpretation(value, questions).relationship, "continuation");
  assert.throws(() => parseCompactQuestionInterpretation({...value, questionAccounting: {q0:value.questionAccounting.q0}}, questions), /QUESTION_ACCOUNTING/u);
  assert.throws(() => parseCompactQuestionInterpretation({...value, questionAccounting: {...value.questionAccounting,
    q1:{disposition:"context_only",requirementIndexes:[],currentQuestionQuotation:"resold",explanation:"Earlier context"}}}, questions), /QUESTION_ACCOUNTING/u);
  assert.throws(() => parseCompactQuestionInterpretation({...value, questionAccounting: {...value.questionAccounting,
    q1:{...value.questionAccounting.q1,requirementIndexes:[8]}}}, questions), /QUESTION_ACCOUNTING/u);
});

test("extractive plans derive associations from origins and never search invented optional context", () => {
  const questions = ["What if part is resold?", "Which fees and reporting apply to a buyer of equipment?"];
  const value = {scopeSource: "user_question", relationship: "continuation", answerLanguage: "en",
    requirements: ["fees", "reporting"].map(quotation => ({scopeKind: "general", priority: "core", unresolvedDimensions: [],
      origin: {kind: "explicit_question", questionIndex: 1, quotation}})),
    questionAccounting: {q0:{disposition:"active",currentQuestionQuotation:null,contextQuotation:"part is resold",explanation:null},
      q1:{disposition:"active",currentQuestionQuotation:null,contextQuotation:"invented unrelated actor",explanation:null}},
    temporalEndpoint:null,comparison:null,missingFacts:[]};
  const parsed = parseCompactQuestionInterpretation(value, questions, {requireQuestionAccounting:true});
  assert.deepEqual(parsed.questionAccounting?.q0?.requirementIndexes, [0,1]);
  assert.deepEqual(parsed.questionAccounting?.q1?.requirementIndexes, [0,1]);
  assert.equal(parsed.questionAccounting?.q1?.contextQuotation, null);
  assert.match(parsed.requirements[0]!.searchPhrase, /part is resold/u);
  assert.match(parsed.requirements[0]!.searchPhrase, /buyer of equipment/u);
  assert.doesNotMatch(parsed.requirements[0]!.searchPhrase, /invented unrelated actor/u);
});

test("search hypotheses cannot replace contextual obligations or resolve unspecified dimensions in projection", () => {
  const question = "Must I engage a specialist to supply equipment, and what is the filing deadline for a dispute?";
  const requirements = [
    {statement: "Whether supplying equipment requires engaging a specialist", searchPhrase: "equipment specialist qualifications",
      scopeKind: "general", priority: "core", unresolvedDimensions: [],
      origin: {kind: "explicit_question", questionIndex: 0, quotation: "Must I engage a specialist"}},
    {statement: "Applicable filing periods for the dispute across the unspecified forums and claim kinds",
      searchPhrase: "court dispute filing period", scopeKind: "forum", priority: "core",
      unresolvedDimensions: ["forum", "claim_kind"],
      origin: {kind: "explicit_question", questionIndex: 0, quotation: "filing deadline for a dispute"}},
  ];
  const understanding = projectLegalRetrievalPlan({standaloneQuestion: question, requirements,
    temporalEndpoint: null, comparison: null, missingFacts: []}, question);
  const plan = planFromQuestionPlanningHints("separate-purpose-and-discovery", targetQuestionPlanningHints(understanding, "en")!);
  const context = targetRequirementSupportContext(plan);
  assert.deepEqual(context.map(item => item.statement), requirements.map(item => item.statement));
  assert.deepEqual(context[1]!.unresolvedDimensions, ["forum", "claim_kind"]);
  assert.ok(plan.formulations.some(item => item.text === "court dispute filing period"));
  assert.equal(context[0]!.statement.includes("Whether"), true);
  assert.equal(context[1]!.statement.includes("court"), false);
});

test("user-anchored coverage preserves full context without inheriting a search hypothesis's actor or forum", () => {
  const source = "Must the buyer hire a specialist, and what are the dispute filing periods?";
  const current = "What changes if the goods are resold? " + "Additional context. ".repeat(80) + "The buyer is a cooperative.";
  const understanding = projectLegalRetrievalPlan({scopeSource: "user_question", answerLanguage: "en",
    requirements: [
      {statement: "court employee filing periods", scopeKind: "forum", priority: "core", unresolvedDimensions: ["actor", "forum"],
        origin: {kind: "explicit_question", questionIndex: 1, quotation: "dispute filing periods"}},
      {statement: "specialist qualifications", scopeKind: "general", priority: "core", unresolvedDimensions: [],
        origin: {kind: "explicit_question", questionIndex: 1, quotation: "hire a specialist"}},
    ], temporalEndpoint: null, comparison: null, missingFacts: []}, current, [source]);
  const plan = planFromQuestionPlanningHints("source-context", targetQuestionPlanningHints(understanding, "en")!);
  const context = targetRequirementSupportContext(plan);
  assert.equal(context[0]!.statement, "dispute filing periods");
  assert.equal(context[1]!.statement, "hire a specialist");
  assert.deepEqual(context[0]!.questionContext, {questions: [current, source], sourceQuestionIndex: 1});
  assert.deepEqual(context[1]!.questionContext, context[0]!.questionContext);
  assert.ok(plan.formulations.some(item => item.text === "court employee filing periods"));
});

import {
  projectLegalRetrievalPlan,
  normalizeLegalRetrievalUnderstanding,
  RETRIEVAL_PLANNER_RESPONSE_LIMITS,
  targetQuestionPlanningHints,
  fallbackLegalRetrievalUnderstanding,
} from "../lib/legal/legal-retrieval-understanding";

test("ellipsis shorthand is recovered only to one exact bounded user-origin span", () => {
  const previous = "Which standards apply to storage, reporting, taxes and staffing?";
  const current = "What if some goods are resold?";
  const plan = (quotation: string) => ({answerLanguage: "en", standaloneQuestion: current,
    requirements: [{statement: "Reporting obligations for resale", scopeKind: "general", priority: "core",
      origin: {kind: "explicit_question", questionIndex: 1, quotation}}],
    temporalEndpoint: null, comparison: null, missingFacts: []});
  const projected = projectLegalRetrievalPlan(plan("standards apply to ... reporting"), current, [previous]);
  assert.equal(projected.requiredConcepts[0]!.origin?.quotation, "standards apply to storage, reporting");
  assert.throws(() => projectLegalRetrievalPlan(plan("invented standard ... reporting"), current, [previous]), /ORIGIN_INVALID/);
  assert.throws(() => projectLegalRetrievalPlan(plan("standards apply to ... reporting"), current, [`${previous} ${previous}`]), /ORIGIN_INVALID/);
  assert.throws(() => projectLegalRetrievalPlan(plan("... reporting"), current, [previous]), /ORIGIN_INVALID/);
});

test("named status and forum survive a planner query that omits their names", () => {
  const status = "Licensed temporary representative";
  const forum = "Independent review board";
  const query = "Conditions and exceptions during the current procedure";
  const understanding = projectLegalRetrievalPlan({
    standaloneQuestion: "Which restrictions and filing periods apply?",
    generalQuery: "Ordinary restrictions during the procedure",
    personalStatuses: [{status, query}], forums: [{forum, query: "Applicant filing period"}],
    concepts: [], consequences: null,
  }, "Which restrictions and filing periods apply?");
  const hints = targetQuestionPlanningHints(understanding, "en")!;
  const context = targetRequirementSupportContext(planFromQuestionPlanningHints("named-scopes", hints));
  assert.equal(context[1]?.statement, `${status}: ${query}`);
  assert.equal(context[2]?.statement, `${forum}: Applicant filing period`);
  assert.ok(hints.formulations.includes(`${status}: ${query}`));
  assert.ok(hints.formulations.includes(`${forum}: Applicant filing period`));
});

test("the full bounded named scope and query reach assessment without truncation", () => {
  const status = "s".repeat(100);
  const query = "q".repeat(240);
  const understanding = projectLegalRetrievalPlan({standaloneQuestion: "Original question",
    generalQuery: "Ordinary governing rule", personalStatuses: [{status, query}],
    forums: [], concepts: [], consequences: null}, "Original question");
  const hints = targetQuestionPlanningHints(understanding, "en")!;
  const context = targetRequirementSupportContext(planFromQuestionPlanningHints("bounded-scope", hints));
  assert.equal(context[1]?.statement, `${status}: ${query}`);
  assert.ok(hints.formulations.includes(`${status}: ${query}`));
});

test("retrieval planner starts structured output directly with a bounded response budget", () => {
  assert.deepEqual(RETRIEVAL_PLANNER_RESPONSE_LIMITS, {
    maxOutputTokens: 3_072,
    reasoningEffort: "none",
  });
});

test("scope types survive normalization, formulation planning and support assessment", () => {
const scopes = ["general", "personal_status", "action_stage", "forum", "claim_kind", "consequence"] as const;
  const understanding = normalizeLegalRetrievalUnderstanding({standaloneQuestion: "Independent scopes",
    corpusQueries: ["Independent scopes"], lexSearchQueries: ["Independent scopes"], webSearchQuery: "Independent scopes",
    requiredConcepts: scopes.map(scopeKind => ({statement: `Rule for ${scopeKind}`, alternatives: [`Query for ${scopeKind}`],
      priority: "core", scopeKind})),
  }, "Independent scopes");
  const hints = targetQuestionPlanningHints(understanding, "en")!;
  const context = targetRequirementSupportContext(planFromQuestionPlanningHints("scope-preservation", hints));
  assert.deepEqual(context.map(requirement => requirement.scopeKind), scopes);
  assert.equal(hints.formulations.length, scopes.length);
  assert.deepEqual(hints.formulationRequirementIndexes, scopes.map((_, index) => [index]));
});

test("provider-sized retrieval plans are bounded without discarding semantic queries", () => {
  const originalQuery = "можно ли уволить сотрудника в декрете";
  const plan = normalizeLegalRetrievalUnderstanding({
    standaloneQuestion: "  прекращение трудового договора с работником в отпуске по уходу за ребёнком  ",
    corpusQueries: Array.from({ length: 8 }, (_, index) => `семантическая гипотеза ${index}`),
    requiredConcepts: Array.from({ length: 6 }, (_, conceptIndex) => ({
      statement: `требование ${conceptIndex}`,
      alternatives: Array.from({ length: 8 }, (_, alternativeIndex) =>
        `понятие ${conceptIndex} вариант ${alternativeIndex}`),
    })),
    lexSearchQueries: Array.from({ length: 7 }, (_, index) => `поиск ${index}`),
    webSearchQuery: "  увольнение во время отпуска по уходу за ребенком Узбекистан  ",
  }, originalQuery);

  assert.equal(plan.corpusQueries[0], plan.standaloneQuestion);
  assert.equal(plan.corpusQueries.length, 3);
  assert.equal(plan.requiredConcepts.length, 6);
  assert.ok(plan.requiredConcepts.every((concept) => concept.alternatives.length === 5));
  assert.equal(plan.lexSearchQueries.length, 4);
  assert.match(plan.standaloneQuestion, /прекращение трудового договора/u);
});

test("an oversized requirement inventory is rejected instead of silently losing its last scope", () => {
  assert.throws(() => normalizeLegalRetrievalUnderstanding({standaloneQuestion: "Independent scopes",
    corpusQueries: [], lexSearchQueries: [], webSearchQuery: "Independent scopes",
    requiredConcepts: Array.from({length: 21}, (_, index) => ({statement: `Scope ${index}`,
      alternatives: [`Scope ${index}`], priority: "core"})),
  }, "Independent scopes"));
});

test("broad unrelated obligations retain all independent requirement associations", () => {
  const statements = ["Permit for an activity", "Storage conditions", "Periodic reporting",
    "Tax treatment", "Excise eligibility", "Personnel qualifications", "Transport requirements",
    "Safety inspection", "Waste disposal", "Record retention", "Consumer disclosure"];
  const understanding = normalizeLegalRetrievalUnderstanding({standaloneQuestion: "Which obligations apply?",
    corpusQueries: [], lexSearchQueries: [], webSearchQuery: "Which obligations apply?",
    requiredConcepts: statements.map(statement => ({statement, alternatives: [statement], priority: "core"})),
  }, "Which obligations apply?");
  const plan = planFromQuestionPlanningHints("independent-obligations", targetQuestionPlanningHints(understanding, "en")!);
  assert.deepEqual(plan.readings.flatMap(reading => reading.requirements.map(requirement => requirement.statement)), statements);
  for (const requirement of plan.readings[0]!.requirements) {
    assert.ok(plan.formulations.some(formulation => formulation.requirementIds.includes(requirement.id)));
  }
});

test("compact independent scopes preserve user origin and historical applicability", () => {
  const query = "Storage, reporting, excise, tax, personnel and transport under Article 88 as of 2018-01-01.";
  const statements = ["Storage", "reporting", "excise", "tax", "personnel", "transport"];
  const value = {standaloneQuestion: query, requirements: statements.map(statement => ({statement,
    scopeKind: "action_stage", priority: "core", origin: {kind: "explicit_question", questionIndex: 0, quotation: statement}})),
    temporalEndpoint: {kind: "timestamp", instant: "2018-01-01T00:00:00Z", origin: {questionIndex: 0, quotation: "2018-01-01"}}, comparison: null, missingFacts: []};
  const understanding = projectLegalRetrievalPlan(value, query);
  const plan = planFromQuestionPlanningHints("independent-compact", targetQuestionPlanningHints(understanding, "en")!);
  assert.deepEqual(plan.readings[0]!.requirements.map(requirement => requirement.statement), statements);
  assert.deepEqual(plan.readings[0]!.requirements.map(requirement => requirement.origin), value.requirements.map(requirement => requirement.origin));
  assert.deepEqual(plan.temporalEndpoint, {kind: "timestamp", instant: "2018-01-01T00:00:00.000Z"});
});

test("planner reference provenance rejects invention and preserves user-supplied historical references", () => {
  const make = (query: string, statement: string) => ({standaloneQuestion: query, requirements: [{statement,
    scopeKind: "claim_kind", priority: "core", origin: {kind: "explicit_question", questionIndex: 0, quotation: query}}],
    temporalEndpoint: null, comparison: null, missingFacts: []});
  assert.throws(() => projectLegalRetrievalPlan(make("Filing period", "Filing period under Article 987"), "Filing period"), /UNGROUNDED/u);
  for (const article of [88, 412]) {
    const query = `What did Article ${article} provide in 2018?`;
    assert.equal(projectLegalRetrievalPlan(make(query, query), query).requiredConcepts[0]!.statement, query);
  }
  assert.throws(() => projectLegalRetrievalPlan(make("invented user fact", "Filing period"), "Actual user question"), /ORIGIN_INVALID/u);
});

test("temporal interpretation validates quoted dates instead of trusting provider instants", () => {
  const make = (query: string, quotation: string, instant = "2018-01-01T00:00:00Z") => ({
    standaloneQuestion: query, requirements: [{statement: "Applicable rule", scopeKind: "general", priority: "core",
      origin: {kind: "explicit_question", questionIndex: 0, quotation: query}}],
    temporalEndpoint: {kind: "timestamp", instant, origin: {questionIndex: 0, quotation}}, comparison: null, missingFacts: [],
  });
  for (const date of ["2018-01-01", "01.01.2018", "1 января 2018", "January 1, 2018", "2018-yil 1-yanvar"]) {
    const query = `Applicable rule: ${date}`;
    assert.equal(projectLegalRetrievalPlan(make(query, date), query).temporalEndpoint?.kind, "timestamp");
    assert.throws(() => projectLegalRetrievalPlan(make(query, date, "2019-01-01T00:00:00Z"), query), /TEMPORAL_REFERENCE_UNGROUNDED/u);
  }
  const query = "Which rule applies today?";
  assert.throws(() => projectLegalRetrievalPlan(make(query, "2018-01-01"), query), /TEMPORAL_ORIGIN_INVALID/u);
  assert.throws(() => projectLegalRetrievalPlan(make(query, query), query), /TEMPORAL_REFERENCE_UNGROUNDED/u);
  assert.throws(() => projectLegalRetrievalPlan(make("Rule in 2018", "2018"), "Rule in 2018"), /TEMPORAL_REFERENCE_UNGROUNDED/u);
  assert.throws(() => projectLegalRetrievalPlan(make("Rule on 2018-02-30", "2018-02-30", "2018-03-02T00:00:00Z"), "Rule on 2018-02-30"), /TEMPORAL_REFERENCE_UNGROUNDED/u);
});

test("every scope in the complete compact provider shape survives projection and target associations", () => {
  const understanding = projectLegalRetrievalPlan({
    standaloneQuestion: "Which rules apply to these people, stages and forums?",
    generalQuery: "Ordinary governing rule",
    personalStatuses: [{status: "First status", query: "First status rule"},
      {status: "Second status", query: "Second status rule"}],
    forums: [{forum: "First forum", query: "First filing rule"},
      {forum: "Second forum", query: "Second filing rule"}],
    concepts: [{statement: "Independent event restriction", scopeKind: "action_stage", priority: "core"},
      {statement: "Independent claimant rule", scopeKind: "claim_kind", priority: "core"}],
    consequences: "Conditional consequence",
  }, "Which rules apply?");
  assert.equal(understanding.requiredConcepts.length, 8);
  const hints = targetQuestionPlanningHints(understanding, "en")!;
  assert.equal(hints.formulations.length, 8);
  assert.deepEqual(hints.formulations, understanding.requiredConcepts.map(concept => concept.alternatives[0]));
  assert.deepEqual(hints.formulationRequirementIndexes, Array.from({length: 8}, (_, index) => [index]));
  const target = planFromQuestionPlanningHints("complete-compact-plan", hints);
  assert.deepEqual(target.readings.flatMap(reading => reading.requirements.map(requirement => requirement.statement)),
    understanding.requiredConcepts.map(concept => concept.statement));
  assert.deepEqual(target.formulations.map(formulation => formulation.requirementIds),
    Array.from({length: 8}, (_, index) => [`requirement-${index + 1}`]));
  assert.equal(target.readings[0]!.requirements[7]!.priority, "supporting");
});

test("empty optional planner values degrade to the original query, not an invalid-output failure", () => {
  const originalQuery = "можно ли уволить сотрудника в декрете";
  const plan = normalizeLegalRetrievalUnderstanding({
    standaloneQuestion: "   ",
    corpusQueries: [],
    requiredConcepts: [{ statement: "", alternatives: ["", "   "] }],
    lexSearchQueries: [],
    webSearchQuery: "",
  }, originalQuery);

  assert.equal(plan.standaloneQuestion, originalQuery);
  assert.deepEqual(plan.corpusQueries, [originalQuery]);
  assert.deepEqual(plan.requiredConcepts, []);
  assert.deepEqual(plan.lexSearchQueries, [originalQuery]);
  assert.equal(plan.webSearchQuery, originalQuery);
});

test("shared formulations retain every independently scoped requirement association", () => {
  const understanding = normalizeLegalRetrievalUnderstanding({
    standaloneQuestion: "Independent scopes sharing search wording", corpusQueries: [],
    lexSearchQueries: [], webSearchQuery: "Independent scopes sharing search wording",
    requiredConcepts: Array.from({length: 8}, (_, index) => ({
      statement: `Independent scope ${index + 1}`, alternatives: ["Shared legal wording"], priority: "core",
    })),
  }, "Independent scopes sharing search wording");
  const hints = targetQuestionPlanningHints(understanding, "en")!;
  const target = planFromQuestionPlanningHints("shared-formulation", hints);
  const shared = target.formulations.find(formulation => formulation.text === "Shared legal wording")!;
  assert.deepEqual(shared.requirementIds, Array.from({length: 8}, (_, index) => `requirement-${index + 1}`));
  assert.equal(target.readings[0]!.requirements.length, 8);
});

test("deadline queries retain the question and only their supplied legal concepts", () => {
  const question = "Срок исковой давности по трудовым спорам";
  const concepts = ["срок обращения в комиссию по трудовым спорам", "срок обращения в суд по трудовым спорам"];
  const understanding = normalizeLegalRetrievalUnderstanding({
    standaloneQuestion: question,
    corpusQueries: concepts,
    requiredConcepts: concepts.map(statement => ({ statement, alternatives: [statement] })),
    lexSearchQueries: concepts,
    webSearchQuery: question,
  }, question);
  assert.deepEqual(understanding.corpusQueries, [question, ...concepts]);
  assert.deepEqual(understanding.lexSearchQueries, [question, ...concepts]);
  assert.deepEqual(understanding.requiredConcepts.map(item => item.statement), concepts);
  assert.doesNotMatch(JSON.stringify(understanding), /запрет|гарантии|уголовная/iu);
  const hints = targetQuestionPlanningHints(understanding, "ru")!;
  assert.equal(hints.formulations[0], question);
  assert.deepEqual(hints.requirements.map((item) => item.statement), concepts);
  assert.equal(targetQuestionPlanningHints(fallbackLegalRetrievalUnderstanding(question), "ru"), undefined);
});

test("the target receives the general rule query alongside separate status-specific requirements", () => {
  const question = "Можно ли прекратить договор во время отпуска?";
  const generalQuery = "прекращение трудового договора в период отпуска";
  const concepts = ["гарантии в ежегодном отпуске", "гарантии в учебном отпуске"];
  const plan = normalizeLegalRetrievalUnderstanding({
    standaloneQuestion: question,
    corpusQueries: [generalQuery, ...concepts],
    requiredConcepts: concepts.map(statement => ({ statement, alternatives: [statement], priority: "core" })),
    lexSearchQueries: [generalQuery, ...concepts], webSearchQuery: question,
  }, question);
  const hints = targetQuestionPlanningHints(plan, "ru")!;
  assert.deepEqual(hints.formulations, [question, generalQuery, ...concepts]);
  assert.deepEqual(hints.requirements.map(item => item.statement), concepts);
  const target = planFromQuestionPlanningHints("mixed-scopes", hints);
  assert.deepEqual(target.formulations.map(item => item.requirementIds), [
    ["requirement-1", "requirement-2"], ["requirement-1", "requirement-2"],
    ["requirement-1"], ["requirement-2"],
  ], "broad formulations must not erase the independent scope of dedicated searches");
});

test("bounded planning retains a search for every core scope before broad formulations", () => {
  const concepts = Array.from({ length: 5 }, (_, index) => `distinct scope ${index}`);
  const plan = normalizeLegalRetrievalUnderstanding({
    standaloneQuestion: "A general legal question", corpusQueries: ["general controlling rule"],
    requiredConcepts: concepts.map(statement => ({ statement, alternatives: [statement], priority: "core" })),
    lexSearchQueries: concepts, webSearchQuery: "A general legal question",
  }, "A general legal question");
  const hints = targetQuestionPlanningHints(plan, "en")!;
  assert.ok(concepts.every(concept => hints.formulations.includes(concept)));
  assert.equal(hints.formulations.length, 6);
});
