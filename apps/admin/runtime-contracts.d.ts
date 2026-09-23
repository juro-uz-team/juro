interface Env {
  APP_ENV: "development" | "staging" | "production";
  PLATFORM_ORIGIN: string;
  ADMIN_INTERNAL_TOKEN?: string;
  ADMIN_CONSOLE_TOKEN?: string;
  PLATFORM_ADMIN_API: { fetch(request: Request): Promise<Response> };
}
