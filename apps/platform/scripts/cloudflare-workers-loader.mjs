/** Node-only validation shim for Cloudflare's runtime-provided module. */
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      url: "data:text/javascript,export const env = {}; export class RpcTarget {}; export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }; export class DurableObject {}; export class WorkflowEntrypoint {};",
      shortCircuit: true,
    };
  }
  // Node 24 can pass a Windows absolute path back through a custom loader.
  // The default ESM resolver accepts its file URL form, not the raw `C:\...`
  // string, while this remains a no-op for ordinary package specifiers.
  if (isAbsolute(specifier)) {
    return nextResolve(pathToFileURL(specifier).href, context);
  }
  const resolved = await nextResolve(specifier, context);
  if (resolved?.url && isAbsolute(resolved.url)) {
    return { ...resolved, url: pathToFileURL(resolved.url).href };
  }
  return resolved;
}
