import type { SupabaseClient } from '@supabase/supabase-js';
import type { DiscordInteraction } from './discord.ts';

type TicketClient = Pick<SupabaseClient, 'rpc'>;
type OpenResult = { status: 'duplicate' | 'creating' | 'limit' }
  | { status: 'exists'; id: number; thread_id: string }
  | { status: 'created'; id: number };
type CloseResult = { status: 'missing' | 'closed' | 'closing' }
  | { status: 'claimed'; id: number; discord_id: string };

export type TicketDeps = {
  client(): TicketClient;
  fetchImpl: typeof fetch;
  waitUntil(promise: Promise<unknown>): void;
  findLinkedProfile(discordId: string, signal: AbortSignal): Promise<{ nickname: string; is_public: boolean } | null>;
  channelId?: string;
  botToken?: string;
  applicationId?: string;
  supportRoleIds: string[];
};

const API = 'https://discord.com/api/v10';
const ephemeral = (content: string) => ({ type: 4, data: { content, flags: 64 } });
const unavailable = ephemeral('Тикеты временно недоступны');
const failed = 'Не удалось создать тикет, попробуйте позже';

export function isTicketInteraction(interaction: DiscordInteraction): boolean {
  return (interaction.type === 2 && interaction.data?.name === 'тикет')
    || (interaction.type === 3 && (interaction.data?.custom_id === 'ticket:open'
      || /^ticket:close:\d+$/.test(interaction.data?.custom_id || '')))
    || (interaction.type === 5 && interaction.data?.custom_id === 'ticket:create');
}

