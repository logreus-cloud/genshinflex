import { fieldOrder } from '@genshinflex/content-model';
import matter from 'gray-matter';
import YAML from 'yaml';

const previousData = (text) => text ? matter(text, { engines: { yaml: (source) => YAML.parse(source) } }).data : {};
const authors = (old, author) => [...new Set([...(old.authors ?? []), author])];
const teams = (list) => list.map((t) => ({
  name: t.name || 'Команда', members: t.members, ...(t.note ? { note: t.note } : {}),
}));
const external = (list) => list.map((x) => ({
  title: x.title, url: x.url, ...(x.author ? { author: x.author } : {}), lang: x.lang,
}));

function renderFrontmatter(collection, data) {
  const order = fieldOrder(collection);
  const ordered = Object.fromEntries([
    ...order.filter((key) => key in data).map((key) => [key, data[key]]),
    ...Object.entries(data).filter(([key]) => !order.includes(key)),
  ]);
  // Без trimEnd: у последнего многострочного значения (блок «|+») хвостовые переводы строк значимы
  const yaml = Object.keys(ordered).length ? YAML.stringify(ordered) : '';
  return `---\n${yaml}---`;
}

function render(collection, data, body) {
  return `${renderFrontmatter(collection, data)}\n\n${body}\n`;
}

export function buildFromSubmission({ g, previousText, author, today }) {
  const old = previousData(previousText);
  const data = {
    ...old,
    character: g.character,
    role: g.role || 'ДД',
    updated: today,
    patch: g.patch || '7.1',
    weapons: g.weapons.map((w) => ({ slug: w.slug, ...(w.note ? { note: w.note } : {}) })),
    artifacts: g.artifacts.map((a) => ({ sets: a.sets, ...(a.note ? { note: a.note } : {}) })),
    mainStats: Object.fromEntries(['sands', 'goblet', 'circlet'].map((key) => [key, g.mainStats[key] || 'Любой'])),
    substats: g.substats,
    ...(g.talents.length ? { talents: g.talents } : {}),
    teams: teams(g.teams),
    authors: authors(old, author),
    ...(g.external?.length ? { external: external(g.external) } : {}),
  };
  return render('builds', data, g.body);
}

export function guideFromSubmission({ g, previousText, author, today }) {
  const old = previousData(previousText);
  const collection = g.kind === 'weapon' ? 'weaponGuides' : 'endgameGuides';
  const data = {
    ...old,
    ...(g.kind === 'endgame' ? { cycle: g.cycle } : {}),
    updated: today,
    authors: authors(old, author),
    ...(g.kind === 'endgame' && g.teams?.length ? { teams: teams(g.teams) } : {}),
    ...(g.external?.length ? { external: external(g.external) } : {}),
  };
  return render(collection, data, g.body.trim());
}

export function addAuthor({ previousText, author }) {
  const parsed = matter(previousText, { engines: { yaml: (source) => YAML.parse(source) } });
  // renderFrontmatter заканчивается на «---» без переноса; parsed.content начинается с пустой строки после него
  return `${renderFrontmatter('builds', { ...parsed.data, authors: authors(parsed.data, author) })}\n${parsed.content}`;
}
