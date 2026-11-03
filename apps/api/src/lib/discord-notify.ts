import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lang } from './discord-i18n.ts';
import { notificationParts, type NotificationItem } from './telegram-notify.ts';

export type DiscordNotification = NotificationItem & { discord_id: string };

export function parseLangRoles(value?: string): Map<string, Lang> {
  const roles = new Map<string, Lang>();
  for (const entry of (value || '').split(',')) {
    const match = /^([0-9]{5,25}):(ru|en|es)$/.exec(entry.trim());
    if (match) roles.set(match[1], match[2] as Lang);
  }
  return roles;
}

const openLabels: Record<Lang, string> = {
  ru: 'Открыть на GenshinFlex', en: 'Open on GenshinFlex', es: 'Abrir en GenshinFlex',
};

class DiscordRateLimit extends Error {}

async function discordRequest(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
  body: unknown,
): Promise<Response> {
  let retried = false;
  while (true) {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status !== 429) return response;
    const data = await response.clone().json().catch(() => null) as { retry_after?: unknown } | null;
    const retryAfter = Number(data?.retry_after);
    if (!Number.isFinite(retryAfter) || retryAfter < 0 || retryAfter > 5) throw new DiscordRateLimit();
    if (retried) return response;
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    retried = true;
  }
}

async function memberLang(
  fetchImpl: typeof fetch,
  token: string,
  discordId: string,
  guildId?: string,
  langRoles?: Map<string, Lang>,
): Promise<Lang> {
  if (!guildId || !langRoles?.size) return 'ru';
  try {
    const response = await fetchImpl(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
      headers: { Authorization: `Bot ${token}` },
    });
    if (!response.ok) return 'ru';
    const member = await response.json() as { roles?: unknown };
    if (!Array.isArray(member.roles)) return 'ru';
    const langs = new Set(member.roles.map((role: unknown) =>
      typeof role === 'string' ? langRoles.get(role) : undefined));
    return langs.has('ru') ? 'ru' : langs.has('en') ? 'en' : langs.has('es') ? 'es' : 'ru';
  } catch {
    return 'ru';
  }
}

async function logFailure(id: number, response: Response): Promise<void> {
  const text = await response.text().catch(() => '');
  let code: unknown;
  try { code = (JSON.parse(text) as { code?: unknown }).code; } catch {}
  if (code === 50007 || code === 50278) console.warn('discord dm closed', id);
  else console.warn('discord send failed', id, response.status, text);
}

const permanentFailure = (response: Response) =>
  response.status >= 400 && response.status < 500 && response.status !== 429;

export async function deliverDiscordNotifications(
  client: Pick<SupabaseClient, 'rpc'>,
  botToken: string,
  fetchImpl: typeof fetch = fetch,
  options: { guildId?: string; langRoles?: Map<string, Lang> } = {},
): Promise<{ claimed: number; sent: number }> {
  if (!botToken) return { claimed: 0, sent: 0 };
  const { data, error } = await client.rpc('discord_notifications_claim', { p_limit: 50 });
  if (error) throw error;
  const items = (data ?? []) as DiscordNotification[];
  const channels = new Map<string, string>();
  const langs = new Map<string, Lang>();
  const ack: number[] = [];
  let sent = 0;
  for (const item of items) {
    try {
      let lang = langs.get(item.discord_id);
      if (!lang) {
        lang = await memberLang(fetchImpl, botToken, item.discord_id, options.guildId, options.langRoles);
        langs.set(item.discord_id, lang);
      }
      let channelId = channels.get(item.discord_id);
      if (!channelId) {
        const response = await discordRequest(fetchImpl, botToken, 'https://discord.com/api/v10/users/@me/channels', {
          recipient_id: item.discord_id,
        });
        if (!response.ok) {
          await logFailure(item.id, response);
          if (response.status === 401) break;
          if (permanentFailure(response)) ack.push(item.id);
          continue;
        }
        const channel = await response.json() as { id?: unknown };
        if (typeof channel.id !== 'string') throw new Error('Invalid Discord channel');
        channelId = channel.id;
        channels.set(item.discord_id, channelId);
      }
      const { heading, snippet, href } = notificationParts(item, undefined, lang);
      const response = await discordRequest(fetchImpl, botToken, `https://discord.com/api/v10/channels/${channelId}/messages`, {
        embeds: [{
          title: Array.from(heading).slice(0, 256).join(''),
          ...(snippet ? { description: snippet } : {}),
          url: href,
          color: 0xD3BC8E,
          footer: { text: 'GenshinFlex' },
        }],
        components: [{ type: 1, components: [{ type: 2, style: 5, label: openLabels[lang], url: href }] }],
        allowed_mentions: { parse: [] },
      });
      if (response.ok) {
        sent++;
        ack.push(item.id);
      } else {
        await logFailure(item.id, response);
        if (response.status === 401) break;
        if (permanentFailure(response)) ack.push(item.id);
      }
    } catch (error) {
      if (error instanceof DiscordRateLimit) break;
      console.warn('discord send failed', item.id, String(error));
    }
  }
  if (ack.length) {
    const { error: ackError } = await client.rpc('discord_notifications_ack', { p_ids: ack });
    if (ackError) throw ackError;
  }
  if (items.length) console.log('discord notifications', { claimed: items.length, sent });
  return { claimed: items.length, sent };
}
