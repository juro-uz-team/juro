import {
  assertSafeWrite,
  requireApiUser,
  withApiErrors,
} from "../../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../../lib/document-builder/storage/db";
import {
  requireD1,
  requireR2,
  runtimeEnv,
} from "../../../../../lib/document-builder/storage/runtime";
import { malwareScannerResponseSchema } from "../../../../../lib/document-analysis/malware-scanner";
import { isLawyerProfileDirectoryPreviewEnabled } from "../../../../../lib/platform/lawyer-profile-preview";
import {
  isRestrictedLawyerMarketplaceStatus,
  missingLawyerMarketplaceFields,
} from "../../../../../lib/platform/lawyer-marketplace";
import { localizedLawyerProfileStatusNotification } from "../../../../../lib/platform/lawyer-profile-notifications";
import { workspaceForUser } from "../../../../../lib/platform/workspace";

const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;

type ImageSpec = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
};
type ProfileForPhoto = {
  id: string;
  marketplaceStatus: string;
  locale: "ru" | "uz" | "en";
  displayName: string;
  specialtiesJson: string;
  languagesJson: string;
  experienceYears: number | null;
  priceDescription: string | null;
  availabilityStatus: string;
  firmName: string | null;
  city: string | null;
  region: string | null;
  education: string | null;
  consultationFormatsJson: string;
  profilePhotoKey: string | null;
  profileRevision: number;
  hasPhone: number;
};

type StoredProfilePhoto = {
  profilePhotoKey: string;
  profilePhotoMime: "image/jpeg" | "image/png" | "image/webp";
  profilePhotoSha256: string | null;
  profilePhotoSizeBytes: number | null;
};

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

function stringList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function imageSpec(bytes: Uint8Array): ImageSpec | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Profile images are user content too. Keep them out of private R2 until the
 * same scanner contract used by document uploads has returned a verifiable
 * clean verdict. A missing/unhealthy scanner therefore blocks the write.
 */
