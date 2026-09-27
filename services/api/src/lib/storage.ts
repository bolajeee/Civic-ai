import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Uploads an image to the Supabase 'reports' bucket.
 */
export async function uploadImage(filename: string, fileBuffer: Buffer, mimeType: string) {
  const { data, error } = await supabase.storage
    .from('reports')
    .upload(filename, fileBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Retrieves a signed URL for a private image in the 'reports' bucket.
 */
export async function getImageUrl(filename: string, expiresIn: number = 60 * 60 * 24) {
  const { data, error } = await supabase.storage
    .from('reports')
    .createSignedUrl(filename, expiresIn);

  if (error) {
    throw error;
  }
  return data.signedUrl;
}

/**
 * Retrieves signed URLs for many images in one round trip.
 *
 * The report history list needs a thumbnail per row; signing them one at a time
 * would mean N calls to storage for a single screen.
 *
 * Returns a map of storage key → signed URL. Keys that could not be signed are
 * simply absent, so a single bad reference cannot fail the whole listing.
 */
export async function getImageUrls(
  filenames: string[],
  expiresIn: number = 60 * 60 * 24,
): Promise<Record<string, string>> {
  if (filenames.length === 0) return {};

  const { data, error } = await supabase.storage
    .from('reports')
    .createSignedUrls(filenames, expiresIn);

  if (error) {
    throw error;
  }

  return Object.fromEntries(
    (data ?? [])
      .filter((entry) => entry.signedUrl)
      .map((entry) => [entry.path, entry.signedUrl]),
  );
}

/**
 * Removes images from the 'reports' bucket.
 *
 * Used to clean up after a failed report submission: images are uploaded before
 * the database rows are written, so a rollback would otherwise leave the bucket
 * holding files nothing references.
 */
export async function deleteImages(filenames: string[]) {
  if (filenames.length === 0) return;

  const { error } = await supabase.storage.from('reports').remove(filenames);

  if (error) {
    throw error;
  }
}
