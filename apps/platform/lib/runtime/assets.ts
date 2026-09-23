import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";

export function localAssets(directory: string) {
  return { async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
    try {
      const root = await realpath(directory);
      const path = await realpath(resolve(root, "." + decodeURIComponent(new URL(request.url).pathname)));
      const suffix = relative(root, path);
      if (suffix === ".." || suffix.startsWith(".." + sep) || resolve(root, suffix) !== path) return new Response(null, { status: 404 });
      const metadata = await stat(path);
      if (!metadata.isFile()) return new Response(null, { status: 404 });
      const types: Record<string, string> = { ".ttf": "font/ttf", ".otf": "font/otf", ".woff2": "font/woff2", ".woff": "font/woff",
        ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".pdf": "application/pdf" };
      return new Response(request.method === "HEAD" ? null : Readable.toWeb(createReadStream(path)) as ReadableStream, {
        headers: { "content-type": types[extname(path)] ?? "application/octet-stream", "content-length": String(metadata.size) },
      });
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "") || error instanceof URIError) return new Response(null, { status: 404 });
      throw error;
    }
  } };
}
