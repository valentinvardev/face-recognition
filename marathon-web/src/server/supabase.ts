import { createClient } from "@supabase/supabase-js";
import { env } from "~/env";

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

export const BUCKET = "marathon-photos";

export async function uploadImageBuffer(
  buffer: Buffer,
  filename: string,
  contentType = "image/jpeg",
): Promise<string> {
  const path = `photos/${Date.now()}-${filename}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
