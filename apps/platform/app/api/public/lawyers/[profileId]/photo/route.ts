import { requireD1, requireR2 } from "../../../../../../lib/document-builder/storage/runtime";
import { z } from "zod";
import { publicProfileMediaIndexing } from "../../../../../../lib/platform/public-profile-media";

type Context = { params: Promise<{ profileId: string }> };
const missingPhoto = () => new Response(null, { status: 404, headers: { "x-robots-tag": "noindex, nofollow, noarchive" } });

export async function GET(_request: Request, context: Context) {
  const profileId = z.string().uuid().safeParse((await context.params).profileId);
  if (!profileId.success) return missingPhoto();
  const profile = await requireD1().prepare(
    `SELECT profile_photo_key AS profilePhotoKey,profile_photo_mime AS profilePhotoMime,
      profile_photo_sha256 AS profilePhotoSha256,profile_photo_size_bytes AS profilePhotoSizeBytes
     FROM lawyer_profiles
     WHERE id=? AND status='public_approved'
       AND marketplace_status='public_approved'
       AND public_approved_at IS NOT NULL
       AND profile_photo_key IS NOT NULL
       AND profile_photo_mime IN ('image/jpeg','image/png','image/webp')
     LIMIT 1`,
  ).bind(profileId.data).first<{
    profilePhotoKey: string;
    profilePhotoMime: string;
    profilePhotoSha256: string | null;
    profilePhotoSizeBytes: number | null;
  }>();
  if (!profile) return missingPhoto();
  const object = await requireR2().get(profile.profilePhotoKey);
  if (!object || object.size !== profile.profilePhotoSizeBytes) {
    return missingPhoto();
  }
  return new Response(object.body, {
    headers: {
      "content-type": profile.profilePhotoMime,
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "x-content-type-options": "nosniff",
      "x-robots-tag": publicProfileMediaIndexing() ? "index, follow" : "noindex, nofollow, noarchive",
      etag: profile.profilePhotoSha256 ? `\"${profile.profilePhotoSha256}\"` : object.httpEtag,
    },
  });
}
