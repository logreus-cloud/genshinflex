export interface DiscordEnv {
  DISCORD_WEBHOOK_TEAM?: string;
  DISCORD_WEBHOOK_BUGS?: string;
  DISCORD_WEBHOOK_IDEAS?: string;
  DISCORD_TAG_BUG?: string;
  DISCORD_TAG_DATA?: string;
  DISCORD_TAG_IDEA?: string;
  DISCORD_TAG_NEW?: string; // тег «Новый» форума #баги
}

type Message = { url: string; body: object };
const SITE = 'https://genshinflex.com';
const GOLD = 0xE3B04B;
const clip = (value: string, limit: number) => {
  const chars = Array.from(value);
  return chars.length <= limit ? value : `${chars.slice(0, limit - 1).join('')}…`;
};
const pageValue = (page: string | null) =>
  page ? page.startsWith('/') ? `${SITE}${page}` : page : 'Не указана';
const tags = (...ids: (string | undefined)[]) => ids.filter((id): id is string => Boolean(id));
const title = (label: string, id?: number) => `${label}${id == null ? '' : ` #${id}`}`;

export function feedbackMessages(
  env: DiscordEnv,
  item: { id?: number; kind: string; page: string | null; message: string },
): Message[] {
  const messages: Message[] = [];
  const kinds: Record<string, { name: string; color: number; thread: string }> = {
    bug: { name: 'Баг', color: 0xE05252, thread: 'Баг' },
    data: { name: 'Ошибка в данных', color: 0xE89848, thread: 'Ошибка в данных' },
    idea: { name: 'Идея', color: GOLD, thread: 'Идея' },
    other: { name: 'Другое', color: 0x888888, thread: '' },
  };
  const kind = kinds[item.kind] ?? kinds.other;
  const page = clip(pageValue(item.page), 1024);

  if (env.DISCORD_WEBHOOK_TEAM) messages.push({
    url: env.DISCORD_WEBHOOK_TEAM,
    body: {
      allowed_mentions: { parse: [] },
      embeds: [{
        title: clip(`Отзыв${item.id == null ? '' : ` #${item.id}`}: ${kind.name}`, 256),
        description: clip(item.message, 4096),
        color: kind.color,
        fields: [{ name: 'Страница', value: page }],
        footer: { text: 'Контакт — в админке' },
        url: `${SITE}/admin/`,
      }],
    },
  });

  const forum = item.kind === 'bug' || item.kind === 'data'
    ? env.DISCORD_WEBHOOK_BUGS
    : item.kind === 'idea' ? env.DISCORD_WEBHOOK_IDEAS : undefined;
  if (forum) {
    const tag = item.kind === 'bug' ? env.DISCORD_TAG_BUG
      : item.kind === 'data' ? env.DISCORD_TAG_DATA : env.DISCORD_TAG_IDEA;
    messages.push({
      url: forum,
      body: {
        thread_name: clip(`${kind.thread}: ${Array.from(item.message).slice(0, 60).join('')}`, 100),
        // id тегов у каждого форума свои: «Новый» (DISCORD_TAG_NEW) есть только в форуме багов
        applied_tags: item.kind === 'idea' ? tags(tag) : tags(env.DISCORD_TAG_NEW, tag),
        allowed_mentions: { parse: [] },
        embeds: [{
          description: clip(item.message, 4096),
          color: kind.color,
          fields: [{ name: 'Страница', value: page }],
          footer: { text: 'Отправлено через форму на сайте' },
        }],
      },
    });
  }
  return messages;
}

export function guideMessages(
  env: DiscordEnv,
  item: { id?: number; kind: string; target: string; mode: 'new' | 'edit'; author: string; comment: string | null; site: string },
): Message[] {
  if (!env.DISCORD_WEBHOOK_TEAM) return [];
  const kinds: Record<string, string> = { char: 'Персонаж', weapon: 'Оружие', endgame: 'Эндгейм' };
  const fields = [
    { name: 'Что', value: clip(`${kinds[item.kind] ?? item.kind}: ${item.target}`, 1024) },
    { name: 'Тип', value: item.mode === 'edit' ? 'Правка' : 'Новый' },
    { name: 'Автор', value: clip(item.author, 1024) },
  ];
  if (item.comment) fields.push({ name: 'Комментарий', value: clip(item.comment, 1024) });
  return [{
    url: env.DISCORD_WEBHOOK_TEAM,
    body: {
      allowed_mentions: { parse: [] },
      embeds: [{
        title: clip(title('Гайд на проверку', item.id), 256),
        color: GOLD,
        fields,
        url: `${item.site.replace(/\/$/, '')}/admin/`,
      }],
    },
  }];
}

export async function sendAll(messages: Message[]): Promise<void> {
  for (const message of messages) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(message.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Discord: HTTP ${response.status}`);
    } catch (error) {
      console.error('Не удалось отправить сообщение в Discord:', error);
    } finally {
      clearTimeout(timer);
    }
  }
}
