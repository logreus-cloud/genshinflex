import { currentUser, getSupabase } from '../auth';
import { BASE, t } from '../search';
import { renderAuthor } from '../forum/author';
import { mapErrorText, mapRpc } from './api';
import { MARKER_TYPES } from './markers';

type PendingMarker = {
  id: number;
  layer: string;
  type: string;
  x: number;
  y: number;
  title: string | null;
  note: string | null;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
};

function button(label: string) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'btn small';
  node.textContent = label;
  return node;
}

export async function initMapModeration(root: HTMLElement, signal: AbortSignal) {
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const list = root.querySelector<HTMLElement>('[data-list]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more]')!;
  const user = await currentUser();
  if (signal.aborted) return;
  if (!user) {
    status.textContent = t('Доступно только модераторам.');
    return;
  }
  try {
    const { data, error } = await getSupabase().rpc('map_is_moderator');
    if (error) throw error;
    if (signal.aborted) return;
    if (!data) {
      status.textContent = t('Доступно только модераторам.');
      return;
    }
  } catch (error) {
    status.textContent = mapErrorText(error);
    return;
  }

  let before: number | null = null;
  let loading = false;
  const load = async (reset = false) => {
    if (loading) return;
    loading = true;
    more.disabled = true;
    if (reset) {
      before = null;
      list.replaceChildren();
    }
    try {
      const rows = await mapRpc<PendingMarker[]>('map_pending_markers', { p_limit: 50, p_before: before });
      if (signal.aborted) return;
      const authors = rows.map(row => row.author_id).filter((id): id is string => !!id);
      const nicknames = new Map<string, string>();
      if (authors.length) {
        const { data } = await getSupabase().from('profiles').select('id,nickname').in('id', authors);
        for (const profile of data ?? []) nicknames.set(profile.id, profile.nickname);
      }
      if (signal.aborted) return;
      status.textContent = '';
      for (const row of rows) {
        const type = MARKER_TYPES.find(type => type.id === row.type);
        const card = document.createElement('article');
        card.className = 'panel forum-report';
        const heading = document.createElement('strong');
        heading.textContent = row.title || (type ? t(type.label) : row.type);
        const detail = document.createElement('p');
        detail.className = 'small muted';
        const swatch = document.createElement('span');
        swatch.className = 'map-marker-swatch';
        swatch.style.backgroundColor = type?.color ?? '#8793a3';
        detail.append(swatch, ` ${type ? t(type.label) : row.type} · ${row.x}, ${row.y} · ${new Date(row.created_at).toLocaleString()}`);
        card.append(heading, detail);
        if (row.note) {
          const note = document.createElement('p');
          note.className = 'map-marker-note';
          note.textContent = row.note;
          card.append(note);
        }
        const nickname = row.author_id && nicknames.get(row.author_id);
        if (row.author_id && nickname) {
          card.append(renderAuthor({
            id: row.author_id, nickname, name: row.author_name || nickname,
            public: true, custom: null, moderator: false,
          }, BASE));
        } else {
          const author = document.createElement('p');
          author.textContent = `${t('Автор')}: ${row.author_name || t('Удалённый пользователь')}`;
          card.append(author);
        }
        const actions = document.createElement('div');
        actions.className = 'forum-actions';
        const open = document.createElement('a');
        open.className = 'btn small';
        open.href = `${BASE}/map/?marker=${row.id}`;
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        open.textContent = t('Открыть на карте');
        actions.append(open);
        const run = (label: string, name: string, args: Record<string, unknown>) => {
          const control = button(t(label));
          control.addEventListener('click', async () => {
            for (const item of actions.querySelectorAll<HTMLButtonElement>('button')) item.disabled = true;
            try {
              await mapRpc<void>(name, args);
              card.remove();
              if (!list.children.length) status.textContent = t('Пока пусто');
            } catch (error) {
              status.textContent = mapErrorText(error);
              for (const item of actions.querySelectorAll<HTMLButtonElement>('button')) item.disabled = false;
            }
          }, { signal });
          actions.append(control);
        };
        run('Одобрить', 'map_review_marker', { p_id: row.id, p_status: 'approved' });
        run('Отклонить', 'map_review_marker', { p_id: row.id, p_status: 'rejected' });
        run('Удалить метку', 'map_delete_marker', { p_id: row.id });
        card.append(actions);
        list.append(card);
      }
      if (!rows.length && !list.children.length) status.textContent = t('Пока пусто');
      before = rows.at(-1)?.id ?? before;
      more.hidden = rows.length < 50;
    } catch (error) {
      if (!signal.aborted) status.textContent = mapErrorText(error);
    } finally {
      loading = false;
      more.disabled = false;
    }
  };
  more.addEventListener('click', () => void load(), { signal });
  void load(true);
}
