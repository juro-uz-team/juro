export function publicProfileMediaIndexing(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.DEPLOYMENT_ENVIRONMENT === "production"
    && environment.PRIVATE_DEVELOPMENT !== "true"
    && (environment.PLATFORM_HOST_ROLE ?? "app") === "app";
}

/** Only the approved-profile image handler may opt into indexing on the app host. */
export function publicProfilePhotoRequest(request: { method?: string; url?: string }, environment: Record<string, string | undefined> = process.env): boolean {
  return publicProfileMediaIndexing(environment)
    && (request.method === "GET" || request.method === "HEAD")
    && /^\/api\/public\/lawyers\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/photo$/.test((request.url ?? "").split("?")[0]);
}
