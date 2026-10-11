import type { SupabaseClient } from '@supabase/supabase-js';

type AdminClient = {
  from: SupabaseClient['from'];
  rpc: SupabaseClient['rpc'];
  auth: { admin: Pick<SupabaseClient['auth']['admin'], 'getUserById' | 'createUser' | 'generateLink' | 'listUsers' | 'updateUserById'> };
};

type TelegramUser = {
  id: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
};

async function linkedUser(client: AdminClient, telegramId: string) {
  const { data, error } = await client.from('telegram_accounts')
    .select('user_id').eq('telegram_id', telegramId).maybeSingle();
  if (error) throw error;
  return data?.user_id as string | undefined;
}

async function linkedTelegram(client: AdminClient, userId: string) {
  const { data, error } = await client.from('telegram_accounts')
    .select('telegram_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ? String(data.telegram_id) : undefined;
}

async function userByEmail(client: AdminClient, email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((entry) => entry.email === email);
    if (user) return user;
    if (data.users.length < 1000) return undefined;
  }
}

function emailConflict(error: { code?: string; message?: string }) {
  return error.code === 'email_exists' || error.code === 'user_already_exists'
    || error.message === 'User already registered'
    || error.message === 'A user with this email address has already been registered';
}

function accountConflict(code?: string) {
  return Object.assign(new Error('Account conflict'), { status: 409, ...(code ? { code } : {}) });
}

// Привязка Telegram к уже существующему аккаунту: дальше вход через Telegram выдаёт ссылку на его почту
export async function linkTelegram(client: AdminClient, userId: string, telegram: TelegramUser) {
  const { data, error } = await client.rpc('telegram_link', {
    p_user: userId, p_telegram: telegram.id, p_username: telegram.username || null,
  });
  if (error) throw error;
  if (data === 'telegram_taken' || data === 'telegram_already_linked') throw accountConflict(data);
  if (data !== 'ok') throw new Error('Telegram link failed');
}

export async function unlinkTelegram(client: AdminClient, userId: string) {
  const { data, error } = await client.rpc('telegram_unlink', { p_user: userId });
  if (error) throw error;
  if (data === 'last_method') throw accountConflict(data);
  if (data !== 'ok') throw new Error('Telegram unlink failed');
}

export async function telegramLogin(client: AdminClient, telegram: TelegramUser, lang?: string) {
  const email = `tg${telegram.id}@telegram.genshinflex.com`;
  let userId = await linkedUser(client, telegram.id);

  if (!userId) {
    const displayName = [telegram.first_name, telegram.last_name].filter(Boolean).join(' ').trim();
    const input = {
      email,
      email_confirm: true,
      user_metadata: {
        lang: lang === 'en' || lang === 'es' ? lang : 'ru',
        display_name: displayName,
        telegram_username: telegram.username,
        avatar_url: telegram.photo_url,
      },
      app_metadata: { telegram_id: telegram.id },
    };
    const { data, error } = await client.auth.admin.createUser(input);
    if (error) {
      if (!emailConflict(error)) throw error;
      userId = await linkedUser(client, telegram.id);
      if (!userId) {
        const existing = await userByEmail(client, email);
        if (!existing) throw accountConflict();
        if (String(existing.app_metadata?.telegram_id) === telegram.id) {
          userId = existing.id;
        } else {
          if (existing.app_metadata?.telegram_id || await linkedTelegram(client, existing.id)) throw accountConflict();
          const { error: updateError } = await client.auth.admin.updateUserById(existing.id, {
            email: `tg${telegram.id}-${Date.now()}@telegram.genshinflex.com`, email_confirm: true,
          });
          if (updateError) throw updateError;
          const { data: retry, error: retryError } = await client.auth.admin.createUser(input);
          if (retryError) throw retryError;
          userId = retry.user?.id;
        }
      }
    } else {
      userId = data.user?.id;
    }
    if (!userId) throw new Error('Telegram user missing');
    const { error: insertError } = await client.from('telegram_accounts')
      .insert({ telegram_id: telegram.id, user_id: userId, username: telegram.username || null });
    if (insertError) {
      if (insertError.code !== '23505') throw insertError;
      const linked = await linkedUser(client, telegram.id);
      if (!linked) throw insertError;
      userId = linked;
    }
  }

  const { data: userData, error: userError } = await client.auth.admin.getUserById(userId);
  if (userError || !userData.user?.email) throw userError || new Error('Telegram email missing');
  if (String(userData.user.app_metadata?.telegram_id) !== telegram.id) throw accountConflict();

  const { error: updateError } = await client.from('telegram_accounts')
    .update({ username: telegram.username || null, updated_at: new Date().toISOString() })
    .eq('telegram_id', telegram.id);
  if (updateError) throw updateError;

  const { data: link, error: linkError } = await client.auth.admin.generateLink({
    type: 'magiclink',
    email: userData.user.email,
  });
  if (linkError || !link.properties?.hashed_token) throw linkError || new Error('Telegram token missing');
  // Почта могла перейти к другому аккаунту, пока шёл вход: ссылку на чужой аккаунт не отдаём
  if (link.user?.id !== userId) throw accountConflict();
  return link.properties.hashed_token;
}
