type Span = { _type: string; text?: string; marks?: string[] };
type Mark = { _key: string; _type: string; href?: string };
type Block = {
  _type: string;
  style?: string;
  listItem?: string;
  level?: number;
  children?: Span[];
  markDefs?: Mark[];
};

const escapeText = (text: string) => text.replace(/([\\`*_[\]<>])/g, '\\$1');

function spanToMarkdown(span: Span, defs: Mark[]): string {
  // Перенос внутри абзаца — «\n» в тексте блока; оставляем как есть: renderGuide на сайте сам делает из него <br>
  let text = escapeText(span.text ?? '');
  for (const mark of span.marks ?? []) {
    if (mark === 'strong') text = `**${text}**`;
    else if (mark === 'em') text = `*${text}*`;
    else if (mark === 'code') text = `\`${(span.text ?? '').replace(/`/g, '\\`')}\``;
    else {
      const definition = defs.find((item) => item._key === mark);
      if (!definition || definition._type !== 'link' || !definition.href) {
        throw new Error(`Неизвестная пометка Portable Text: ${mark}`);
      }
      text = `[${text}](${definition.href})`;
    }
  }
  return text;
}

export function portableTextToMarkdown(blocks: Block[] = []): string {
  const lines: string[] = [];
  let previousList = false;
  for (const block of blocks) {
    if (block._type !== 'block' && block._type !== 'bodyBlock') {
      throw new Error(`Неподдерживаемый блок Portable Text: ${block._type}`);
    }
    const content = (block.children ?? []).map((span) => spanToMarkdown(span, block.markDefs ?? [])).join('');
    if (block.listItem) {
      const level = Math.max(1, block.level ?? 1);
      if (!previousList && lines.length) lines.push('');
      lines.push(`${'  '.repeat(level - 1)}${block.listItem === 'number' ? '1.' : '-'} ${content}`);
      previousList = true;
      continue;
    }
    if (lines.length) lines.push('');
    if (block.style === 'h2') lines.push(`## ${content}`);
    else if (block.style === 'h3') lines.push(`### ${content}`);
    else if (block.style === 'h4') lines.push(`#### ${content}`);
    else if (block.style === 'blockquote') lines.push(content.split('\n').map((line) => `> ${line}`).join('\n'));
    else if (!block.style || block.style === 'normal') lines.push(content);
    else throw new Error(`Неподдерживаемый стиль Portable Text: ${block.style}`);
    previousList = false;
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}
