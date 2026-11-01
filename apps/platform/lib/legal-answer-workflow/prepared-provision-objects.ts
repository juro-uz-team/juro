import { createHash } from "node:crypto";
import { z } from "zod";
import { createPreparedProvisionReader } from "./prepared-provision";
import { withinSignal } from "./lifetime";

const prefix = "legal-evidence/prepared-provision-v1/";
const documentPrefix = "legal-evidence/prepared-document-v1/";
const sectionPrefix = "legal-evidence/prepared-section-v1/";
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const targetSchema = z.tuple([z.string().min(1).max(240), z.string().min(1).max(240),
  z.enum(["en", "ru", "uz-Latn", "uz-Cyrl"]), digest]);

/** The versioned key references an immutable package range, not a newly stored source object. */
export function parsePreparedProvisionKey(key: string) {
  const wholeDocument = key.startsWith(documentPrefix);
  const wholeSection = key.startsWith(sectionPrefix);
  if (!wholeDocument && !wholeSection && !key.startsWith(prefix)) return null;
  const parts = key.slice((wholeDocument ? documentPrefix : wholeSection ? sectionPrefix : prefix).length).split("/");
  if (key.length > 1024 || parts.length !== 2 || !digest.safeParse(parts[0]).success
    || !/^[A-Za-z0-9_-]+$/u.test(parts[1])) throw new Error("PREPARED_PROVISION_KEY_INVALID");
  const decoded = Buffer.from(parts[1], "base64url");
  if (decoded.toString("base64url") !== parts[1]) throw new Error("PREPARED_PROVISION_KEY_INVALID");
  const [work, position, language, sha256] = targetSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)));
  return { packageSha256: parts[0], work, position, language, sha256, wholeDocument, wholeSection };
}

/** Read-only range views over stored prepared records; saved citations can reopen without request state. */
export function createPreparedProvisionObjects(input: { packageSha256: string;
  loadSource(work: string, signal: AbortSignal): Promise<unknown>;
}) {
  digest.parse(input.packageSha256);
  const sources = new Map<string, Promise<ReturnType<typeof createPreparedProvisionReader>>>();
  async function rangeReader(work: string, signal: AbortSignal) {
    signal.throwIfAborted();
    let pending = sources.get(work);
    if (!pending) {
      pending = withinSignal(signal, () => input.loadSource(work, signal)).then(createPreparedProvisionReader);
      sources.set(work, pending);
    }
    return withinSignal(signal, () => pending!);
  }
  async function stored(target: { work: string; position: string; language: string; wholeDocument?: boolean; wholeSection?: boolean }, signal: AbortSignal) {
    const read = await rangeReader(target.work, signal);
    return read(target);
  }
  async function read(target: { work: string; position: string; language: string; wholeDocument?: boolean; wholeSection?: boolean }, signal: AbortSignal) {
    const provision = await stored(target, signal);
    // Identify this newly rendered citation view; this is not an authenticity
    // comparison with a stored corpus digest. Reopening uses the retained range.
    const bytes = Buffer.from(provision.text), sha256 = createHash("sha256").update(bytes).digest("hex");
    const selector = targetSchema.parse([target.work, provision.position, provision.language, sha256]);
    const selectionPrefix = provision.sectionTitle !== null ? sectionPrefix : provision.articleTitle === null ? documentPrefix : prefix;
    const objectKey = `${selectionPrefix}${input.packageSha256}/${Buffer.from(JSON.stringify(selector)).toString("base64url")}`;
    if (objectKey.length > 1024) throw new Error("PREPARED_PROVISION_KEY_INVALID");
    return { ...provision, objectKey, sha256, byteCount: bytes.length };
  }
  return {
    // Navigation and citation rendering share this request-local structural index.
    rangeReader,
    read,
    async get(key: string, signal?: AbortSignal) {
      if (!signal) throw new Error("PREPARED_READ_LIFETIME_REQUIRED");
      signal.throwIfAborted();
      const reference = parsePreparedProvisionKey(key);
      if (!reference) throw new Error("PREPARED_PROVISION_KEY_INVALID");
      if (reference.packageSha256 !== input.packageSha256) throw new Error("PREPARED_PACKAGE_MISMATCH");
      const provision = await stored(reference, signal);
      // Older provision keys also represented unstructured whole documents.
      // Preserve those exact bytes while new document keys explicitly pin the full extent.
      if (provision.position !== reference.position) throw new Error("PREPARED_POSITION_UNAVAILABLE");
      return Buffer.from(provision.text);
    },
  };
}
