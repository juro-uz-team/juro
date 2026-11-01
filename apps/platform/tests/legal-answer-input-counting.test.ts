import assert from "node:assert/strict";
import test from "node:test";
import { createResponsesModel } from "../lib/legal-answer-workflow/provider";
import { countProviderInput } from "../lib/legal-answer-workflow/provider-input-count";

test("over-window counts remain exact and prevent generation instead of becoming unavailable counts", async () => {
  const count = 1_200_000;
  assert.equal(await countProviderInput({ model: "gpt-6-luna", input: "Fixture" }, "fixture",
    new AbortController().signal, async () => Response.json({ object: "response.input_tokens", input_tokens: count })), count);
  const events: string[] = [];
  const model = createResponsesModel({ apiKey: "fixture", model: "gpt-6-luna", purpose: "qualification", phase: "diagnostic",
    deadlineAt: Date.now() + 10_000, inputTokenCounting: true,
    rates: { input: 100000, cachedInput: 10000, output: 500000, longContext: { input: 200000, cachedInput: 20000, output: 750000 } },
    receipt: async () => {}, ledger: { reserve: () => { events.push("reserve"); return "fixture"; },
      dispatch: () => { events.push("dispatch"); }, settle: () => {}, cancel: () => {} },
    fetchImpl: async url => { events.push(String(url).endsWith("/input_tokens") ? "count" : "generate");
      return Response.json({ object: "response.input_tokens", input_tokens: count }); },
  });
  await assert.rejects(model.complete({ stage: "interpret", input: {}, instruction: "Fixture", schema: {},
    signal: new AbortController().signal }), /PROVIDER_INPUT_LIMIT/);
  assert.deepEqual(events, ["count"]);
});

test("counted admission uses short-context prices only when the entire input bound stays below the price boundary", async () => {
  for (const serviceTier of ["default", "fast"] as const) for (const [counted, expected, fastExpected] of [[267904, 69500, 139000], [267905, 138251, 276501]] as const) {
    const holds: number[] = [], charges: (number | null)[] = [];
    const model = createResponsesModel({ apiKey: "fixture", model: "gpt-6-luna", purpose: "production", phase: "operating",
      deadlineAt: Date.now() + 10_000, inputTokenCounting: true, serviceTier,
      rates: { input: 100000, cachedInput: 10000, output: 500000, longContext: { input: 200000, cachedInput: 20000, output: 750000 } },
      fastRates: { input: 200000, cachedInput: 20000, output: 1000000, longContext: { input: 400000, cachedInput: 40000, output: 1500000 } },
      receipt: async () => {}, ledger: { reserve: ({ maximumMicrousd }) => { holds.push(maximumMicrousd); return "fixture"; },
        dispatch: () => {}, settle: (_id, cost) => { charges.push(cost); }, cancel: () => {} },
      fetchImpl: async url => String(url).endsWith("/input_tokens")
        ? Response.json({ object: "response.input_tokens", input_tokens: counted }) : Response.json({ id: "fixture", model: "gpt-6-luna", service_tier: serviceTier,
          status: "completed", usage: { input_tokens: counted + 4096, output_tokens: 3000, input_tokens_details: {
            cached_tokens: 0, cache_write_tokens: counted + 4096,
            cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: counted + 4096 } } }, output: [] }),
    });
    await assert.rejects(model.complete({ stage: "interpret", input: {}, instruction: "Fixture", schema: {},
      signal: new AbortController().signal }), /CACHE_POLICY_MISMATCH/);
    assert.deepEqual(holds, [serviceTier === "fast" ? fastExpected : expected]);
    assert.deepEqual(charges, holds, "even unexpected longest-lived cache writes are fully funded at the boundary");
  }
});

test("continuation counting leaves initial writing admission fast and funds later requests by exact input", async () => {
  const requests: string[] = [], reservations: number[] = [];
  const model = createResponsesModel({ apiKey: "synthetic", model: "gpt-6-luna", purpose: "qualification", phase: "diagnostic",
    deadlineAt: Date.now() + 10_000, inputTokenCounting: false, countInputAfterWriting: true,
    rates: { input: 100_000, cachedInput: 10_000, output: 500_000, longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } },
    receipt: async () => {}, ledger: { reserve: ({ maximumMicrousd }) => { reservations.push(maximumMicrousd); return "synthetic"; },
      dispatch: () => {}, settle: () => {}, cancel: () => {} }, fetchImpl: async url => {
      requests.push(String(url));
      if (String(url).endsWith("/input_tokens")) return Response.json({ object: "response.input_tokens", input_tokens: 100 });
      return Response.json({ id: "synthetic", model: "gpt-6-luna", service_tier: "default", status: "completed",
        usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"ok":true}' }] }] });
    } });
  for (const publishedIssues of [[], [{ id: "permit", version: "1" }]]) await model.complete({ stage: "interpret",
    input: { question: "Artificial question", publishedIssues }, instruction: "Synthetic", schema: {}, signal: new AbortController().signal });
  assert.deepEqual(requests.map(url => url.split("/v1/")[1]), ["responses", "responses/input_tokens", "responses"]);
  assert.deepEqual(reservations, [525750, 2549]);
});

