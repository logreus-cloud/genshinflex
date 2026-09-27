import type { SupabaseClient } from '@supabase/supabase-js';

export type TitleClient = Pick<SupabaseClient, 'from'>;

export class TitleError extends Error {
  // Без parameter properties: тесты запускаются через node --experimental-strip-types
  readonly status: 400 | 404 | 409;
  constructor(message: string, status: 400 | 404 | 409) {
    super(message);
    this.status = status;
  }
}

const fields = 'id,name_ru,name_en,name_es,color,description';
const titleId = /^[a-z0-9-]{2,32}$/;
const titleColor = /^#[0-9a-fA-F]{6}$/;
const userId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TitleError('Неверные данные', 400);
  }
  return value as Record<string, unknown>;
}

function length(value: string): number {
  return [...value].length;
}

function optionalText(value: unknown, limit: number): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || length(value) > limit) {
    throw new TitleError('Неверные данные', 400);
  }
  return value;
}

export function validateTitle(input: unknown) {
  const value = record(input);
  if (typeof value.id !== 'string' || !titleId.test(value.id)) {
    throw new TitleError('Неверный ID титула', 400);
  }
  if (typeof value.name_ru !== 'string' || length(value.name_ru) < 1 || length(value.name_ru) > 32) {
    throw new TitleError('Неверное название титула', 400);
  }
  if (value.color !== undefined && (typeof value.color !== 'string' || !titleColor.test(value.color))) {
    throw new TitleError('Неверный цвет титула', 400);
  }
  return {
    id: value.id,
    name_ru: value.name_ru,
    name_en: optionalText(value.name_en, 32),
    name_es: optionalText(value.name_es, 32),
    color: value.color as string | undefined,
    description: optionalText(value.description, 200),
  };
}

export function validateActiveTitle(input: unknown): string | null {
  const value = record(input);
  if (value.title !== null && (typeof value.title !== 'string' || !titleId.test(value.title))) {
    throw new TitleError('Неверный титул', 400);
  }
  return value.title;
}

export function validateUserId(id: string): void {
  if (!userId.test(id)) throw new TitleError('Неверный ID пользователя', 400);
}

function validateTitleId(id: string): void {
  if (!titleId.test(id)) throw new TitleError('Неверный ID титула', 400);
}

export async function listTitles(client: TitleClient) {
  const { data, error } = await client.from('titles').select(fields).order('id');
  if (error) throw error;
  return data || [];
}

export async function getUserTitles(client: TitleClient, id: string) {
  const grants = await client.from('user_titles')
    .select('title_id,note,granted_at').eq('user_id', id)
    .order('granted_at', { ascending: false });
  if (grants.error) throw grants.error;
  if (!grants.data?.length) return [];

  const titles = await client.from('titles').select(fields)
    .in('id', grants.data.map((row) => row.title_id));
  if (titles.error) throw titles.error;
  const byId = new Map((titles.data || []).map((row) => [row.id, row]));
  // Титул могли удалить между запросами — такие выдачи пропускаем
  return grants.data.filter((grant) => byId.has(grant.title_id)).map((grant) => ({
    ...byId.get(grant.title_id),
    note: grant.note,
    granted_at: grant.granted_at,
  }));
}

export async function getUserRoles(client: TitleClient, id: string): Promise<string[]> {
  const { data, error } = await client.from('roles').select('role').eq('user_id', id);
  if (error) throw error;
  return (data || []).map((row) => row.role);
}

export async function setActiveTitle(client: TitleClient, id: string, input: unknown) {
  const title = validateActiveTitle(input);
  if (title !== null) {
    const owned = await client.from('user_titles').select('title_id')
      .eq('user_id', id).eq('title_id', title).maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) throw new TitleError('У вас нет этого титула', 400);
  }
  const { data, error } = await client.from('profiles')
    .update({ active_title: title }).eq('id', id).select('active_title').maybeSingle();
  if (error) {
    // Составной внешний ключ на user_titles: титул не выдан или его только что отозвали
    if (error.code === '23503') throw new TitleError('У вас нет этого титула', 400);
    throw error;
  }
  if (!data) throw new TitleError('Профиль не найден', 404);
  return { active_title: data.active_title };
}

export async function listAdminTitles(client: TitleClient) {
  const { data, error } = await client.from('titles')
    .select(`${fields},user_titles(count)`).order('id');
  if (error) throw error;
  return (data || []).map(({ user_titles, ...title }) => ({
    ...title,
    holders: Number(user_titles?.[0]?.count || 0),
  }));
}

export async function createTitle(client: TitleClient, input: unknown, admin: string) {
  const title = validateTitle(input);
  const { data, error } = await client.from('titles')
    .insert({ ...title, created_by: admin }).select(fields).single();
  if (error?.code === '23505') throw new TitleError('Титул уже существует', 409);
  if (error) throw error;
  return data;
}

export async function deleteTitle(client: TitleClient, id: string) {
  validateTitleId(id);
  if (id === 'admin') throw new TitleError('Титул администратора нельзя удалить', 400);
  const { data, error } = await client.from('titles')
    .delete().eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new TitleError('Титул не найден', 404);
  return { ok: true };
}

export async function searchUsers(client: TitleClient, input: string) {
  const query = input.trim();
  if (length(query) < 2) throw new TitleError('Введите минимум два символа', 400);
  // Ищем по части ника или отображаемого имени; значение в двойных кавычках — запятые и скобки не ломают фильтр or()
  const pattern = `%${query.replace(/[%_\\]/g, '\\$&')}%`.replace(/["\\]/g, '\\$&');
  const profiles = await client.from('profiles')
    .select('id,nickname,display_name')
    .or(`nickname.ilike."${pattern}",display_name.ilike."${pattern}"`)
    .order('nickname').limit(20);
  if (profiles.error) throw profiles.error;
  if (!profiles.data?.length) return [];

  const ids = profiles.data.map((row) => row.id);
  const [grants, roles] = await Promise.all([
    client.from('user_titles').select('user_id,title_id').in('user_id', ids),
    client.from('roles').select('user_id,role').in('user_id', ids),
  ]);
  if (grants.error) throw grants.error;
  if (roles.error) throw roles.error;
  return profiles.data.map((profile) => ({
    ...profile,
    titles: (grants.data || []).filter((row) => row.user_id === profile.id)
      .map((row) => row.title_id),
    roles: (roles.data || []).filter((row) => row.user_id === profile.id)
      .map((row) => row.role),
  }));
}

export async function grantTitle(client: TitleClient, id: string, input: unknown, admin: string) {
  validateUserId(id);
  const value = record(input);
  if (typeof value.title !== 'string') throw new TitleError('Неверный титул', 400);
  validateTitleId(value.title);
  const note = optionalText(value.note, 200);
  const { error } = await client.from('user_titles')
    .insert({ user_id: id, title_id: value.title, granted_by: admin, note });
  if (error?.code === '23505') throw new TitleError('Титул уже выдан', 409);
  if (error?.code === '23503') throw new TitleError('Пользователь или титул не найден', 404);
  if (error) throw error;
  return { ok: true };
}

export async function revokeTitle(client: TitleClient, id: string, title: string) {
  validateUserId(id);
  validateTitleId(title);
  const { data, error } = await client.from('user_titles')
    .delete().eq('user_id', id).eq('title_id', title).select('title_id').maybeSingle();
  if (error) throw error;
  if (!data) throw new TitleError('Титул не выдан', 404);
  return { ok: true };
}
