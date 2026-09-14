import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  normalizeVinextFontArtifactReferences,
  pruneUnusedVinextFontArtifacts,
} from "./prune-unused-vinext-font-artifacts.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = resolve(
  process.env.SITES_RUNTIME_ROOT || resolve(projectRoot, ".sites-runtime"),
);

const supportedEnvironments = new Set([
  "development",
  "staging",
  "production",
]);

const handledSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
const signalExitCodes = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

const offlineInheritedEnvironmentKeys = new Set([
  "CI",
  "COLORTERM",
  "COMSPEC",
  "CONTINUOUS_INTEGRATION",
  "FORCE_COLOR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "NO_COLOR",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "SOURCE_DATE_EPOCH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TERM",
  "TZ",
  "UV_THREADPOOL_SIZE",
  "WINDIR",
]);

const installInheritedEnvironmentKeys = new Set([
  ...offlineInheritedEnvironmentKeys,
  "ALL_PROXY",
  "APPDATA",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LOCALAPPDATA",
  "LOGNAME",
  "NO_PROXY",
  "NPM_AUTH_TOKEN",
  "NPM_CONFIG_CA",
  "NPM_CONFIG_CAFILE",
  "NPM_CONFIG_CERT",
  "NPM_CONFIG_GLOBALCONFIG",
  "NPM_CONFIG_HTTPS_PROXY",
  "NPM_CONFIG_KEY",
  "NPM_CONFIG_NOPROXY",
  "NPM_CONFIG_PROXY",
  "NPM_CONFIG_REGISTRY",
  "NPM_CONFIG_STRICT_SSL",
  "NPM_CONFIG_USERCONFIG",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "SHELL",
  "SYSTEMDRIVE",
  "USER",
  "USERNAME",
  "USERPROFILE",
]);

