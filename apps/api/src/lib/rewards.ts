import type { SupabaseClient } from '@supabase/supabase-js';

export type RewardClient = Pick<SupabaseClient, 'from'>;

export class RewardError extends Error {
  // Без parameter properties: тесты запускаются через node --experimental-strip-types
  readonly status: 400 | 404;
  constructor(message: string, status: 400 | 404) {
    super(message);
    this.status = status;
  }
}

const fields = 'id,kind,name_ru,name_en,name_es,description';
const rewardId = /^[a-z0-9-]{2,32}$/;
const userId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RewardError('Неверные данные', 400);
  }
  return value as Record<string, unknown>;
}

function validateUserId(id: string): void {
  if (!userId.test(id)) throw new RewardError('Неверный ID пользователя', 400);
}

function validateRewardId(id: string): void {
  if (!rewardId.test(id)) throw new RewardError('Неверный ID награды', 400);
}

function optionalNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || [...value].length > 200) {
    throw new RewardError('Неверные данные', 400);
  }
  return value;
}

export async function listRewards(client: RewardClient) {
  const { data, error } = await client.from('rewards').select(fields).order('id');
  if (error) throw error;
  return data || [];
}

export async function getUserRewards(client: RewardClient, id: string): Promise<string[]> {
  validateUserId(id);
  const { data, error } = await client.from('user_rewards')
    .select('reward_id').eq('user_id', id).order('granted_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => row.reward_id);
}

export async function grantReward(client: RewardClient, id: string, input: unknown, admin: string) {
  validateUserId(id);
  const value = record(input);
  if (typeof value.reward !== 'string') throw new RewardError('Неверный ID награды', 400);
  validateRewardId(value.reward);
  const note = optionalNote(value.note);
  const known = await client.from('rewards').select('id').eq('id', value.reward).maybeSingle();
  if (known.error) throw known.error;
  if (!known.data) throw new RewardError('Награда не найдена', 404);
  const { error } = await client.from('user_rewards')
    .insert({ user_id: id, reward_id: value.reward, granted_by: admin, note });
  if (error?.code === '23505') return { ok: true };
  if (error?.code === '23503') throw new RewardError('Пользователь или награда не найдены', 404);
  if (error) throw error;
  return { ok: true };
}

export async function revokeReward(client: RewardClient, id: string, reward: string) {
  validateUserId(id);
  validateRewardId(reward);
  const { data, error } = await client.from('user_rewards')
    .delete().eq('user_id', id).eq('reward_id', reward).select('reward_id').maybeSingle();
  if (error) throw error;
  if (!data) throw new RewardError('Награда не выдана', 404);
  return { ok: true };
}
