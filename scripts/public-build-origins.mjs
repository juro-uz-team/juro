export function publicBuildOrigins(environment) {
  if (environment.PRIVATE_DEVELOPMENT === "true") return {};
  if (!["production", "staging"].includes(environment.DEPLOYMENT_ENVIRONMENT)) return {};
  const result = {};
  for (const [source, target] of [["APP_URL", "NEXT_PUBLIC_PLATFORM_ORIGIN"], ["PUBLIC_SITE_URL", "NEXT_PUBLIC_WEBSITE_ORIGIN"]]) {
    const value = environment[source];
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== value) throw Error(`Public build requires canonical HTTPS ${source}`);
    if (environment[target] && environment[target] !== value) throw Error(`${target} differs from ${source}`);
    result[target] = value;
  }
  return result;
}
