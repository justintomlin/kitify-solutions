// Photo uploads — Supabase Storage (a different service on the same project, so it lives
// outside lib/store.ts, which is strictly the Postgres data layer).
//
// BUCKET: 'job-photos' must exist and be public. It does NOT exist yet — create it in the
// Supabase dashboard (Storage → New bucket → name 'job-photos', Public ON). Until then
// every upload here fails with bucketMissing = true, and the callers deliberately treat
// that as non-fatal: the job still registers / the claim still files, just without photos.

import { supabase } from "@/lib/supabase";

export const JOB_PHOTOS_BUCKET = "job-photos";

// HEIC/HEIF is what an iPhone shoots by default, so it has to be accepted even though most
// browsers can't render a preview for it (the upload and the stored file are fine).
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const ACCEPT_ATTR =
  ".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif";

const ACCEPTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];

export type UploadResult = {
  urls: string[]; // public URLs of everything that landed
  failed: number; // how many files didn't upload
  bucketMissing: boolean; // true when storage isn't configured yet — a setup problem, not a file problem
};

// Storage object keys must be ASCII-ish and collision-free. Keep the original extension,
// strip everything exotic out of the stem, and prefix a per-upload counter + timestamp.
function safeName(file: File, index: number, tag?: string): string {
  const dot = file.name.lastIndexOf(".");
  const ext = (dot > 0 ? file.name.slice(dot + 1) : "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const stem = (dot > 0 ? file.name.slice(0, dot) : file.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "photo";
  // The tag (before/during/finished/…) rides in the filename: completion_photos is a
  // jsonb array of URL strings, and encoding the tag here keeps that shape intact.
  return [tag, `${Date.now()}-${index}`, stem].filter(Boolean).join("-") + "." + ext;
}

/**
 * Whether a picked file is an image we accept.
 *
 * Falls back to the extension when the MIME type is missing or unrecognised: iOS hands over
 * HEIC captures with an empty or non-standard `type` often enough that a strict MIME check
 * silently drops photos a contractor just took.
 */
export const isAcceptedImage = (f: File): boolean => {
  if (ACCEPTED_IMAGE_TYPES.includes(f.type)) return true;
  const dot = f.name.lastIndexOf(".");
  const ext = dot > 0 ? f.name.slice(dot + 1).toLowerCase() : "";
  return ACCEPTED_EXTENSIONS.includes(ext);
};

// Upload a batch under `prefix` (e.g. "orders/<id>" or "claims/<id>"). Never throws —
// callers decide what a partial or total failure means for their flow. onProgress reports
// how many files have been attempted so far.
export async function uploadPhotos(
  prefix: string,
  files: { file: File; tag?: string }[],
  onProgress?: (done: number, total: number) => void,
  bucket: string = JOB_PHOTOS_BUCKET,
): Promise<UploadResult> {
  const urls: string[] = [];
  let failed = 0;
  let bucketMissing = false;

  for (let i = 0; i < files.length; i++) {
    const { file, tag } = files[i];
    const path = `${prefix}/${safeName(file, i, tag)}`;
    const { error } = await supabase.storage
      .from(bucket)
      // contentType falls back for the iOS HEIC case where the browser reports no type.
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });

    if (error) {
      failed++;
      // Supabase reports a missing bucket as "Bucket not found" / NoSuchBucket. One such
      // error means storage isn't set up at all, so the remaining files will fail too.
      if (/bucket not found|nosuchbucket/i.test(error.message)) {
        bucketMissing = true;
        failed = files.length - urls.length;
        onProgress?.(files.length, files.length);
        break;
      }
    } else {
      urls.push(supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl);
    }
    onProgress?.(i + 1, files.length);
  }

  return { urls, failed, bucketMissing };
}
