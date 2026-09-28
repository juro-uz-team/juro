type EmailEnvironment = Record<string, string | undefined>;

/** Capture is restricted to private or staging deployments. Production requires real delivery. */
export function emailDeliveryConfiguration(environment: EmailEnvironment) {
  const mode = environment.EMAIL_DELIVERY_MODE ?? (environment.PRIVATE_DEVELOPMENT === "true" ? "capture" : "resend");
  if (mode === "capture") {
    if (environment.PRIVATE_DEVELOPMENT !== "true" && environment.DEPLOYMENT_ENVIRONMENT !== "staging") throw new Error("Email capture requires a private or staging deployment");
    return { mode, apiKey: "local-capture", from: "JURO <noreply@localhost>" } as const;
  }
  if (mode !== "resend") throw new Error("Unsupported email delivery mode");
  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = environment.EMAIL_FROM?.trim();
  if (!apiKey || apiKey === "local-capture" || /\s/.test(apiKey)) throw new Error("A Resend API key is required");
  if (!from || /[\r\n]/.test(from) || !/^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/.test(from.match(/<([^<>]+)>$/)?.[1] ?? from)) {
    throw new Error("A verified email sender is required");
  }
  return { mode, apiKey, from } as const;
}

/** Fixed HTTPS destination; redirects must never carry the provider credential elsewhere. */
export function createResendDelivery(apiKey: string, fetcher: typeof fetch = globalThis.fetch) {
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = new Request(input, init);
      if (!["https://api.resend.com/emails", "https://api.resend.com/emails/batch"].includes(request.url) || request.method !== "POST") {
        throw new Error("Unsupported email delivery request");
      }
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${apiKey}`);
      headers.set("content-type", "application/json");
      return fetcher(new Request(request, {
        headers,
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      }));
    },
  };
}