test("denied full-window admission can use one verified smaller reservation before generation", async () => {
  for (const countAvailable of [true, false]) {
    const events: string[] = [], reservations: number[] = [];
    const model = createResponsesModel({ apiKey: "synthetic", model: "gpt-6-luna", purpose: "qualification", phase: "diagnostic",
      deadlineAt: Date.now() + 10_000, inputTokenCounting: false,
      rates: { input: 100_000, cachedInput: 10_000, output: 500_000, longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } },
      receipt: async () => {}, ledger: {
        reserve: ({ maximumMicrousd }) => { reservations.push(maximumMicrousd); events.push("reserve");
          if (maximumMicrousd > 10_000) throw new Error("PROVIDER_SPENDING_CAP"); return "admitted"; },
        dispatch: () => { events.push("dispatch"); }, settle: () => { events.push("settle"); }, cancel: () => {},
      }, fetchImpl: async url => {
        if (String(url).endsWith("/input_tokens")) { events.push("count"); return countAvailable
          ? Response.json({ object: "response.input_tokens", input_tokens: 100 }) : new Response(null, { status: 503 }); }
        events.push("generate");
        return Response.json({ id: "synthetic", model: "gpt-6-luna", service_tier: "default", status: "completed",
          usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"ok":true}' }] }] });
      } });
    const completing = model.complete({ stage: "interpret", input: { question: "Artificial question" }, instruction: "Synthetic",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      signal: new AbortController().signal });
    if (countAvailable) {
      assert.deepEqual(await completing, { ok: true });
      assert.deepEqual(events, ["reserve", "count", "reserve", "dispatch", "generate", "settle"]);
      assert.equal(reservations[1], 2549);
    } else {
      await assert.rejects(completing, /PROVIDER_SPENDING_CAP/);
      assert.deepEqual(events, ["reserve", "count"]);
    }
  }
});

test("admission refinement never bypasses ledger failures, a second refusal, or cancellation", async () => {
  for (const scenario of ["policy", "refused", "cancelled"] as const) {
    const events: string[] = [], caller = new AbortController();
    const model = createResponsesModel({ apiKey: "synthetic", model: "gpt-6-luna", purpose: "qualification", phase: "diagnostic",
      deadlineAt: Date.now() + 10_000, inputTokenCounting: false,
      rates: { input: 100_000, cachedInput: 10_000, output: 500_000, longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } },
      receipt: async () => {}, ledger: {
        reserve: () => { events.push("reserve"); throw new Error(scenario === "policy" ? "SPENDING_POLICY_MISMATCH" : "PROVIDER_SPENDING_CAP"); },
        dispatch: () => { events.push("dispatch"); }, settle: () => {}, cancel: () => {},
      }, fetchImpl: async url => {
        assert(String(url).endsWith("/input_tokens")); events.push("count");
        if (scenario === "cancelled") caller.abort(new Error("CANCELLED_BY_CALLER"));
        return Response.json({ object: "response.input_tokens", input_tokens: 100 });
      } });
    await assert.rejects(model.complete({ stage: "interpret", input: { question: "Artificial question" }, instruction: "Synthetic",
      schema: {}, signal: caller.signal }));
    assert.deepEqual(events, scenario === "policy" ? ["reserve"] : scenario === "refused" ? ["reserve", "count", "reserve"] : ["reserve", "count"]);
  }
});

