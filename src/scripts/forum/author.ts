import { SUPABASE_URL } from '../../lib/platform';
import { usesMedia, validCustom } from '../profile-view';
import { t } from '../search';
import type { Author } from './api';

export function renderAuthor(author: Author, base: string): HTMLElement {
  const box = document.createElement('span');
  box.className = 'forum-author';
  if (!author) {
    box.textContent = t('Удалённый пользователь');
    return box;
  }

  const avatar = document.createElement('span');
  avatar.className = 'forum-avatar';
  avatar.textContent = author.name.charAt(0).toUpperCase();
  const custom = validCustom(author.custom, new Map()).value;
  const version = custom.media.avatar;
  if (usesMedia(custom, 'avatar') && version) {
    const img = document.createElement('img');
    img.src = `${SUPABASE_URL}/storage/v1/object/public/profile-media/${encodeURIComponent(author.id)}/avatar-${version}`;
    img.alt = '';
    img.width = 32;
    img.height = 32;
    avatar.replaceChildren(img);
  }

  box.append(avatar);
  if (author.guild) {
    const guild = document.createElement('a');
    guild.className = 'guild-tag';
    guild.href = `${base}/guilds/?g=${encodeURIComponent(author.guild.slug)}`;
    guild.title = author.guild.name;
    guild.textContent = `[${author.guild.tag}]`;
    box.append(guild, document.createTextNode(' '));
  }
  box.append(document.createTextNode(author.name + ' '));
  if (author.public && author.nickname) {
    const link = document.createElement('a');
    link.href = `${base}/u/${encodeURIComponent(author.nickname)}/`;
    link.textContent = `@${author.nickname}`;
    box.append(link);
  }
  if (author.moderator) {
    const badge = document.createElement('span');
    badge.className = 'small';
    badge.textContent = ` · ${t('Модератор')}`;
    box.append(badge);
  }
  return box;
}