async function scanProfilePhoto(
  bytes: Uint8Array,
  mimeType: ImageSpec["mimeType"],
  checksum: string,
): Promise<"clean" | "infected" | "unavailable"> {
  const env = runtimeEnv() as {
    MALWARE_SCAN_ENABLED?: string;
    MALWARE_SCANNER?: Fetcher;
  };
  if (env.MALWARE_SCAN_ENABLED !== "true" || !env.MALWARE_SCANNER)
    return "unavailable";
  let scanResponse: Response;
  try {
    scanResponse = await env.MALWARE_SCANNER.fetch(
      "https://malware-scanner.internal/v1/scan",
      {
        method: "POST",
        headers: {
          "content-type": mimeType,
          "content-length": String(bytes.byteLength),
          "x-juro-scan-schema": "1",
          "x-content-sha256": checksum,
        },
        body: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      },
    );
  } catch {
    return "unavailable";
  }
  if (!scanResponse.ok) return "unavailable";
  const responseText = await scanResponse.text();
  if (new TextEncoder().encode(responseText).byteLength > 65_536)
    return "unavailable";
  const parsed = malwareScannerResponseSchema.safeParse(
    (() => {
      try {
        return JSON.parse(responseText);
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success || parsed.data.sourceSha256 !== checksum)
    return "unavailable";
  return parsed.data.verdict;
}

async function ownProfile(userId: string): Promise<ProfileForPhoto | null> {
  return requireD1()
    .prepare(
      `SELECT p.id,p.marketplace_status AS marketplaceStatus,
      CASE WHEN u.locale='uz' THEN 'uz' WHEN u.locale='en' THEN 'en' ELSE 'ru' END AS locale,
      p.display_name AS displayName,p.specialties_json AS specialtiesJson,
      p.languages_json AS languagesJson,p.experience_years AS experienceYears,
      p.price_description AS priceDescription,p.availability_status AS availabilityStatus,
      p.firm_name AS firmName,p.city,p.region,p.education,
      p.consultation_formats_json AS consultationFormatsJson,
      p.profile_photo_key AS profilePhotoKey,p.profile_revision AS profileRevision,
      CASE WHEN u.phone IS NOT NULL AND length(trim(u.phone))>0 THEN 1 ELSE 0 END AS hasPhone
     FROM lawyer_profiles p JOIN user_profiles u ON u.id=p.user_id
     WHERE p.user_id=? AND u.account_type IN ('lawyer','business') LIMIT 1`,
    )
    .bind(userId)
    .first<ProfileForPhoto>();
}

/**
 * The review state is private. The public image route deliberately serves only
 * approved marketplace profiles, while the professional can still preview the
 * image they uploaded in their own authenticated settings.
 */
export const GET = withApiErrors(async function GET() {
  if (!isLawyerProfileDirectoryPreviewEnabled(runtimeEnv())) {
    return response({ code: "NOT_AVAILABLE" }, 404);
  }
  const user = await requireApiUser();
  const photo = await requireD1()
    .prepare(
      `SELECT profile_photo_key AS profilePhotoKey,profile_photo_mime AS profilePhotoMime,
      profile_photo_sha256 AS profilePhotoSha256,profile_photo_size_bytes AS profilePhotoSizeBytes
     FROM lawyer_profiles
     WHERE user_id=?
       AND profile_photo_key IS NOT NULL
       AND profile_photo_mime IN ('image/jpeg','image/png','image/webp')
     LIMIT 1`,
    )
    .bind(user.id)
    .first<StoredProfilePhoto>();
  if (!photo) return response({ code: "PROFILE_PHOTO_UNAVAILABLE" }, 404);

  const object = await requireR2().get(photo.profilePhotoKey);
  if (!object || object.size !== photo.profilePhotoSizeBytes) {
    return response({ code: "PROFILE_PHOTO_UNAVAILABLE" }, 404);
  }
  return new Response(object.body, {
    headers: {
      "content-type": photo.profilePhotoMime,
      "cache-control": "private, no-store",
      pragma: "no-cache",
      "x-content-type-options": "nosniff",
      etag: photo.profilePhotoSha256
        ? `\"${photo.profilePhotoSha256}\"`
        : object.httpEtag,
    },
  });
});

export const POST = withApiErrors(async function POST(request: Request) {
  if (!isLawyerProfileDirectoryPreviewEnabled(runtimeEnv())) {
    return response({ code: "NOT_AVAILABLE" }, 404);
  }
  assertSafeWrite(request);
  const user = await requireApiUser();
  const profile = await ownProfile(user.id);
  if (!profile) return response({ code: "PROFILE_UNAVAILABLE" }, 404);
  if (isRestrictedLawyerMarketplaceStatus(profile.marketplaceStatus)) {
    return response({ code: "PROFILE_LOCKED" }, 423);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !request.body ||
    !Number.isFinite(contentLength) ||
    contentLength > MAX_PROFILE_PHOTO_BYTES
  ) {
    return response({ code: "PROFILE_PHOTO_TOO_LARGE" }, 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.byteLength > MAX_PROFILE_PHOTO_BYTES) {
    return response({ code: "PROFILE_PHOTO_TOO_LARGE" }, 413);
  }
  const spec = imageSpec(bytes);
  if (!spec) return response({ code: "PROFILE_PHOTO_INVALID" }, 415);

  const checksum = await sha256(bytes);
  const scanVerdict = await scanProfilePhoto(bytes, spec.mimeType, checksum);
  if (scanVerdict === "infected")
    return response({ code: "PROFILE_PHOTO_UNSAFE" }, 422);
  if (scanVerdict !== "clean")
    return response({ code: "MALWARE_SCANNER_UNAVAILABLE" }, 503);
  const objectKey = `lawyer-profiles/${user.id}/${checksum}.${spec.extension}`;
  const bucket = requireR2();
  let createdObject = false;
  if (!(await bucket.head(objectKey))) {
    const stored = await bucket.put(objectKey, bytes, {
      onlyIf: new Headers({ "if-none-match": "*" }),
      sha256: checksum,
      httpMetadata: {
        contentType: spec.mimeType,
        cacheControl: "private, no-store",
      },
      customMetadata: { purpose: "lawyer_profile_photo", sha256: checksum },
    });
    if (!stored) return response({ code: "PROFILE_PHOTO_STORAGE_FAILED" }, 503);
    createdObject = true;
  }

  const marketplaceStatus = "profile_incomplete";
  const missingRequiredFields = missingLawyerMarketplaceFields({
    displayName: profile.displayName,
    specialties: stringList(profile.specialtiesJson),
    languages: stringList(profile.languagesJson),
    experienceYears: profile.experienceYears,
    education: profile.education,
    firmName: profile.firmName,
    city: profile.city,
    region: profile.region,
    priceDescription: profile.priceDescription,
    consultationFormats: stringList(profile.consultationFormatsJson),
    availabilityStatus: profile.availabilityStatus,
    profilePhotoKey: objectKey,
    hasPhone: profile.hasPhone === 1,
  });
  const workspace = await workspaceForUser(user);
  const now = isoNow();
  const db = requireD1();
  const auditId = crypto.randomUUID();
  const statusChanged = profile.marketplaceStatus !== marketplaceStatus;
  const notification = localizedLawyerProfileStatusNotification(
    profile.locale,
    marketplaceStatus,
  );
  const statements = [
    db
      .prepare(
        `UPDATE lawyer_profiles SET
        profile_photo_key=?,profile_photo_mime=?,profile_photo_sha256=?,profile_photo_size_bytes=?,
        profile_revision=profile_revision+1,status='pending',marketplace_status=?,
        public_approved_at=NULL,updated_at=?
       WHERE id=? AND user_id=? AND profile_revision=?`,
      )
      .bind(
        objectKey,
        spec.mimeType,
        checksum,
        bytes.byteLength,
        marketplaceStatus,
        now,
        profile.id,
        user.id,
        profile.profileRevision,
      ),
    db
      .prepare(
        `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       SELECT ?,?,?,'lawyer_profile',?,'lawyer_profile_photo_updated',?,?
       WHERE EXISTS (
         SELECT 1 FROM lawyer_profiles
         WHERE id=? AND user_id=? AND profile_revision=?
           AND marketplace_status=? AND updated_at=?
       )`,
      )
      .bind(
        auditId,
        workspace.id,
        user.id,
        profile.id,
        JSON.stringify({
          sha256: checksum,
          sizeBytes: bytes.byteLength,
          marketplaceStatus,
          missingRequiredFields,
        }),
        now,
        profile.id,
        user.id,
        profile.profileRevision + 1,
        marketplaceStatus,
        now,
      ),
  ];
  if (statusChanged) {
    statements.push(
      db
        .prepare(
          `INSERT INTO notifications
          (id,workspace_id,user_id,document_id,type,title,body,read_at,created_at)
         SELECT ?,?,?,NULL,'lawyer_profile_status',?,?,NULL,?
         WHERE EXISTS (
           SELECT 1 FROM lawyer_profiles
           WHERE id=? AND user_id=? AND profile_revision=?
             AND status='pending' AND marketplace_status=? AND updated_at=?
         )`,
        )
        .bind(
          crypto.randomUUID(),
          workspace.id,
          user.id,
          notification.title,
          notification.body,
          now,
          profile.id,
          user.id,
          profile.profileRevision + 1,
          marketplaceStatus,
          now,
        ),
    );
  }
  const result = await db.batch(statements).catch(async (error) => {
    if (createdObject) await bucket.delete(objectKey).catch(() => undefined);
    throw error;
  });
  if (
    Number(result[0]?.meta.changes ?? 0) !== 1 ||
    Number(result[1]?.meta.changes ?? 0) !== 1 ||
    (statusChanged && Number(result[2]?.meta.changes ?? 0) !== 1)
  ) {
    if (createdObject) await bucket.delete(objectKey).catch(() => undefined);
    return response({ code: "PROFILE_UNAVAILABLE" }, 409);
  }
  if (profile.profilePhotoKey && profile.profilePhotoKey !== objectKey) {
    await bucket.delete(profile.profilePhotoKey).catch(() => undefined);
  }
  return response(
    {
      ok: true,
      marketplaceStatus,
      missingRequiredFields,
      profilePhotoUrl: "/api/platform/lawyer-profile/photo",
    },
    201,
  );
});
