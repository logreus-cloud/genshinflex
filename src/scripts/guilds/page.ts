import { pageLang } from '../../i18n/client';
import { renderAuthor } from '../forum/author';
import { forumMe } from '../forum/api';
import { BASE, t } from '../search';
import { hasSession, onSessionChange } from '../user-data/session';
import {
  guildCreate, guildError, guildGet, guildJoin, guildLeave, guildList, guildMembers, guildMine, guildModerateDelete,
  type Guild,
} from './api';

const guildHref = (slug: string) => `${BASE}/guilds/?g=${encodeURIComponent(slug)}`;
const date = (value: string) => new Date(value).toLocaleDateString(pageLang(), { day: 'numeric', month: 'short', year: 'numeric' });

async function signedIn() {
  if (!hasSession()) return false;
  const { getSupabase } = await import('../auth');
  const { data } = await getSupabase().auth.getSession();
  return !!data.session;
}

function guildCard(guild: Guild) {
  const card = document.createElement('a');
  card.className = 'panel guild-card';
  card.href = guildHref(guild.slug);
  const title = document.createElement('strong');
  title.textContent = `[${guild.tag}] ${guild.name}`;
  const meta = document.createElement('span');
  meta.className = 'small muted';
  meta.textContent = t('Участников: {n}', { n: guild.members });
  card.append(title, meta);
  if (guild.description) {
    const text = document.createElement('p');
    text.textContent = guild.description;
    card.append(text);
  }
  return card;
}

export async function initGuildList(root: HTMLElement, signal: AbortSignal) {
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const list = root.querySelector<HTMLElement>('[data-list]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more]')!;
  const mine = root.querySelector<HTMLElement>('[data-mine]')!;
  const form = root.querySelector<HTMLFormElement>('[data-create]')!;
  const formStatus = root.querySelector<HTMLElement>('[data-create-status]')!;
  let offset = 0;
  let generation = 0;
  let busy = false;

  const loadMore = async (turn: number) => {
    if (signal.aborted || turn !== generation || busy) return;
    busy = true;
    more.disabled = true;
    try {
      const rows = await guildList(31, offset);
      if (signal.aborted || turn !== generation) return;
      list.append(...rows.slice(0, 30).map(guildCard));
      offset += Math.min(rows.length, 30);
      more.hidden = rows.length <= 30;
      status.textContent = list.childElementCount ? '' : t('Гильдий пока нет. Создайте первую!');
    } catch {
      if (!signal.aborted && turn === generation) status.textContent = t('Не удалось загрузить');
    } finally {
      if (!signal.aborted && turn === generation) {
        busy = false;
        more.disabled = false;
      }
    }
  };

  const initialize = async () => {
    const turn = ++generation;
    busy = false;
    offset = 0;
    list.replaceChildren();
    mine.replaceChildren();
    form.hidden = true;
    void loadMore(turn);
    try {
      if (!await signedIn()) return;
      const slug = await guildMine();
      if (signal.aborted || turn !== generation) return;
      if (slug) {
        const link = document.createElement('a');
        link.className = 'btn';
        link.href = guildHref(slug);
        link.textContent = t('Моя гильдия');
        mine.append(link);
      } else {
        form.hidden = false;
      }
    } catch {}
  };

  more.addEventListener('click', () => void loadMore(generation), { signal });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    button.disabled = true;
    formStatus.textContent = '';
    try {
      const slug = await guildCreate(
        String(data.get('slug') ?? '').trim().toLowerCase(),
        String(data.get('name') ?? '').trim(),
        String(data.get('tag') ?? '').trim(),
        String(data.get('description') ?? '').trim(),
      );
      if (!signal.aborted) location.assign(guildHref(slug));
    } catch (error) {
      if (!signal.aborted) formStatus.textContent = guildError(error);
    } finally {
      button.disabled = false;
    }
  }, { signal });
  onSessionChange(() => { void initialize(); }, { signal });
  await initialize();
}

