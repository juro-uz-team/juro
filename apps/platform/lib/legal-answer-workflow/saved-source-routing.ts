import { z } from "zod";
import { parsePinnedCandidateRelease } from "../legal-corpus/legal-candidate-index";
import { preparedCandidateConfigurationSchema } from "../legal-corpus/prepared-candidate-configuration";
import { createPreparedTransportPair } from "./prepared-transport";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const routesSchema = z.array(z.object({ packageSha256: sha, workIndexSha256: sha,
  url: z.string(), workerSha256: sha, tokenEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u) }).strict()).max(128);

/** The caller authenticates the generation manifest before resolving its retained public source endpoint.
 * Routes survive active-release rotation and contain credential names, never credential values.
 */
export function resolveSavedSourceRoute(manifest: Uint8Array, packageSha256: string,
  env: Readonly<Record<string, string | undefined>>) {
  const registered = z.object({ currentRelease: z.unknown().optional(), historyRelease: z.unknown().optional() })
    .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifest)));
  const releases = [registered.currentRelease, registered.historyRelease].filter(value => value !== undefined)
    .map(value => {
      const release = parsePinnedCandidateRelease(value);
      return { release, configuration: preparedCandidateConfigurationSchema.parse(release.configuration) };
    });
  const matching = releases.filter(value => value.configuration.artifacts.packageSha256 === packageSha256);
  if (!matching.length || new Set(matching.map(value => value.configuration.artifacts.workIndexSha256)).size !== 1) {
    throw new Error("SAVED_SOURCE_RELEASE_UNAVAILABLE");
  }
  const serialized = env.LEGAL_ANSWER_RETAINED_SOURCES;
  if (!serialized || serialized.length > 131072) throw new Error("SAVED_SOURCE_ROUTE_UNAVAILABLE");
  const routes = routesSchema.parse(JSON.parse(serialized)).filter(route => route.packageSha256 === packageSha256
    && route.workIndexSha256 === matching[0].configuration.artifacts.workIndexSha256);
  if (routes.length !== 1) throw new Error("SAVED_SOURCE_ROUTE_UNAVAILABLE");
  const route = routes[0], token = env[route.tokenEnvironment];
  if (!token?.trim()) throw new Error("SAVED_SOURCE_CREDENTIAL_UNAVAILABLE");
  const worker = { url: route.url, workerSha256: route.workerSha256, token };
  createPreparedTransportPair({ discovery: worker });
  return { release: matching[0].release, worker };
}
