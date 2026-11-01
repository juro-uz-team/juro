import { legalAnswerDeadlineMs } from "./deadline";
import { corpusDatabase } from "../storage/connection";
import { requireD1, requireR2, runtimeEnv } from "../document-builder/storage/runtime";
import { workspaceEntitlements, resolveAiAnswerCycleLimit } from "../billing/entitlements";
import { assertOperationalFeatureEnabled, operationalEnvironment, OperationalFeatureError,
  operationalFeatureMessage, operationalLocaleFromRequest } from "../operations/operational-feature-flags";
import { runIndexedRetrieval } from "../runtime/indexed-retrieval";
import { openConfiguredAnswerRuntime } from "./configured-runtime";
import { loadAnswerRuntimeConfiguration } from "./runtime-configuration";
import { authenticateSignedAnswer } from "./platform-auth";
import { handleSignedAnswerHttp } from "./signed-http";
import { withinSignal } from "./lifetime";
import { maximumPrivateDocumentBytes } from "./private-documents";
import { voiceKeyring } from "../ai/voice-recording";
import { memoryKeyring } from "../ai/user-memory";
import { validateAnswerVoice } from "./voice-input";
import { handleGuestAnswerHttp, GuestChallengeRequired } from "./guest-http";
import { handleGuestAnswerBootstrap } from "./guest-bootstrap";
import { handleSignedAnswerBrowser } from "./signed-browser";
import { handleSavedCitationHttp } from "./citation-http";
import { openRegisteredEvidenceStore } from "./evidence-registration";
import { parseIdentityKeyring } from "../auth/keyring";
import { validateTurnstile, guestAiTurnstileAction } from "../auth/turnstile";
import { authRequestSecurityContext } from "../auth/request-security-evidence";
import { createGuestAiSession, resolveGuestAiSession, guestSessionCookie, guestAiEnabled, GuestAiError } from "../ai/guest-session";
import { rejectAnswerRequest } from "./request-boundary";
import { answerAllowanceAvailable } from "./answer-allowance";
import { evidenceObjectMaximum } from "./evidence-objects";
import { parsePreparedProvisionKey } from "./prepared-provision-objects";
import { createPreparedStoredReader } from "./prepared-stored-reader";
import { resolveSavedSourceRoute } from "./saved-source-routing";

type Configuration = Awaited<ReturnType<typeof loadAnswerRuntimeConfiguration>>;
let configuration: Promise<Configuration> | undefined;
let service: ReturnType<typeof openConfiguredAnswerRuntime> | undefined;

function loadConfiguration() {
  configuration ??= loadAnswerRuntimeConfiguration(process.env).catch(error => { configuration = undefined; throw error; });
  return configuration;
}

async function operationalRejection(request: Request, signal: AbortSignal): Promise<Response | null> {
  try {
    const db = requireD1(), environment = operationalEnvironment(runtimeEnv().APP_ENV);
    await runIndexedRetrieval(signal, () => Promise.all((["ai_chat", "ai_openai_primary", "ai_lex_web_discovery"] as const)
      .map(key => assertOperationalFeatureEnabled({ db, environment, key }))));
    return null;
  } catch (error) {
    const paused = error instanceof OperationalFeatureError && error.code === "OPERATIONAL_FEATURE_DISABLED";
    return Response.json({ code: paused ? error.code : "LEGAL_ANSWER_UNAVAILABLE",
      ...(paused ? { error: operationalFeatureMessage(operationalLocaleFromRequest(request)) } : {}), retryable: true },
    { status: 503, headers: { "cache-control": "no-store" } });
  }
}

function openService(config: Configuration, deadlineAt: number, signal: AbortSignal) {
  service ??= openConfiguredAnswerRuntime(config, {
    corpusPool: corpusDatabase().pool,
    privateObjects: { async get(key, caller) {
      if (!caller) throw new Error("PRIVATE_DOCUMENT_LIFETIME_REQUIRED");
      return runIndexedRetrieval(caller, async () => {
        const object = await requireR2().get(key);
        if (!object) return null;
        if (object.size < 1 || object.size > maximumPrivateDocumentBytes) throw new Error("PRIVATE_DOCUMENT_CONTEXT_LIMIT");
        return new Uint8Array(await withinSignal(caller, () => object.arrayBuffer()));
      });
    } },
  }, deadlineAt, signal).catch(error => { service = undefined; throw error; });
  return service;
}