const coreTestFiles = [
  "tests/legal-chat-storage.test.ts",
  "tests/legal-private-name-service.test.ts",
  "tests/legal-reference-context.test.ts",
  "tests/document-builder.test.ts",
  "tests/signed-share-security.test.ts",
  "tests/pinfl-validation.test.ts",
  "tests/document-comparison.test.ts",
  "tests/comparison-export.test.ts",
  "tests/comparison-change-decision.test.ts",
  "tests/document-registry.test.ts",
  "tests/document-access.test.ts",
  "tests/document-analysis-upload.test.ts",
  "tests/document-analysis-route-boundary.test.ts",
  "tests/document-analysis-provider.test.ts",
  "tests/document-analysis-runtime-recovery.test.ts",
  "tests/clamav-output.test.ts",
  "tests/document-analysis-processor.test.ts",
  "tests/document-analysis-chunking.test.ts",
  "tests/document-analysis-revisions.test.ts",
  "tests/document-analysis-case-link.test.ts",
  "tests/document-case-link.test.ts",
  "tests/builder-document-analysis.test.ts",
  "tests/builder-document-versions.test.ts",
  "tests/legal-bookmarks.test.ts",
  "tests/knowledge-base.test.ts",
  "tests/knowledge-base-admin.test.ts",
  "tests/lawyer-review-replies.test.ts",
  "tests/lawyer-document-verification-boundary.test.ts",
  "tests/lawyer-phone-contact.test.ts",
  "tests/lawyer-workspace-operations.test.ts",
  "tests/ai-feedback.test.ts",
  "tests/ai-quality-review.test.ts",
  "tests/url-import.test.ts",
  "tests/pdf-preflight.test.ts",
  "tests/document-analysis-package-extractor.test.ts",
  "tests/document-ocr-processor.test.ts",
  "tests/analysis-report-export.test.ts",
  "tests/auth-otp.test.ts",
  "tests/password-auth.test.ts",
  "tests/registration-retention.test.ts",
  "tests/auth-logout.test.ts",
  "tests/auth-metadata.test.ts",
  "tests/auth-request-localization.test.ts",
  "tests/auth-theme-preference.test.ts",
  "tests/auth-ui-contract.test.ts",
  "tests/auth-turnstile.test.ts",
  "tests/auth-sessions.test.ts",
  "tests/session-handoff.test.ts",
  "tests/auth-keyring.test.ts",
  "tests/identity-protection.test.ts",
  "tests/identity-evidence.test.ts",
  "tests/challenge-evidence.test.ts",
  "tests/auth-mfa-crypto.test.ts",
  "tests/auth-mfa.test.ts",
  "tests/account-deletion.test.ts",
  "tests/account-deletion-purge.test.ts",
  "tests/email-change.test.ts",
  "tests/security-email.test.ts",
  "tests/legal-source-trust.test.ts",
  "tests/legal-corpus-worker-boundary.test.ts",
  "tests/legal-target-evaluation.test.ts",
  "tests/legal-custom-bm25-runtime.test.ts",
  "tests/legal-custom-membership-lookup.test.ts",
  "tests/legal-candidate-membership-proof.test.ts",
  "tests/legal-candidate-membership-publication.test.ts",
  "tests/pinned-source-observation.test.ts",
  "tests/source-observation-store.test.ts",
  "tests/source-observation-service.test.ts",
  "tests/final-source-observation.test.ts",
  "tests/legal-custom-reference-lookup.test.ts",
  "tests/legal-custom-search-service.test.ts",
  "tests/grounding-numbers.test.ts",
  "tests/lex-document-status.test.ts",
  "tests/legal-source-fetch.test.ts",
  "tests/legal-source-discovery.test.ts",
  "tests/lex-metadata-monitor.test.ts",
  "tests/live-lex-runtime-boundary.test.ts",
  "tests/legal-source-acquisition.test.ts",
  "tests/legal-scheduled-corpus-sync.test.ts",
  "tests/legal-evaluation-corpus.test.ts",
  "tests/document-evaluation-corpus.test.ts",
  "tests/legal-source-parser.test.ts",
 "tests/legal-source-normalization.test.ts",
  "tests/legal-language.test.ts",
  "tests/legal-hybrid-ranking.test.ts",
 "tests/legal-source-health.test.ts",
  "tests/direct-source-health.test.ts",
  "tests/legal-corpus-alerts.test.ts",
  "tests/legal-source-review.test.ts",
  "tests/ai-platform.test.ts",
  "tests/ai-chat-slo-contract.test.ts",
  "tests/ai-chat-retrieval-safety.test.ts",
  "tests/ai-safe-markdown.test.ts",
  "tests/secondary-internet-page-verification.test.ts",
  "tests/ai-execution-budget.test.ts",
  "tests/legal-chat-timeout.test.ts",
  "tests/ai-provider-fallback.test.ts",
  "tests/provider-request-timeout.test.ts",
  "tests/ai-runtime-settings.test.ts",
  "tests/ai-branch-history.test.ts",
  "tests/ai-lawyer-compat-route.test.ts",
  "tests/ai-suggested-document.test.ts",
  "tests/ai-memory.test.ts",
  "tests/guest-ai.test.ts",
  "tests/guest-ai-route-boundary.test.ts",
  "tests/analysis-export.test.ts",
  "tests/archive-inspector.test.ts",
  "tests/staff-access.test.ts",
  "tests/staff-http.test.ts",
  "tests/admin-domain-handoff.test.ts",
  "tests/staff-role-management.test.ts",
  "tests/policy-acceptance.test.ts",
  "tests/onboarding-profile.test.ts",
  "tests/workspace-routing.test.ts",
  "tests/root-layout-language.test.ts",
  "tests/workspace-creation.test.ts",
  "tests/workspace-invitations.test.ts",
  "tests/monitoring-preferences.test.ts",
  "tests/platform-core.test.ts",
  "tests/platform-document-navigation.test.ts",
  "tests/platform-shell-accessibility.test.ts",
  "tests/platform-product-ux.test.ts",
  "tests/ai-action-plan-save.test.ts",
  "tests/ai-chat-theme.test.ts",
  "tests/ai-citation-article-route.test.ts",
  "tests/ai-slo-telemetry.test.ts",
  "tests/anthropic-schema-compatibility.test.ts",
  "tests/calendar.test.ts",
  "tests/canonical-document-hub-header.test.ts",
  "tests/case-create.test.ts",
  "tests/case-lifecycle.test.ts",
  "tests/case-sections.test.ts",
  "tests/deadline-calculator.test.ts",
  "tests/deadline-route-boundary.test.ts",
  "tests/demo-payments.test.ts",
  "tests/direct-citation-store.test.ts",
  "tests/citation-evidence-contract.test.ts",
  "tests/direct-legal-retrieval.test.ts",
  "tests/display-name.test.ts",
  "tests/document-analysis-legacy-route.test.ts",
  "tests/document-builder-id.test.ts",
  "tests/document-evaluation-persisted-evidence.test.ts",
  "tests/lawyer-host-routing.test.ts",
  "tests/lawyer-entry-routing.test.ts",
  "tests/lawyer-marketplace-lifecycle.test.ts",
  "tests/legal-applicability-date.test.ts",
  "tests/legal-chat-openai-schema.test.ts",
  "tests/legal-chat-release-gate.test.ts",
  "tests/legal-evaluation-human-evidence.test.ts",
  "tests/legal-evaluation-persisted-evidence.test.ts",
  "tests/legal-semantic-retrieval.test.ts",
  "tests/malware-scanner.test.ts",
  "tests/marketplace-service-lifecycle.test.ts",
  "tests/migration-0063-marketplace-service.test.ts",
  "tests/migration-0066-voice-recordings.test.ts",
  "tests/migration-0067-deadline-evidence.test.ts",
  "tests/migration-0068-file-scan-evidence.test.ts",
  "tests/migration-0105-d1-builder-version-hash-guards.test.ts",
  "tests/monitoring-freshness.test.ts",
  "tests/openai-attempt-observability.test.ts",
  "tests/anthropic-attempt-observability.test.ts",
  "tests/legal-answer-failure.test.ts",
  "tests/legal-answer-view.test.ts",
  "tests/citation-preview.test.ts",
  "tests/runtime-execution-observation.test.ts",
  "tests/openai-schema-compatibility.test.ts",
  "tests/platform-date-time.test.ts",
  "tests/platform-shell-motion.test.ts",
  "tests/provider-cost-control.test.ts",
  "tests/provider-usage.test.ts",
  "tests/staging-lawyer-handoff-seed.test.ts",
  "tests/system-status.test.ts",
  "tests/status-metadata.test.ts",
  "tests/ui-theme-resilience.test.ts",
  "tests/user-document-ai-grounding-boundary.test.ts",
  "tests/user-document-vectors.test.ts",
  "tests/voice-recording.test.ts",
  "tests/voice-ui.test.ts",
  "tests/billing-foundation.test.ts",
  "tests/checkout-service.test.ts",
  "tests/operational-feature-flags.test.ts",
  "tests/operational-jobs.test.ts",
  "tests/platform-audit-log.test.ts",
  "tests/vinext-font-artifacts.test.mjs",
];