async function discordRequest(
  deps: TicketDeps, path: string, method = 'GET', body?: unknown,
): Promise<Response> {
  const response = await deps.fetchImpl(`${API}${path}`, {
    method,
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bot ${deps.botToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Discord HTTP ${response.status}`);
  return response;
}

async function checkedRequest(deps: TicketDeps, path: string, method: string, body: unknown): Promise<Response> {
  const response = await discordRequest(deps, path, method, body);
  if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
  return response;
}

async function ticketRpc<T>(client: TicketClient, name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, params);
  if (error) throw error;
  return data as T;
}

async function archiveThread(deps: TicketDeps, threadId: string): Promise<boolean> {
  try {
    await checkedRequest(deps, `/channels/${threadId}`, 'PATCH', { archived: true, locked: true });
    return true;
  } catch {
    console.warn('discord ticket cleanup failed');
    return false;
  }
}

async function originalReply(deps: TicketDeps, interaction: DiscordInteraction, content: string): Promise<void> {
  await checkedRequest(deps,
    `/webhooks/${deps.applicationId}/${interaction.token}/messages/@original`, 'PATCH',
    { content, allowed_mentions: { parse: [] } });
}

async function createTicket(interaction: DiscordInteraction, deps: TicketDeps, discordId: string): Promise<void> {
  let content: string | undefined = failed;
  let ticketId: number | undefined;
  let threadId: string | undefined;
  let attached = false;
  let client: TicketClient | undefined;
  try {
    const subject = interaction.data?.components?.flatMap((row) => row.components || [])
      .find((field) => field.custom_id === 'subject')?.value?.trim();
    const details = interaction.data?.components?.flatMap((row) => row.components || [])
      .find((field) => field.custom_id === 'details')?.value?.trim();
    if (!subject || Array.from(subject).length > 80 || !details
      || Array.from(details).length < 10 || Array.from(details).length > 1500) {
      throw new Error('Неверная форма тикета');
    }
    if (!interaction.id) throw new Error('Нет ID взаимодействия');
    client = deps.client();
    for (let attempt = 0; attempt < 2; attempt++) {
      // Повтор после закрытия заархивированной ветки — та же отправка формы, а не новая доставка
      const opened = await ticketRpc<OpenResult>(client, 'discord_ticket_open', {
        p_discord_id: discordId, p_interaction_id: attempt ? `${interaction.id}:retry` : interaction.id,
      });
      if (opened.status === 'duplicate') {
        content = undefined;
        return;
      }
      if (opened.status === 'creating') {
        content = 'Тикет уже создаётся, подождите минуту';
        return;
      }
      if (opened.status === 'limit') {
        content = 'Слишком много тикетов за сутки, попробуйте завтра';
        return;
      }
      if (opened.status === 'created') {
        ticketId = opened.id;
        break;
      }
      if (opened.status !== 'exists') return;
      const response = await discordRequest(deps, `/channels/${opened.thread_id}`);
      const deleted = response.status === 404;
      const archived = deleted
        || ((await response.json()) as { thread_metadata?: { archived?: boolean } }).thread_metadata?.archived === true;
      if (!archived) {
        content = `У вас уже есть открытый тикет: <#${opened.thread_id}>`;
        return;
      }
      const token = crypto.randomUUID();
      const closing = await ticketRpc<CloseResult>(client, 'discord_ticket_close_begin', {
        p_thread_id: opened.thread_id, p_token: token,
      });
      if (closing.status === 'claimed' && closing.id !== opened.id) {
        await ticketRpc(client, 'discord_ticket_close_finish', {
          p_id: closing.id, p_ok: false, p_token: token,
        });
      } else if (closing.status === 'claimed') {
        try {
          // Автоархивация не блокирует ветку: без locked пользователь откроет её снова сообщением
          if (!deleted) {
            await checkedRequest(deps, `/channels/${opened.thread_id}`, 'PATCH', {
              archived: true, locked: true,
            });
          }
          await ticketRpc(client, 'discord_ticket_close_finish', {
            p_id: closing.id, p_ok: true, p_token: token,
          });
        } catch (error) {
          try {
            await ticketRpc(client, 'discord_ticket_close_finish', {
              p_id: closing.id, p_ok: false, p_token: token,
            });
          } catch {
            console.warn('discord ticket cleanup failed');
          }
          throw error;
        }
      }
    }
    if (ticketId === undefined) return;
    const number = String(ticketId).padStart(4, '0');
    const name = Array.from(`тикет-${number} · ${subject.replace(/\s+/g, ' ')}`).slice(0, 100).join('');
    const created = await checkedRequest(deps, `/channels/${deps.channelId}/threads`, 'POST', {
      name, type: 12, invitable: false, auto_archive_duration: 10080,
    });
    const thread = await created.json() as { id?: string };
    if (!thread.id || !/^[0-9]{5,25}$/.test(thread.id)) throw new Error('Неверная ветка Discord');
    threadId = thread.id;
    // Ветку записываем сразу: если дальше что-то упадёт, тикет останется видимым и закрываемым
    attached = await ticketRpc<boolean>(client, 'discord_ticket_attach', {
      p_id: ticketId, p_thread_id: threadId,
    });
    if (!attached) {
      const id = ticketId;
      ticketId = undefined;
      if (await archiveThread(deps, threadId)) {
        await ticketRpc(client, 'discord_ticket_abandon', { p_id: id }).catch(() => undefined);
      }
      content = 'Не удалось создать тикет, попробуйте ещё раз';
      return;
    }
    await checkedRequest(deps, `/channels/${threadId}/thread-members/${discordId}`, 'PUT', {});
    const linked = await deps.findLinkedProfile(discordId, AbortSignal.timeout(10_000));
    const account = linked
      ? linked.is_public
        ? `[@${linked.nickname}](https://genshinflex.com/u/${encodeURIComponent(linked.nickname)}/)`
        : `@${linked.nickname}`
      : 'не привязан';
    await checkedRequest(deps, `/channels/${threadId}/messages`, 'POST', {
      content: [`<@${discordId}>`, ...deps.supportRoleIds.map((id) => `<@&${id}>`)].join(' '),
      allowed_mentions: { users: [discordId], roles: deps.supportRoleIds },
      embeds: [{
        title: subject, description: details, color: 0xD3BC8E,
        fields: [{ name: 'Аккаунт GenshinFlex', value: account }],
        footer: { text: `Тикет #${number}` },
      }],
      components: [{ type: 1, components: [{
        type: 2, style: 4, label: 'Закрыть тикет', custom_id: `ticket:close:${ticketId}`,
      }] }],
    });
    content = `Тикет создан: <#${threadId}>`;
    ticketId = undefined;
  } catch (error) {
    console.warn('discord ticket create failed', String(error));
    // Запись удаляем только после подтверждённой очистки: иначе ветка осталась бы без учёта
    const cleaned = threadId ? await archiveThread(deps, threadId) : true;
    if (cleaned && ticketId !== undefined && client) {
      try {
        await ticketRpc(client, 'discord_ticket_abandon', { p_id: ticketId });
      } catch {
        console.warn('discord ticket cleanup failed');
      }
    }
  } finally {
    if (content !== undefined) {
      try {
        await originalReply(deps, interaction, content);
      } catch {
        console.warn('discord ticket reply failed');
      }
    }
  }
}

