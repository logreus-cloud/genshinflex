import type { SupabaseClient } from '@supabase/supabase-js';

export async function collectProfileMedia(client: Pick<SupabaseClient, 'rpc'> & { storage: Pick<SupabaseClient['storage'], 'from'> }): Promise<{ removed: number }> {
  const { data, error } = await client.rpc('profile_media_gc_collect', { p_limit: 200 });
  if (error) throw error;
  const names = (data ?? []) as string[];
  // Резерв в базе действует 30 минут (дольше предела cron-обработчика): поздние пачки не начинаем,
  // чтобы не удалить файл, на который после истечения резерва уже сослался профиль
  const deadline = Date.now() + 5 * 60_000;
  const bucket = client.storage.from('profile-media');
  let removed = 0;
  for (let offset = 0; offset < names.length; offset += 100) {
    if (Date.now() > deadline) break;
    const batch = names.slice(offset, offset + 100);
    const { error: removeError } = await bucket.remove(batch);
    if (removeError) throw removeError;
    const { error: doneError } = await client.rpc('profile_media_gc_done', { p_names: batch });
    if (doneError) throw doneError;
    removed += batch.length;
  }
  if (removed) console.log('profile media gc', { removed });
  return { removed };
}
