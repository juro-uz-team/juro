export class AuthRequestTimeoutError extends Error {
  constructor() {
    super("Authentication request timed out");
    this.name = "AuthRequestTimeoutError";
  }
}

/** Bound both response headers and body; never replay an account action automatically. */
export async function requestAuthJson<T>(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let data: T;
    try {
      data = await response.json() as T;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      data = {} as T;
    }
    return { response, data };
  } catch (error) {
    if (controller.signal.aborted) throw new AuthRequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