/** Native signed entrypoint. Configuration and startup consume the original delivery deadline. */
export async function platformLegalAnswerPost(request: Request): Promise<Response> {
  const submittedAt = Date.now();
  const rejected = rejectAnswerRequest(request, runtimeEnv().APP_URL ?? new URL(request.url).origin);
  if (rejected) return rejected;
  const startupSignal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
  const unavailable = await operationalRejection(request, startupSignal);
  if (unavailable) return unavailable;
  const environment = operationalEnvironment(runtimeEnv().APP_ENV);
  let monthlyLimit: number | null | undefined;
  return handleSignedAnswerHttp(request, { publicOrigin: runtimeEnv().APP_URL ?? new URL(request.url).origin,
    submittedAt, deadlineMs: legalAnswerDeadlineMs,
    authenticate: authenticateSignedAnswer,
    async admit(actor, input, signal) {
      const entitlements = await runIndexedRetrieval(signal, () => workspaceEntitlements(actor.db, actor.workspaceId));
      monthlyLimit = resolveAiAnswerCycleLimit(environment, entitlements.aiAnswerCyclesMonthly);
      if (await answerAllowanceAvailable({ ...actor, idempotencyKey: input.idempotencyKey, monthlyLimit, signal })) return null;
      return Response.json({ code: "PLAN_LIMIT", error: "Monthly AI answer limit reached." },
        { status: 429, headers: { "cache-control": "no-store" } });
    },
    async dependencies(_actor, input, signal) {
      const startup = AbortSignal.any([startupSignal, signal]);
      const config = await withinSignal(startup, loadConfiguration);
      const deadlineMs = legalAnswerDeadlineMs;
      const runtime = await withinSignal(startup, () => openService(config, submittedAt + deadlineMs, startup));
      return { ...runtime.dependencies(input.mode),
        deadlineMs,
        memoryKeyring: memoryKeyring(runtimeEnv().IDENTITY_KEYRING),
        validateVoice: voice => validateAnswerVoice({ ...voice, keyring: voiceKeyring(process.env.IDENTITY_KEYRING) }),
        monthlyLimit };
    },
  });
}

export async function guestLegalAnswerPost(request: Request): Promise<Response> {
  const submittedAt = Date.now();
  const env = runtimeEnv();
  const rejected = rejectAnswerRequest(request, env.APP_URL ?? new URL(request.url).origin);
  if (rejected) return rejected;
  if (!guestAiEnabled({ GUEST_AI_ENABLED: env.GUEST_AI_ENABLED ?? "false" })) return Response.json({ code: "GUEST_AI_DISABLED" },
    { status: 404, headers: { "cache-control": "no-store" } });
  const startupSignal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
  const unavailable = await operationalRejection(request, startupSignal);
  if (unavailable) return unavailable;
  const publicOrigin = env.APP_URL ?? new URL(request.url).origin;
  return handleGuestAnswerHttp(request, { publicOrigin, submittedAt, deadlineMs: legalAnswerDeadlineMs,
    async authenticate(incoming, payload, signal) {
      const db = requireD1(), keyring = parseIdentityKeyring(env.IDENTITY_KEYRING);
      try { return { db, keyring, session: await resolveGuestAiSession({ db, keyring, request: incoming }) }; }
      catch (error) {
        if (!(error instanceof GuestAiError)
          || !["GUEST_SESSION_REQUIRED", "GUEST_SESSION_INVALID", "GUEST_SESSION_EXPIRED"].includes(error.code)) throw error;
      }
      const { connectingIp } = authRequestSecurityContext(incoming);
      const challenge = await withinSignal(signal, () => validateTurnstile({
        secretKey: env.TURNSTILE_SECRET_KEY ?? "", token: payload.turnstileToken ?? "",
        remoteIp: connectingIp, expectedHostname: new URL(publicOrigin).hostname, expectedAction: guestAiTurnstileAction,
      }));
      if (challenge.status !== "verified") throw new GuestChallengeRequired();
      signal.throwIfAborted();
      const created = await createGuestAiSession({ db, keyring, connectingIp, locale: payload.locale });
      return { db, keyring, session: created.session,
        cookie: guestSessionCookie(created.session.id, created.token, publicOrigin) };
    },
    async dependencies(_actor, signal) {
      const startup = AbortSignal.any([startupSignal, signal]);
      const config = await withinSignal(startup, loadConfiguration);
      const deadlineMs = legalAnswerDeadlineMs;
      const runtime = await withinSignal(startup, () => openService(config, submittedAt + deadlineMs, startup));
      return { ...runtime.dependencies("fast"), deadlineMs };
    },
  });
}

