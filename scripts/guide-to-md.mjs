// Превращает одобренную заявку из редактора гайдов в файл билда: npm run guide:md -- <id> [--dry] [--local]
// --dry — только показать получившийся файл, ничего не записывая (так удобно читать заявку перед решением)
// Русский гайд: пишет src/content/builds/<персонаж>.md (старый файл перезаписывается — смотрите разницу в git).
// Английский/испанский: текст идёт в src/content/builds-i18n/<язык>/<персонаж>.md, автор — в подпись билда,
// а оружие, сеты и команды выводятся для ручного переноса: заметки и статы в билде хранятся по-русски.
// После записи заявка помечается одобренной.
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import YAML from 'yaml';
import { store } from './cms/store.mjs';

const id = Number(process.argv[2]);
if (!Number.isInteger(id)) { console.error('Укажите номер заявки: npm run guide:md -- 12'); process.exit(1); }
const where = process.argv.includes('--local') ? '--local' : '--remote';
// SQL без кавычек внутри — поэтому его можно целиком взять в двойные кавычки для оболочки
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute genshinflex-feedback ${where} --json --command "${sql}"`, { encoding: 'utf8' }))[0].results;

const [row] = d1(`SELECT * FROM guide_submissions WHERE id = ${id}`);
if (!row) { console.error(`Заявка ${id} не найдена`); process.exit(1); }
const g = JSON.parse(row.payload);

// Гайды на оружие и эндгейм — отдельные файлы на языке заявки:
// src/content/weapon-guides/<язык>/<слаг>.md и src/content/endgame-guides/<язык>/<abyss-12 | theater | onslaught>.md
if (g.kind === 'weapon' || g.kind === 'endgame') {
  const lang = g.lang ?? 'ru';
  const dir = `src/content/${g.kind === 'weapon' ? 'weapon-guides' : 'endgame-guides'}/${lang}`;
  const path = `${dir}/${g.target}.md`;
  const collection = g.kind === 'weapon' ? 'weaponGuides' : 'endgameGuides';
  const contentId = `${lang}/${g.target}`;
  const previous = await store.readEntry(collection, contentId);
  const prevAuthors = previous ? matter(previous.text, { engines: { yaml: (source) => YAML.parse(source) } }).data.authors ?? [] : [];
  const qq = (s) => JSON.stringify(s ?? '');
  const head = [
    '---',
    ...(g.kind === 'endgame' ? [`cycle: ${qq(g.cycle)}`] : []),
    `updated: ${new Date().toISOString().slice(0, 10)}`,
    `authors: ${JSON.stringify([...new Set([...prevAuthors, row.author])])}`,
    ...(g.kind === 'endgame' && g.teams?.length ? ['teams:', ...g.teams.flatMap((t) => [`  - name: ${qq(t.name || 'Команда')}`, `    members: [${t.members.join(', ')}]`, ...(t.note ? [`    note: ${qq(t.note)}`] : [])])] : []),
    ...(g.external?.length ? ['external:', ...g.external.flatMap((x) => [`  - title: ${qq(x.title)}`, `    url: ${x.url}`, ...(x.author ? [`    author: ${qq(x.author)}`] : []), `    lang: ${x.lang}`])] : []),
    '---',
  ].join('\n');
  const text = `${head}\n\n${g.body.trim()}\n`;
  if (process.argv.includes('--dry')) {
    console.log(`# заявка ${id} · ${g.kind} ${g.target} · ${lang} · ${row.author} · ${row.contact ?? 'без контакта'} · ${row.status}`);
    if (row.comment) console.log(`# комментарий: ${row.comment}`);
    console.log(`# → ${path}\n${text}`);
    process.exit(0);
  }
  if (g.kind === 'endgame' && g.teams?.some((t) => t.members.length !== 4)) { console.error('В команде не 4 участника — поправьте заявку вручную (--dry покажет файл)'); process.exit(1); }
  await store.writeEntry(collection, contentId, text, { ifRevision: previous?.rev, mustNotExist: !previous });
  d1(`UPDATE guide_submissions SET status = 'approved' WHERE id = ${id}`);
  console.log(store.mode === 'sanity' ? `Готово: записано в Sanity (${contentId}) — сайт пересоберётся сам` : `Готово: записано в файл ${path} (автор — ${row.author}). Проверьте и запустите npm run build.`);
  process.exit(0);
}

