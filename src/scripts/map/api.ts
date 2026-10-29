import { t } from '../search';

export async function mapRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { getSupabase } = await import('../auth');
  const { data, error } = await getSupabase().rpc(name, args as never);
  if (error) throw error;
  return data as T;
}

export function mapErrorText(error: unknown) {
  const message = (error as { message?: string })?.message ?? '';
  const mapCode = /map:([a-z_]+)/.exec(message)?.[1];
  const forumCode = /forum:([a-z_]+)/.exec(message)?.[1];
  if (forumCode === 'auth_required') return t('Войдите в аккаунт');
  if (forumCode === 'banned') return t('Вы заблокированы на форуме');
  if (mapCode === 'invalid') return t('Проверьте данные метки.');
  if (mapCode === 'rate_limited') return t('Слишком много предложений, попробуйте позже.');
  if (mapCode === 'too_many_pending') return t('У вас слишком много меток на проверке.');
  if (mapCode === 'duplicate') return t('Такая метка здесь уже есть.');
  if (mapCode === 'not_found') return t('Метка не найдена.');
  if (mapCode === 'forbidden') return t('Недостаточно прав.');
  return t('Не удалось выполнить действие.');
}