const cloudflareTestFiles = [
  "tests/cloudflare-config.test.ts",
  "tests/migration-safety.test.ts",
  "tests/schema-auth-migration-parity.test.ts",
  "tests/security-release-hardening.test.ts",
  "tests/migration-0042-file-extractions.test.ts",
  "tests/migration-0061-billing-foundation.test.ts",
  "tests/migration-0062-ai-memory.test.ts",
  "tests/migration-0065-guest-ai.test.ts",
  "tests/migration-0094-ai-document-prefill.test.ts",
  "tests/migration-0095-builder-document-analysis.test.ts",
  "tests/migration-0096-builder-document-versions.test.ts",
  "tests/migration-0097-builder-version-object-writes.test.ts",
  "tests/migration-0098-task-reminder-email.test.ts",
  "tests/migration-0099-staging-email-delivery-probe.test.ts",
  "tests/staging-provider-probe.test.ts",
  "tests/staging-legal-evaluation.test.ts",
  "tests/staging-legal-agent-artifacts.test.ts",
  "tests/migration-0101-document-index-scheduling.test.ts",
  "tests/migration-0102-d1-redrive-hash-check.test.ts",
  "tests/migration-0114-document-export-redrive-parity.test.ts",
  "tests/migration-0115-document-analysis-capacity-terminalization.test.ts",
  "tests/migration-0103-d1-completed-result-hash-guard.test.ts",
  "tests/migration-0104-d1-case-lifecycle-hash-guard.test.ts",
  "tests/dependency-health.test.ts",
  "tests/dependency-health-evidence.test.ts",
  "tests/queue-dlq-health-reconciliation.test.ts",
  "tests/staging-queue-health-probe.test.ts",
  "tests/production-queue-health-probe.test.ts",
  "tests/production-dependency-probes.test.ts",
  "tests/task-reminder-email.test.ts",
  "tests/staging-email-delivery-probe.test.ts",
    "tests/staging-malware-scanner-probe.test.ts",
    "tests/staging-document-analysis-probe.test.ts",
  "tests/worker-jobs.test.ts",
];

class TaskSignalError extends Error {
  constructor(signal) {
    super(`Command cancelled by ${signal}`);
    this.exitCode = signalExitCodes[signal] ?? 1;
    this.signal = signal;
  }
}

const signalState = {
  activeChild: null,
  cancellationController: new AbortController(),
  forceHandle: null,
  handlers: new Map(),
  installed: false,
  received: null,
};

function parseDuration(value, label) {
  const match = /^(\d+)(ms|s|m)?$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `${label} must be an integer followed by ms, s, or m; received ${JSON.stringify(value)}`,
    );
  }

  const amount = Number.parseInt(match[1], 10);
  const multiplier = match[2] === "m"
    ? 60_000
    : match[2] === "ms"
      ? 1
      : 1_000;
  const milliseconds = amount * multiplier;
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds <= 0 ||
    milliseconds > 2_147_483_647
  ) {
    throw new Error(
      `${label} must resolve to 1..2147483647 milliseconds`,
    );
  }
  return milliseconds;
}

async function prepareEnvironment(
  overrides = {},
  { policy = "offline" } = {},
) {
  const paths = {
    npmCache: resolve(runtimeRoot, "npm-cache"),
    xdgConfig: resolve(runtimeRoot, "xdg-config"),
    temporary: resolve(runtimeRoot, "tmp"),
    wranglerLogs: resolve(runtimeRoot, "wrangler", "logs"),
    miniflareRegistry: resolve(runtimeRoot, "wrangler", "registry"),
  };

  await Promise.all([
    mkdir(paths.npmCache, { recursive: true }),
    mkdir(paths.xdgConfig, { recursive: true }),
    mkdir(paths.temporary, { recursive: true }),
    mkdir(paths.wranglerLogs, { recursive: true }),
    mkdir(dirname(paths.miniflareRegistry), { recursive: true }),
  ]);

  if (!["install", "offline"].includes(policy)) {
    throw new Error(`Unsupported child environment policy: ${policy}`);
  }
  const inheritedKeys = policy === "install"
    ? installInheritedEnvironmentKeys
    : offlineInheritedEnvironmentKeys;
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      inheritedKeys.has(key.toUpperCase())
    ),
  );
  const environment = {
    ...inheritedEnvironment,
    SITES_ENV_READY: "1",
    SITES_PROJECT_ROOT: projectRoot,
    XDG_CONFIG_HOME: paths.xdgConfig,
    TMPDIR: paths.temporary,
    TMP: paths.temporary,
    TEMP: paths.temporary,
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_PATH: paths.wranglerLogs,
    MINIFLARE_REGISTRY_PATH: paths.miniflareRegistry,
    npm_config_cache: paths.npmCache,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    ...overrides,
  };

  // On Windows, environment keys are case-insensitive. Remove the uppercase
  // cache variant so the project-owned lowercase value is unambiguous. Proxy
  // settings remain available to the install task; offline tasks use the
  // allowlisted environment above and therefore never inherit them.
  delete environment.NPM_CONFIG_CACHE;

  return { environment, paths };
}

