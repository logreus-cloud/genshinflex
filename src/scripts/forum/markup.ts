const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[char]!);

const token = /`[^`\n]*`|\[[^\]\n]+\]\(https?:\/\/[^\s<>"')]+\)|https?:\/\/[^\s<>"')]+|(?<![\p{L}\p{N}_@/])@[\p{L}\p{N}_-]{3,24}|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\|\|[^|\n]+\|\||\*[^*\n]+\*|_[^_\n]+_/gu;

function inline(text: string, base: string): string {
  let result = '';
  let from = 0;
  for (const match of text.matchAll(token)) {
    const value = match[0];
    const at = match.index;
    result += escapeHtml(text.slice(from, at));
    if (value.startsWith('`')) {
      result += `<code>${escapeHtml(value.slice(1, -1))}</code>`;
    } else if (value.startsWith('[')) {
      const end = value.indexOf('](');
      const href = value.slice(end + 2, -1);
      result += `<a href="${escapeHtml(href)}" rel="nofollow ugc noopener noreferrer" target="_blank">${escapeHtml(value.slice(1, end))}</a>`;
    } else if (/^https?:\/\//.test(value)) {
      result += `<a href="${escapeHtml(value)}" rel="nofollow ugc noopener noreferrer" target="_blank">${escapeHtml(value)}</a>`;
    } else if (value.startsWith('@')) {
      const nick = value.slice(1);
      result += `<a class="mention" href="${base}/u/${encodeURIComponent(nick)}/">@${escapeHtml(nick)}</a>`;
    } else if (value.startsWith('**')) {
      result += `<strong>${inline(value.slice(2, -2), base)}</strong>`;
    } else if (value.startsWith('~~')) {
      result += `<s>${inline(value.slice(2, -2), base)}</s>`;
    } else if (value.startsWith('||')) {
      result += `<span class="spoiler" tabindex="0" role="button">${inline(value.slice(2, -2), base)}</span>`;
    } else {
      result += `<em>${inline(value.slice(1, -1), base)}</em>`;
    }
    from = at + value.length;
  }
  return result + escapeHtml(text.slice(from));
}

export function renderMarkup(text: string, base = ''): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const parts: string[] = [];
  const paragraph: string[] = [];
  const list: string[] = [];
  const quote: string[] = [];
  let listTag = '';

  function flush() {
    if (paragraph.length) parts.push(`<p>${paragraph.map((line) => inline(line, base)).join('<br>')}</p>`);
    if (list.length) parts.push(`<${listTag}>${list.map((line) => `<li>${inline(line, base)}</li>`).join('')}</${listTag}>`);
    if (quote.length) parts.push(`<blockquote>${quote.map((line) => inline(line, base)).join('<br>')}</blockquote>`);
    paragraph.length = 0;
    list.length = 0;
    quote.length = 0;
    listTag = '';
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('```')) {
      flush();
      const code: string[] = [];
      while (++index < lines.length && !lines[index].startsWith('```')) code.push(lines[index]);
      parts.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('> ')) {
      if (paragraph.length || list.length) flush();
      quote.push(line.slice(2));
      continue;
    }
    const bullet = /^[-*] (.*)$/.exec(line);
    const numbered = /^\d+\. (.*)$/.exec(line);
    if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      if (paragraph.length || quote.length || (listTag && listTag !== tag)) flush();
      listTag = tag;
      list.push((bullet || numbered)![1]);
      continue;
    }
    if (list.length || quote.length) flush();
    paragraph.push(line);
  }
  flush();
  return parts.join('');
}

export const plainSnippet = (text: string, max: number) => text
  .replace(/\|\|[\s\S]*?\|\|/g, '[спойлер]')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
  .replace(/(?:^|\n)[>*-] ?/g, ' ')
  .replace(/(?:^|\n)\d+\. /g, ' ')
  .replace(/[*_~`]/g, '')
  .replace(/<[^>]*>/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, Math.max(0, max));