const file = `src/content/builds/${g.character}.md`;
// Источники и видео из старого билда сохраняем — редактор их не трогает
const previous = await store.readEntry('builds', g.character);
const old = previous?.text.replace(/\r\n/g, '\n') ?? '';
const oldParsed = old ? matter(old, { engines: { yaml: (source) => YAML.parse(source) } }) : null;
const oldData = oldParsed?.data ?? {};
const keep = (key) => store.mode === 'sanity'
  ? oldData[key]?.length ? YAML.stringify({ [key]: oldData[key] }) : ''
  : old.match(new RegExp(`^${key}:\n(?:  .*\n)+`, 'm'))?.[0] ?? '';
const oldAuthors = oldData.authors ?? [];

const q = (s) => JSON.stringify(s ?? '');
const lines = [
  '---',
  `character: ${g.character}`,
  `role: ${q(g.role || 'ДД')}`,
  `updated: ${new Date().toISOString().slice(0, 10)}`,
  `patch: ${q(g.patch || '7.1')}`,
  'weapons:', ...g.weapons.flatMap((w) => [`  - slug: ${w.slug}`, ...(w.note ? [`    note: ${q(w.note)}`] : [])]),
  'artifacts:', ...g.artifacts.flatMap((a) => [`  - sets: [${a.sets.join(', ')}]`, ...(a.note ? [`    note: ${q(a.note)}`] : [])]),
  'mainStats:', ...['sands', 'goblet', 'circlet'].map((k) => `  ${k}: ${q(g.mainStats[k] || 'Любой')}`),
  `substats: [${g.substats.map(q).join(', ')}]`,
  ...(g.talents.length ? [`talents: [${g.talents.join(', ')}]`] : []),
  'teams:', ...g.teams.flatMap((t) => [`  - name: ${q(t.name || 'Команда')}`, `    members: [${t.members.join(', ')}]`, ...(t.note ? [`    note: ${q(t.note)}`] : [])]),
  `authors: ${JSON.stringify([...new Set([...oldAuthors, row.author])])}`,
  ...(g.external?.length ? ['external:', ...g.external.flatMap((x) => [`  - title: ${q(x.title)}`, `    url: ${x.url}`, ...(x.author ? [`    author: ${q(x.author)}`] : []), `    lang: ${x.lang}`])] : []),
].join('\n');
const lang = g.lang ?? 'ru';
const md = `${lines}\n${keep('sources')}${keep('videos')}${g.external?.length ? '' : keep('external')}---\n\n${g.body}\n`;
const i18nFile = `src/content/builds-i18n/${lang}/${g.character}.md`;
if (process.argv.includes('--dry')) {
  console.log(`# заявка ${id} · ${lang} · ${row.mode === 'edit' ? 'правка' : 'новый гайд'} · ${row.author} · ${row.contact ?? 'без контакта'} · ${row.status}`);
  if (row.comment) console.log(`# комментарий: ${row.comment}`);
  console.log(lang === 'ru' ? md : `# текст → ${i18nFile}\n${g.body}\n\n# билд (перенести вручную, по-русски):\n${lines}`);
  process.exit(0);
}
if (lang === 'ru') {
  await store.writeEntry('builds', g.character, md, { ifRevision: previous?.rev, mustNotExist: !previous });
  console.log(store.mode === 'sanity' ? `Готово: записано в Sanity (${g.character}) — сайт пересоберётся сам` : `Готово: записано в файл ${file} (автор — ${row.author}). Проверьте разницу и запустите npm run build.`);
} else {
  if (!old) { console.error(`Русского билда ${file} ещё нет — сначала создайте его, перевод без билда не показывается.`); process.exit(1); }
  const translation = await store.readEntry('buildsI18n', `${lang}/${g.character}`);
  await store.writeEntry('buildsI18n', `${lang}/${g.character}`, `---\n---\n\n${g.body.trim()}\n`, { ifRevision: translation?.rev, mustNotExist: !translation });
  const authors = `authors: ${JSON.stringify([...new Set([...oldAuthors, row.author])])}`;
  const updated = store.mode === 'sanity'
    ? `---\n${YAML.stringify({ ...oldData, authors: [...new Set([...oldAuthors, row.author])] })}---\n${oldParsed.content}`
    : /^authors: .*$/m.test(old) ? old.replace(/^authors: .*$/m, authors) : old.replace(/\n---\n/, `\n${authors}\n---\n`);
  await store.writeEntry('builds', g.character, updated, { ifRevision: previous?.rev });
  console.log(store.mode === 'sanity' ? `Готово: записано в Sanity (${lang}/${g.character}) — сайт пересоберётся сам` : `Готово: записано в файл ${i18nFile} (автор — ${row.author}). Оружие, сеты и команды из заявки сравните с билдом вручную: npm run guide:md -- ${id} --dry`);
}
d1(`UPDATE guide_submissions SET status = 'approved' WHERE id = ${id}`);