async function resolvePackageBinary(packageName, binaryName) {
  const packagePath = resolve(
    projectRoot,
    "node_modules",
    ...packageName.split("/"),
    "package.json",
  );

  let manifest;
  try {
    manifest = JSON.parse(await readFile(packagePath, "utf8"));
  } catch (error) {
    throw new Error(
      `${binaryName} is unavailable. Run the project dependency install first.`,
      { cause: error },
    );
  }

  const binary = typeof manifest.bin === "string"
    ? manifest.bin
    : manifest.bin?.[binaryName];
  if (typeof binary !== "string" || binary.length === 0) {
    throw new Error(`${packageName} does not declare the ${binaryName} binary`);
  }

  const binaryPath = resolve(dirname(packagePath), binary);
  await access(binaryPath, fsConstants.R_OK);
  return binaryPath;
}

async function terminateProcessTree(
  child,
  force,
  { detached = process.platform !== "win32", signal = "SIGTERM" } = {},
) {
  const canAddressExitedProcessGroup =
    force &&
    process.platform !== "win32" &&
    detached &&
    Number.isSafeInteger(child.pid);
  if (
    (child.exitCode !== null || child.signalCode !== null) &&
    !canAddressExitedProcessGroup
  ) {
    return;
  }

  if (process.platform === "win32") {
    const result = await new Promise((resolveTermination, rejectTermination) => {
      const killer = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.once("error", rejectTermination);
      killer.once("exit", (code) => resolveTermination(code));
    });
    if (
      result !== 0 &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      throw new Error(
        `taskkill could not terminate process tree ${child.pid} (exit ${result})`,
      );
    }
    return;
  }

  try {
    process.kill(
      detached ? -child.pid : child.pid,
      force ? "SIGKILL" : signal,
    );
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

function processTreeExists(child, detached) {
  if (
    process.platform === "win32" ||
    !detached ||
    !Number.isSafeInteger(child.pid)
  ) {
    return child.exitCode === null && child.signalCode === null;
  }
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    if (error?.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

async function ensureProcessTreeStopped(child, detached) {
  if (!processTreeExists(child, detached)) {
    return;
  }
  await terminateProcessTree(child, true, { detached });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!processTreeExists(child, detached)) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Process tree ${child.pid} did not terminate after SIGKILL`);
}

function clearSignalForceTimer() {
  if (signalState.forceHandle) {
    clearTimeout(signalState.forceHandle);
    signalState.forceHandle = null;
  }
}

async function forwardSignal(signal, force) {
  const active = signalState.activeChild;
  if (!active) {
    return;
  }
  try {
    await terminateProcessTree(active.child, force, {
      detached: active.detached,
      signal,
    });
  } catch (error) {
    console.error(
      `${force ? "Forced" : "Graceful"} process-tree termination failed: ${error}`,
    );
  }
}

function handleParentSignal(signal) {
  if (signalState.received) {
    clearSignalForceTimer();
    void forwardSignal(signal, true);
    return;
  }

  signalState.received = signal;
  signalState.cancellationController.abort(new TaskSignalError(signal));
  void forwardSignal(signal, false).then(() => {
    const active = signalState.activeChild;
    if (!active || active.child.exitCode !== null || active.child.signalCode !== null) {
      return;
    }
    signalState.forceHandle = setTimeout(() => {
      void forwardSignal(signal, true);
    }, active.killAfterMs);
    signalState.forceHandle.unref();
  });
}

function installSignalHandlers() {
  if (signalState.installed) {
    throw new Error("Signal handlers are already installed");
  }
  signalState.installed = true;
  for (const signal of handledSignals) {
    const handler = () => handleParentSignal(signal);
    signalState.handlers.set(signal, handler);
    process.on(signal, handler);
  }
}

function removeSignalHandlers() {
  clearSignalForceTimer();
  for (const [signal, handler] of signalState.handlers) {
    process.off(signal, handler);
  }
  signalState.handlers.clear();
  signalState.installed = false;
}

function throwIfCancelled() {
  if (signalState.received) {
    throw new TaskSignalError(signalState.received);
  }
}

async function runNode(args, options = {}) {
  throwIfCancelled();
  if (signalState.activeChild) {
    throw new Error("Concurrent child processes are not supported by this launcher");
  }
  const detached = options.detached ?? process.platform !== "win32";
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: options.environment,
    stdio: "inherit",
    windowsHide: true,
    detached,
  });
  signalState.activeChild = {
    child,
    detached,
    killAfterMs: options.killAfterMs ?? 10_000,
  };

  let timeoutHandle;
  let forceHandle;
  let timedOut = false;
  if (options.timeoutMs) {
    timeoutHandle = setTimeout(async () => {
      timedOut = true;
      console.error(
        `${options.label ?? "Command"} exceeded its ${options.timeoutMs} ms limit; terminating it.`,
      );
      try {
        await terminateProcessTree(child, false, { detached });
      } catch (error) {
        console.error(`Graceful process-tree termination failed: ${error}`);
      }
      if (child.exitCode === null && child.signalCode === null) {
        forceHandle = setTimeout(() => {
          void terminateProcessTree(child, true, { detached }).catch((error) => {
            console.error(`Forced process-tree termination failed: ${error}`);
          });
        }, options.killAfterMs ?? 10_000);
        forceHandle.unref();
      }
    }, options.timeoutMs);
    timeoutHandle.unref();
  }

  let result;
  try {
    result = await new Promise((resolveResult, rejectResult) => {
      child.once("error", rejectResult);
      child.once("exit", (code, signal) => resolveResult({ code, signal }));
    });
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (forceHandle) {
      clearTimeout(forceHandle);
    }
    if (timedOut || signalState.received) {
      try {
        await ensureProcessTreeStopped(child, detached);
      } catch (error) {
        console.error(`Process-tree cleanup failed: ${error}`);
      }
    }
    if (signalState.activeChild?.child === child) {
      signalState.activeChild = null;
      clearSignalForceTimer();
    }
  }
  throwIfCancelled();
  if (timedOut) {
    throw new Error(`${options.label ?? "Command"} timed out`);
  }
  if (result.code !== 0) {
    throw new Error(
      `${options.label ?? "Command"} failed${
        result.signal ? ` with signal ${result.signal}` : ` with exit code ${result.code}`
      }`,
    );
  }
}

async function runNodeEntry(entryPath, args, options = {}) {
  await runNode([entryPath, ...args], options);
}

async function runPackageBinary(
  packageName,
  binaryName,
  args,
  options = {},
) {
  const entryPath = await resolvePackageBinary(packageName, binaryName);
  await runNodeEntry(entryPath, args, options);
}

function selectedEnvironment(explicitEnvironment) {
  const environment = explicitEnvironment ||
    process.env.CLOUDFLARE_ENV?.trim() ||
    "development";
  if (!supportedEnvironments.has(environment)) {
    throw new Error(`Unsupported CLOUDFLARE_ENV: ${environment}`);
  }
  return environment;
}

async function validateArtifact(environment) {
  for (const [path, label] of [
    [resolve(projectRoot, "dist", "server", "index.js"), "Sites Worker entry"],
    [
      resolve(projectRoot, "dist", ".openai", "hosting.json"),
      "packaged Sites manifest",
    ],
    [
      resolve(projectRoot, "dist", "server", "wrangler.json"),
      "flattened Wrangler config",
    ],
  ]) {
    try {
      await access(path, fsConstants.R_OK);
    } catch (error) {
      throw new Error(
        `Missing ${label}: ${relative(projectRoot, path).split(sep).join("/")}`,
        { cause: error },
      );
    }
  }

  const { environment: commandEnvironment } = await prepareEnvironment(
    { CLOUDFLARE_ENV: environment },
    { policy: "offline" },
  );
  await runNode(
    [
      "--experimental-loader",
      pathToFileURL(
        resolve(projectRoot, "scripts", "cloudflare-workers-loader.mjs"),
      ).href,
      resolve(projectRoot, "scripts", "validate-cloudflare-artifact.mjs"),
    ],
    {
      environment: commandEnvironment,
      label: `${environment} artifact validation`,
      timeoutMs: parseDuration(
        process.env.SITES_ARTIFACT_TIMEOUT || "2m",
        "SITES_ARTIFACT_TIMEOUT",
      ),
      killAfterMs: parseDuration(
        process.env.SITES_BUILD_KILL_AFTER || "10s",
        "SITES_BUILD_KILL_AFTER",
      ),
    },
  );
  await runNodeEntry(
    resolve(projectRoot, "scripts", "verify-artifact-performance-budgets.mjs"),
    [],
    {
      environment: commandEnvironment,
      label: `${environment} artifact performance-budget verification`,
      timeoutMs: parseDuration(
        process.env.SITES_ARTIFACT_TIMEOUT || "2m",
        "SITES_ARTIFACT_TIMEOUT",
      ),
      killAfterMs: parseDuration(
        process.env.SITES_BUILD_KILL_AFTER || "10s",
        "SITES_BUILD_KILL_AFTER",
      ),
    },
  );
}

async function runArtifactPerformanceBudget(args) {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
    throw new Error("performance-budget accepts only --json");
  }
  const { environment } = await prepareEnvironment({}, { policy: "offline" });
  await runNodeEntry(
    resolve(projectRoot, "scripts", "verify-artifact-performance-budgets.mjs"),
    args,
    {
      environment,
      label: "artifact performance-budget verification",
      timeoutMs: parseDuration(
        process.env.SITES_ARTIFACT_TIMEOUT || "2m",
        "SITES_ARTIFACT_TIMEOUT",
      ),
      killAfterMs: parseDuration(
        process.env.SITES_BUILD_KILL_AFTER || "10s",
        "SITES_BUILD_KILL_AFTER",
      ),
    },
  );
}

async function normalizeGeneratedWranglerConfig() {
  const configPath = resolve(projectRoot, "dist", "server", "wrangler.json");
  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw);
  // Wrangler 4.119+ rejects the legacy_env field emitted by the current
  // Vinext artifact generator. Removing it preserves the documented default
  // environment behavior while allowing current Workers/Container tooling.
  if (!Object.hasOwn(config, "legacy_env")) {
    return;
  }
  delete config.legacy_env;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function removePackagedSecretFiles() {
  const artifactRoot = resolve(projectRoot, "dist");
  const secretFileName = (name) =>
    name === ".env" ||
    name.startsWith(".env.") ||
    name === ".dev.vars" ||
    name.startsWith(".dev.vars.");

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const artifactRelativePath = relative(artifactRoot, path);
      if (
        artifactRelativePath === "" ||
        artifactRelativePath.startsWith(`..${sep}`) ||
        artifactRelativePath === ".."
      ) {
        throw new Error(`Refusing to sanitize path outside build artifact: ${path}`);
      }
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && secretFileName(entry.name)) {
        await rm(path, { force: true });
      }
    }
  }

  await visit(artifactRoot);
}

async function build(environment) {
  const { environment: commandEnvironment } = await prepareEnvironment(
    environment === "development"
      ? { CLOUDFLARE_ENV: undefined }
      : { CLOUDFLARE_ENV: environment },
    { policy: "offline" },
  );
  if (environment === "development") {
    delete commandEnvironment.CLOUDFLARE_ENV;
  }

  console.log(`Running bounded ${environment} vinext build...`);
  await runPackageBinary("vinext", "vinext", ["build"], {
    environment: commandEnvironment,
    label: `${environment} vinext build`,
    timeoutMs: parseDuration(
      process.env.SITES_BUILD_TIMEOUT || "3m",
      "SITES_BUILD_TIMEOUT",
    ),
    killAfterMs: parseDuration(
      process.env.SITES_BUILD_KILL_AFTER || "10s",
      "SITES_BUILD_KILL_AFTER",
    ),
  });
  const normalizedFontReferences = await normalizeVinextFontArtifactReferences({
    artifactRoot: resolve(projectRoot, "dist"),
    fontCacheRoot: resolve(projectRoot, ".vinext", "fonts"),
  });
  if (normalizedFontReferences.rewrittenFiles.length > 0) {
    console.log(
      `Normalized Vinext font references: ${normalizedFontReferences.rewrittenFiles.join(", ")}`,
    );
  }
  const fontPrune = await pruneUnusedVinextFontArtifacts({
    artifactRoot: resolve(projectRoot, "dist"),
  });
  if (fontPrune.removedFamilies.length > 0) {
    console.log(`Removed unused Vinext font artifacts: ${fontPrune.removedFamilies.join(", ")}`);
  }
  await removePackagedSecretFiles();
  await normalizeGeneratedWranglerConfig();
  await validateArtifact(environment);
}

async function safelyRemoveDryRunDirectory(path, temporaryRoot) {
  const relativePath = relative(temporaryRoot, path);
  if (
    relativePath.startsWith("..") ||
    relativePath === "" ||
    !relativePath.startsWith("juro-cloudflare-dry-run.")
  ) {
    throw new Error(`Refusing to remove unexpected dry-run path: ${path}`);
  }
  await rm(path, { recursive: true, force: true });
}

async function validateCloudflareMatrix() {
  const { paths } = await prepareEnvironment({}, { policy: "offline" });
  for (const environment of supportedEnvironments) {
    console.log(`Validating ${environment} Cloudflare artifact...`);
    await build(environment);

    const dryRunDirectory = await mkdtemp(
      resolve(paths.temporary, "juro-cloudflare-dry-run."),
    );
    try {
      const { environment: commandEnvironment } = await prepareEnvironment(
        {},
        { policy: "offline" },
      );
      delete commandEnvironment.CLOUDFLARE_ENV;
      await runPackageBinary(
        "wrangler",
        "wrangler",
        [
          "deploy",
          "--dry-run",
          "--config",
          resolve(projectRoot, "dist", "server", "wrangler.json"),
          "--outdir",
          dryRunDirectory,
        ],
        {
          environment: commandEnvironment,
          label: `${environment} Wrangler dry-run`,
          timeoutMs: parseDuration(
            process.env.SITES_WRANGLER_TIMEOUT || "3m",
            "SITES_WRANGLER_TIMEOUT",
          ),
          killAfterMs: parseDuration(
            process.env.SITES_BUILD_KILL_AFTER || "10s",
            "SITES_BUILD_KILL_AFTER",
          ),
        },
      );
    } finally {
      await safelyRemoveDryRunDirectory(dryRunDirectory, paths.temporary);
    }
  }
  // Matrix validation ends with production. Restore a harmless local artifact so later manual commands cannot reuse production configuration.
  await build("development");
}

async function runInteractiveTask(packageName, binaryName, args, overrides) {
  const logPath = resolve(projectRoot, ".wrangler", "wrangler.log");
  await mkdir(dirname(logPath), { recursive: true });
  await runPackageBinary(packageName, binaryName, args, {
    environment: {
      ...process.env,
      WRANGLER_LOG_PATH: logPath,
      ...overrides,
    },
    label: binaryName,
    // A separate POSIX process group lets SIGINT/SIGTERM and timeouts reach
    // Vite/Vinext descendants. Windows uses taskkill /T instead.
    detached: process.platform !== "win32",
  });
}

async function runWranglerTypes(check, args) {
  const { environment } = await prepareEnvironment(
    { CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" },
    { policy: "offline" },
  );
  await runPackageBinary(
    "wrangler",
    "wrangler",
    [
      "types",
      "worker-configuration.d.ts",
      ...(check ? ["--check"] : []),
      "--config",
      "wrangler.jsonc",
      ...args,
    ],
    {
      environment,
      label: check ? "Wrangler types check" : "Wrangler types generation",
      timeoutMs: parseDuration(
        process.env.SITES_CHECK_TIMEOUT || "5m",
        "SITES_CHECK_TIMEOUT",
      ),
      killAfterMs: parseDuration(
        process.env.SITES_BUILD_KILL_AFTER || "10s",
        "SITES_BUILD_KILL_AFTER",
      ),
    },
  );
}

async function runTestCommand(args, label, overrides = {}) {
  const { environment } = await prepareEnvironment(
    overrides,
    { policy: "offline" },
  );
  await runNode(args, {
    environment,
    label,
    timeoutMs: parseDuration(
      process.env.SITES_TEST_TIMEOUT || "10m",
      "SITES_TEST_TIMEOUT",
    ),
    killAfterMs: parseDuration(
      process.env.SITES_BUILD_KILL_AFTER || "10s",
      "SITES_BUILD_KILL_AFTER",
    ),
  });
}

async function runRenderedTests() {
  await runTestCommand(
    [resolve(projectRoot, "scripts", "run-rendered-html-tests.mjs")],
    "rendered HTML tests",
  );
}

async function runCoreTests() {
  await runTestCommand(
    [
      "--experimental-loader",
      pathToFileURL(resolve(projectRoot, "scripts", "cloudflare-workers-loader.mjs")).href,
      "--import",
      "tsx",
      "--test",
      ...coreTestFiles,
    ],
    "platform core tests",
  );
}

async function runCloudflareTests() {
  await runTestCommand(
    [
      "--experimental-loader",
      pathToFileURL(resolve(projectRoot, "scripts", "cloudflare-workers-loader.mjs")).href,
      "--import",
      "tsx",
      "--test",
      ...cloudflareTestFiles,
    ],
    "Cloudflare tests",
  );
}

async function runSmoke(script, args) {
  const smokeOverrides = process.env.JURO_SMOKE_BASE_URL
    ? { JURO_SMOKE_BASE_URL: process.env.JURO_SMOKE_BASE_URL }
    : {};
  await runTestCommand(
    ["--import", "tsx", resolve(projectRoot, "scripts", script), ...args],
    script,
    smokeOverrides,
  );
}

function assertNoArgs(task, args) {
  if (args.length !== 0) {
    throw new Error(`${task} does not accept arguments: ${args.join(" ")}`);
  }
}

function parseEnvironmentArgs(task, args) {
  if (args.length === 0) {
    return undefined;
  }
  if (args.length !== 2 || args[0] !== "--environment") {
    throw new Error(
      `${task} accepts only --environment <development|staging|production>`,
    );
  }
  if (!args[1] || args[1].startsWith("--")) {
    throw new Error("--environment requires a value");
  }
  return args[1];
}

async function main() {
  const [task, ...args] = process.argv.slice(2);
  switch (task) {
    case "install-ci": {
      if (
        args.length > 1 ||
        (args.length === 1 && args[0] !== "--validate-only")
      ) {
        throw new Error("install-ci accepts only --validate-only");
      }
      const { runInstallCi } = await import("./platform-install-ci.mjs");
      await runInstallCi({
        projectRoot,
        runtimeRoot,
        prepareEnvironment,
        resolvePackageBinary,
        runNodeEntry,
        parseDuration,
        cancellationSignal: signalState.cancellationController.signal,
        validateOnly: args.includes("--validate-only"),
      });
      return;
    }
    case "test":
      assertNoArgs("test", args);
      await build("development");
      await runRenderedTests();
      await runCoreTests();
      await runCloudflareTests();
      return;
    case "test-rendered":
      assertNoArgs("test-rendered", args);
      await runRenderedTests();
      return;
    case "test-cloudflare":
      assertNoArgs("test-cloudflare", args);
      await runCloudflareTests();
      return;
    case "smoke-document-builder":
      await runSmoke("smoke-document-builder.ts", args);
      return;
    case "smoke-document-comparison":
      await runSmoke("smoke-document-comparison.ts", args);
      return;
    case "smoke-case-create":
      await runSmoke("smoke-case-create.ts", args);
      return;
    case "dev":
      await runInteractiveTask(
        "vite",
        "vite",
        args,
        {
          JURO_AGENT_PREVIEW_COMPATIBILITY_DATE: "2026-05-22",
          LOCAL_AUTH_BYPASS: process.env.LOCAL_AUTH_BYPASS ?? "true",
          LOCAL_AUTH_EMAIL:
            process.env.LOCAL_AUTH_EMAIL ?? "developer@local.juro.uz",
          LOCAL_AUTH_FULL_NAME:
            process.env.LOCAL_AUTH_FULL_NAME ?? "JURO Local Developer",
        },
      );
      return;
    case "start":
      await runInteractiveTask("vinext", "vinext", ["start", ...args], {});
      return;
    case "type-check": {
      assertNoArgs("type-check", args);
      const { environment } = await prepareEnvironment(
        {},
        { policy: "offline" },
      );
      await runPackageBinary("typescript", "tsc", ["--noEmit"], {
        environment,
        label: "TypeScript type-check",
        timeoutMs: parseDuration(
          process.env.SITES_CHECK_TIMEOUT || "5m",
          "SITES_CHECK_TIMEOUT",
        ),
        killAfterMs: parseDuration(
          process.env.SITES_BUILD_KILL_AFTER || "10s",
          "SITES_BUILD_KILL_AFTER",
        ),
      });
      return;
    }
    case "lint": {
      assertNoArgs("lint", args);
      const { environment } = await prepareEnvironment(
        {},
        { policy: "offline" },
      );
      await runPackageBinary(
        "eslint",
        "eslint",
        [
          ".",
          "--ignore-pattern",
          "dist/**",
          "--ignore-pattern",
          ".next/**",
          "--ignore-pattern",
          ".wrangler/**",
          "--ignore-pattern",
          ".sites-runtime/**",
          "--ignore-pattern",
          "outputs/**",
          "--ignore-pattern",
          "worker-configuration.d.ts",
        ],
        {
          environment,
          label: "ESLint",
          timeoutMs: parseDuration(
            process.env.SITES_CHECK_TIMEOUT || "5m",
            "SITES_CHECK_TIMEOUT",
          ),
          killAfterMs: parseDuration(
            process.env.SITES_BUILD_KILL_AFTER || "10s",
            "SITES_BUILD_KILL_AFTER",
          ),
        },
      );
      return;
    }
    case "build": {
      const environment = selectedEnvironment(parseEnvironmentArgs("build", args));
      await build(environment);
      return;
    }
    case "artifact": {
      // Build the requested environment before validating so a stale artifact
      // from another preflight cannot be mistaken for this one.
      const environment = selectedEnvironment(parseEnvironmentArgs("artifact", args));
      await build(environment);
      return;
    }
    case "performance-budget":
      await runArtifactPerformanceBudget(args);
      return;
    case "matrix":
      assertNoArgs("matrix", args);
      await validateCloudflareMatrix();
      return;
    case "cf-types":
      assertNoArgs("cf-types", args);
      await runWranglerTypes(false, args);
      return;
    case "cf-types-check":
      assertNoArgs("cf-types-check", args);
      await runWranglerTypes(true, args);
      return;
    case "db-generate": {
      const { environment } = await prepareEnvironment(
        {},
        { policy: "offline" },
      );
      await runPackageBinary(
        "drizzle-kit",
        "drizzle-kit",
        ["generate", ...args],
        {
          environment,
          label: "Drizzle migration generation",
          timeoutMs: parseDuration(
            process.env.SITES_CHECK_TIMEOUT || "5m",
            "SITES_CHECK_TIMEOUT",
          ),
          killAfterMs: parseDuration(
            process.env.SITES_BUILD_KILL_AFTER || "10s",
            "SITES_BUILD_KILL_AFTER",
          ),
        },
      );
      return;
    }
    default:
      throw new Error(
        "Usage: node scripts/platform-tasks.mjs <install-ci|dev|start|test|test-rendered|test-cloudflare|smoke-document-builder|smoke-document-comparison|smoke-case-create|type-check|lint|build|artifact|performance-budget|matrix|cf-types|cf-types-check|db-generate>",
      );
  }
}

installSignalHandlers();
try {
  await main();
  throwIfCancelled();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = Number.isSafeInteger(error?.exitCode) ? error.exitCode : 1;
} finally {
  if (signalState.activeChild) {
    await forwardSignal(signalState.received || "SIGTERM", true);
    signalState.activeChild = null;
  }
  removeSignalHandlers();
}
