// Превращает одобренную заявку из редактора гайдов в файл билда: npm run guide:md -- <id> [--dry] [--local]
// --dry — только показать получившийся файл, ничего не записывая (так удобно читать заявку перед решением)
// Русский гайд: пишет src/content/builds/<персонаж>.md (старый файл перезаписывается — смотрите разницу в git).
// Английский/испанский: текст идёт в src/content/builds-i18n/<язык>/<персонаж>.md, автор — в подпись билда,
// а оружие, сеты и команды выводятся для ручного переноса: заметки и статы в билде хранятся по-русски.
// После записи заявка помечается одобренной.
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

const id = Number(process.argv[2]);
if (!Number.isInteger(id)) { console.error('Укажите номер заявки: npm run guide:md -- 12'); process.exit(1); }
const where = process.argv.includes('--local') ? '--local' : '--remote';
// SQL без кавычек внутри — поэтому его можно целиком взять в двойные кавычки для оболочки
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute genshinflex-feedback ${where} --json --command "${sql}"`, { encoding: 'utf8' }))[0].results;

const [row] = d1(`SELECT * FROM guide_submissions WHERE id = ${id}`);
if (!row) { console.error(`Заявка ${id} не найдена`); process.exit(1); }
const g = JSON.parse(row.payload);
const file = `src/content/builds/${g.character}.md`;
// Источники и видео из старого билда сохраняем — редактор их не трогает
const old = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
const keep = (key) => old.match(new RegExp(`^${key}:\n(?:  .*\n)+`, 'm'))?.[0] ?? '';
const oldAuthors = [...(old.match(/^authors: (\[.*\])$/m)?.[1] ? JSON.parse(old.match(/^authors: (\[.*\])$/m)[1]) : [])];

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
  writeFileSync(file, md);
  console.log(`Готово: ${file} (автор — ${row.author}). Проверьте разницу и запустите npm run build.`);
} else {
  if (!old) { console.error(`Русского билда ${file} ещё нет — сначала создайте его, перевод без билда не показывается.`); process.exit(1); }
  mkdirSync(`src/content/builds-i18n/${lang}`, { recursive: true });
  writeFileSync(i18nFile, `---\n---\n\n${g.body.trim()}\n`);
  const authors = `authors: ${JSON.stringify([...new Set([...oldAuthors, row.author])])}`;
  writeFileSync(file, /^authors: .*$/m.test(old) ? old.replace(/^authors: .*$/m, authors) : old.replace(/\n---\n/, `\n${authors}\n---\n`));
  console.log(`Готово: ${i18nFile} (автор — ${row.author}). Оружие, сеты и команды из заявки сравните с билдом вручную: npm run guide:md -- ${id} --dry`);
}
d1(`UPDATE guide_submissions SET status = 'approved' WHERE id = ${id}`);