export async function initGuildPage(root: HTMLElement, slug: string, signal: AbortSignal) {
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const head = root.querySelector<HTMLElement>('[data-head]')!;
  const actions = root.querySelector<HTMLElement>('[data-actions]')!;
  const members = root.querySelector<HTMLElement>('[data-members]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-members-more]')!;
  let offset = 0;
  let generation = 0;
  let busy = false;

  const loadMembers = async (turn: number) => {
    if (signal.aborted || turn !== generation || busy) return;
    busy = true;
    more.disabled = true;
    try {
      const rows = await guildMembers(slug, 51, offset);
      if (signal.aborted || turn !== generation) return;
      for (const row of rows.slice(0, 50)) {
        const item = document.createElement('li');
        item.className = 'guild-member';
        const since = document.createElement('span');
        since.className = 'small muted';
        since.textContent = `${row.is_owner ? `${t('Владелец')} · ` : ''}${t('с {date}', { date: date(row.joined_at) })}`;
        item.append(renderAuthor(row.author, BASE), since);
        members.append(item);
      }
      offset += Math.min(rows.length, 50);
      more.hidden = rows.length <= 50;
    } catch {
      if (!signal.aborted && turn === generation) status.textContent = t('Не удалось загрузить');
    } finally {
      if (!signal.aborted && turn === generation) {
        busy = false;
        more.disabled = false;
      }
    }
  };

  const initialize = async () => {
    const turn = ++generation;
    busy = false;
    offset = 0;
    head.replaceChildren();
    actions.replaceChildren();
    members.replaceChildren();
    status.textContent = t('Загрузка...');
    try {
      const guild = await guildGet(slug);
      if (signal.aborted || turn !== generation) return;
      if (!guild) {
        status.textContent = t('Гильдия не найдена');
        return;
      }
      status.textContent = '';
      document.title = `[${guild.tag}] ${guild.name} — GenshinFlex`;
      const title = document.createElement('h1');
      title.textContent = `[${guild.tag}] ${guild.name}`;
      const meta = document.createElement('p');
      meta.className = 'small muted';
      meta.textContent = `${t('Участников: {n}', { n: guild.members })} · ${t('Создана {date}', { date: date(guild.created_at) })}`;
      head.append(title, meta);
      if (guild.description) {
        const text = document.createElement('p');
        text.className = 'guild-description';
        text.textContent = guild.description;
        head.append(text);
      }
      void loadMembers(turn);

      const button = (label: string, run: () => Promise<unknown>, primary = false) => {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = primary ? 'btn primary' : 'btn';
        node.textContent = label;
        node.addEventListener('click', async () => {
          if (signal.aborted || turn !== generation) return;
          for (const item of actions.querySelectorAll('button')) item.disabled = true;
          try {
            await run();
            if (!signal.aborted && turn === generation) await initialize();
          } catch (error) {
            if (!signal.aborted && turn === generation) {
              status.textContent = guildError(error);
              for (const item of actions.querySelectorAll('button')) item.disabled = false;
            }
          }
        }, { signal });
        actions.append(node);
      };
      const loggedIn = await signedIn();
      if (signal.aborted || turn !== generation) return;
      if (!loggedIn) {
        const { authUrl } = await import('../auth');
        if (signal.aborted || turn !== generation) return;
        const link = document.createElement('a');
        link.className = 'btn';
        link.href = authUrl(BASE, 'login', location.pathname + location.search);
        link.textContent = t('Войдите, чтобы вступить');
        actions.append(link);
        return;
      }
      if (guild.is_member) button(t('Выйти из гильдии'), guildLeave);
      else if (!guild.my_guild) button(t('Вступить'), () => guildJoin(slug), true);
      else {
        const note = document.createElement('span');
        note.className = 'small muted';
        note.textContent = t('Вы уже состоите в другой гильдии');
        actions.append(note);
      }
      const me = await forumMe().catch(() => null);
      if (signal.aborted || turn !== generation) return;
      if (me?.moderator) {
        button(t('Удалить гильдию'), async () => {
          await guildModerateDelete(slug);
          if (!signal.aborted) location.assign(`${BASE}/guilds/`);
        });
      }
    } catch (error) {
      if (!signal.aborted && turn === generation) status.textContent = guildError(error);
    }
  };

  more.addEventListener('click', () => void loadMembers(generation), { signal });
  onSessionChange(() => { void initialize(); }, { signal });
  await initialize();
}