export async function guestLegalAnswerGet(request: Request): Promise<Response> {
  const env = runtimeEnv();
  if (!guestAiEnabled({ GUEST_AI_ENABLED: env.GUEST_AI_ENABLED ?? "false" })) return Response.json({ code: "GUEST_AI_DISABLED" },
    { status: 404, headers: { "cache-control": "no-store" } });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  let providerConfigured = false;
  try { await withinSignal(signal, loadConfiguration); providerConfigured = true; } catch { /* Saved results remain accessible. */ }
  try {
    return await handleGuestAnswerBootstrap(request, { db: requireD1(), keyring: parseIdentityKeyring(env.IDENTITY_KEYRING),
      enabled: guestAiEnabled({ GUEST_AI_ENABLED: env.GUEST_AI_ENABLED ?? "false" }), providerConfigured,
      siteKey: env.TURNSTILE_SITE_KEY ?? null, publicOrigin: env.APP_URL ?? new URL(request.url).origin });
  } catch {
    return Response.json({ code: "GUEST_CONFIGURATION_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export async function platformLegalAnswerBrowser(request: Request): Promise<Response> {
  const env = runtimeEnv();
  const environment = operationalEnvironment(env.APP_ENV);
  return handleSignedAnswerBrowser(request, { publicOrigin: env.APP_URL ?? new URL(request.url).origin,
    authenticate: authenticateSignedAnswer,
    async settings(actor, signal) {
      const entitlements = await withinSignal(signal, () => workspaceEntitlements(actor.db, actor.workspaceId));
      let config: Configuration | undefined;
      try { config = await withinSignal(signal, loadConfiguration); } catch { /* Saved history remains accessible. */ }
      return { monthlyLimit: resolveAiAnswerCycleLimit(environment, entitlements.aiAnswerCyclesMonthly),
        provider: { configured: Boolean(config), provider: config ? "openai" : null,
          model: config?.models.fast ?? null, fallbackConfigured: false } };
    },
  });
}

export async function platformSavedCitationGet(request: Request, context: { params: Promise<{ messageId: string }> }) {
  const deadlineAt = Date.now() + 10_000;
  const { messageId } = await context.params;
  return handleSavedCitationHttp(request, messageId, { authenticate: authenticateSignedAnswer,
    objects: { async get(key, identity, signal) {
      if (identity) {
        if (identity.namespace !== `legal-prepared-${identity.generationSha256}`) throw new Error("CITATION_STORE_IDENTITY");
        const { store, manifest } = await openRegisteredEvidenceStore(corpusDatabase().pool, identity.generationSha256,
          deadlineAt, signal, { readOnly: true });
        const prepared = parsePreparedProvisionKey(key);
        if (prepared) {
          const reader = createPreparedStoredReader(resolveSavedSourceRoute(manifest, prepared.packageSha256, process.env));
          return reader.get(key, signal);
        }
        return runIndexedRetrieval(signal, async () => {
          // The owned saved receipt binds this key and its hashes, including historical key layouts.
          const object = await store.get(key);
          if (!object) return null;
          if (object.key !== key || object.size < 1 || object.size > evidenceObjectMaximum(key)) throw new Error("CITATION_OBJECT_BOUND");
          const bytes = await withinSignal(signal, () => object.bytes());
          if (bytes.byteLength !== object.size) throw new Error("CITATION_OBJECT_INTEGRITY");
          return bytes;
        }, performance.now() + Math.max(0, deadlineAt - Date.now()));
      }
      return runIndexedRetrieval(signal, async () => {
        const object = await requireR2().get(key);
        if (!object) return null;
        if (object.size < 1 || object.size > evidenceObjectMaximum(key)) throw new Error("CITATION_OBJECT_BOUND");
        return new Uint8Array(await withinSignal(signal, () => object.arrayBuffer()));
      }, performance.now() + Math.max(0, deadlineAt - Date.now()));
    } },
  });
}