test("native context preserves complete multibyte law and falls back to full-window admission when counting is unavailable", async () => {
  const law = "Ж".repeat(400_000);
  for (const counted of [200_000, null, 900_000, 1_041_000]) {
    let generations = 0, counts = 0;
    const reservations: number[] = [];
    const model = createResponsesModel({ apiKey: "synthetic", model: "gpt-6-luna", purpose: "qualification", phase: "diagnostic",
      deadlineAt: Date.now() + 120_000, inputTokenCounting: true, maximumRequestMicrousd: 650_000,
      rates: { input: 100_000, cachedInput: 10_000, output: 500_000, longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } },
      receipt: async () => {}, ledger: { reserve: ({ maximumMicrousd }) => { reservations.push(maximumMicrousd); return "synthetic"; },
        dispatch: () => {}, settle: () => {}, cancel: () => {} },
      fetchImpl: async (url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(JSON.parse(body.input[0].content).evidence[0].text, law);
        if (String(url).endsWith("/input_tokens")) {
          counts++;
          return counted === null ? new Response(null, { status: 503 })
            : Response.json({ object: "response.input_tokens", input_tokens: counted });
        }
        generations++;
        return Response.json({ id: "synthetic", model: "gpt-6-luna", service_tier: "default", status: "completed",
          usage: { input_tokens: 200_000, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ turn: {
            decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "r", description: "Synthetic verification only." }],
          } }) }] }] });
      } });
    const completing = model.complete({ stage: "write", researchSession: true, instruction: "Synthetic verification only.",
      input: { researchAgent: true, evidence: [{ identity: "complete", text: law }], availableEvidence: [{ identity: "complete" }],
        interpretation: { requirements: [{ id: "r" }] }, canResearch: false, canSelectEvidence: false }, schema: {}, signal: new AbortController().signal });
    if (counted !== 1_041_000) {
      assert.equal((await completing as { decision: string }).decision, "insufficient_evidence");
      assert.deepEqual(reservations, [counted === null ? 527_500 : counted === 900_000 ? 459_548 : 56_024]);
      assert.equal(generations, 1);
    } else {
      await assert.rejects(completing, /PROVIDER_INPUT_LIMIT/);
      assert.equal(generations, 0);
      assert.deepEqual(reservations, []);
    }
    assert.equal(counts, 1);
  }
});

test("input counting preserves opaque continuation, exact tool outputs, schema and complete file bytes", async () => {
  const request = { model: "gpt-6-luna", store: false, stream: false, service_tier: "default", max_output_tokens: 10000,
    input: [{ type: "reasoning", encrypted_content: "opaque", summary: [] },
      { type: "function_call_output", call_id: "actual-call", output: "empty search" },
      { role: "user", content: [{ type: "input_file", file_data: "data:application/pdf;base64,cGRm", detail: "high" }] }],
    instructions: "Actual instructions", tools: [], parallel_tool_calls: false, reasoning: { effort: "high" },
    text: { format: { type: "json_schema", schema: { type: "object" } } }, truncation: "disabled" };
  assert.equal(await countProviderInput(request, "synthetic", new AbortController().signal, async (_url, init) => {
    const expected = Object.fromEntries(Object.entries(request).filter(([key]) => !["store", "stream", "service_tier", "max_output_tokens"].includes(key)));
    assert.deepEqual(JSON.parse(String(init?.body)), expected);
    return Response.json({ object: "response.input_tokens", input_tokens: 2345 });
  }), 2345);
});

test("unsupported counting returns no estimate and caller cancellation never falls back to generation", async () => {
  for (const response of [Response.json({ input_tokens: 5 }), Response.json({ object: "response.input_tokens", input_tokens: -1 }),
    new Response(null, { status: 503 })]) {
    assert.equal(await countProviderInput({ model: "gpt-6-luna", input: "Synthetic" }, "synthetic", new AbortController().signal,
      async () => response), null);
  }
  const caller = new AbortController(); caller.abort(new Error("CANCELLED_BY_CALLER"));
  await assert.rejects(countProviderInput({}, "synthetic", caller.signal, async () => { throw new Error("Must not dispatch"); }), /CANCELLED_BY_CALLER/);
});

test("verified input counting reserves processed input plus framing and bounded output before generation", async () => {
  const requests: string[] = [], reservations: number[] = [];
  const model = createResponsesModel({ apiKey: "synthetic", model: "gpt-6-luna", purpose: "qualification", phase: "diagnostic",
    deadlineAt: Date.now() + 120_000, inputTokenCounting: true,
    rates: { input: 100_000, cachedInput: 10_000, output: 500_000,
      longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } },
    receipt: async () => {}, ledger: { reserve: ({ maximumMicrousd }) => { reservations.push(maximumMicrousd); return "operation"; },
      dispatch: () => {}, settle: () => {}, cancel: () => {} },
    fetchImpl: async (url, init) => {
      requests.push(String(url));
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "gpt-6-luna");
      if (String(url).endsWith("/input_tokens")) {
        assert.equal(reservations.length, 0);
        assert.equal(body.text.format.name, "legal_interpret");
        return Response.json({ object: "response.input_tokens", input_tokens: 100 });
      }
      assert.equal(requests.length, 2);
      assert.equal(reservations.length, 1);
      return Response.json({ id: "synthetic", model: "gpt-6-luna", service_tier: "default", status: "completed",
        usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"ok":true}' }] }] });
    } });
  assert.deepEqual(await model.complete({ stage: "interpret", input: { question: "Artificial question" }, instruction: "Synthetic",
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
    signal: new AbortController().signal }), { ok: true });
  // 4196 input at the maximum cache-write premium plus 3000 output at the applicable short-context rates.
  assert.deepEqual(reservations, [2549]);
});