async function closeTicket(interaction: DiscordInteraction, deps: TicketDeps, discordId: string): Promise<void> {
  const id = Number(interaction.data?.custom_id?.slice('ticket:close:'.length));
  let content = 'Не удалось закрыть тикет, попробуйте ещё раз';
  let claimedId: number | undefined;
  const token = crypto.randomUUID();
  try {
    const client = deps.client();
    const result = await ticketRpc<CloseResult>(client, 'discord_ticket_close_begin', {
      p_thread_id: interaction.channel_id, p_token: token,
    });
    if (result.status === 'claimed') claimedId = result.id;
    if (!Number.isSafeInteger(id) || id < 1 || result.status === 'missing'
      || (result.status === 'claimed' && result.id !== id)) {
      if (claimedId !== undefined) {
        await ticketRpc(client, 'discord_ticket_close_finish', { p_id: claimedId, p_ok: false, p_token: token });
        claimedId = undefined;
      }
      content = 'Тикет не найден';
      return;
    }
    if (result.status === 'closed') { content = 'Тикет уже закрыт'; return; }
    if (result.status !== 'claimed') { content = 'Тикет уже закрывается'; return; }
    const roles = interaction.member?.roles || [];
    const support = roles.some((role) => deps.supportRoleIds.includes(role));
    const permissions = BigInt(interaction.member?.permissions || '0');
    if (result.discord_id !== discordId && !support && (permissions & (1n << 34n)) === 0n) {
      await ticketRpc(client, 'discord_ticket_close_finish', { p_id: result.id, p_ok: false, p_token: token });
      claimedId = undefined;
      content = 'Закрыть тикет может автор или поддержка';
      return;
    }
    await checkedRequest(deps, `/channels/${interaction.channel_id}/messages`, 'POST', {
      content: `Тикет закрыл <@${discordId}>. Если вопрос не решён — создайте новый.`,
      allowed_mentions: { parse: [] },
    });
    await checkedRequest(deps, `/channels/${interaction.channel_id}`, 'PATCH', {
      archived: true, locked: true,
    });
    await ticketRpc(client, 'discord_ticket_close_finish', { p_id: result.id, p_ok: true, p_token: token });
    claimedId = undefined;
    content = 'Тикет закрыт';
  } catch (error) {
    console.warn('discord ticket close failed', String(error));
    if (claimedId !== undefined) {
      try {
        await ticketRpc(deps.client(), 'discord_ticket_close_finish', { p_id: claimedId, p_ok: false, p_token: token });
      } catch {
        console.warn('discord ticket close failed');
      }
    }
  } finally {
    try {
      await originalReply(deps, interaction, content);
    } catch {
      console.warn('discord ticket reply failed');
    }
  }
}

export async function handleTicketInteraction(interaction: DiscordInteraction, deps?: TicketDeps) {
  if (!deps?.channelId || !deps.botToken || !deps.applicationId) return unavailable;
  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!discordId || !/^[0-9]{5,25}$/.test(discordId)) return unavailable;
  if (interaction.type === 2 || interaction.data?.custom_id === 'ticket:open') {
    return { type: 9, data: {
      custom_id: 'ticket:create', title: 'Новый тикет',
      components: [
        { type: 1, components: [{ type: 4, custom_id: 'subject', label: 'Тема',
          style: 1, required: true, max_length: 80 }] },
        { type: 1, components: [{ type: 4, custom_id: 'details', label: 'Что случилось',
          style: 2, required: true, min_length: 10, max_length: 1500,
          placeholder: 'Опишите проблему: что делали, что ожидали, что получилось. Ссылки и скриншоты можно добавить в ветке' }] },
      ],
    } };
  }
  if (interaction.type === 5) {
    if (!interaction.token) return unavailable;
    deps.waitUntil(new Promise<void>((resolve) => setTimeout(resolve, 0))
      .then(() => createTicket(interaction, deps, discordId)));
    return { type: 5, data: { flags: 64 } };
  }
  if (!interaction.token) return unavailable;
  deps.waitUntil(new Promise<void>((resolve) => setTimeout(resolve, 0))
    .then(() => closeTicket(interaction, deps, discordId)));
  return { type: 5, data: { flags: 64 } };
}
