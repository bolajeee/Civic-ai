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
