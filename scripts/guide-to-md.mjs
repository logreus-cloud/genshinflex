// Превращает одобренную заявку из редактора гайдов в файл билда: npm run guide:md -- <id> [--dry] [--local]
// --dry — только показать получившийся файл, ничего не записывая (так удобно читать заявку перед решением)
// Русский гайд: пишет src/content/builds/<персонаж>.md (старый файл перезаписывается — смотрите разницу в git).
// Английский/испанский: текст идёт в src/content/builds-i18n/<язык>/<персонаж>.md, автор — в подпись билда,
// а оружие, сеты и команды выводятся для ручного переноса: заметки и статы в билде хранятся по-русски.
// После записи заявка помечается одобренной.
import { execSync } from 'node:child_process';
import { store } from './cms/store.mjs';
import { addAuthor, buildFromSubmission, guideFromSubmission } from './guides/submission.mjs';

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
  const text = guideFromSubmission({ g, previousText: previous?.text, author: row.author, today: new Date().toISOString().slice(0, 10) });
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
const previous = await store.readEntry('builds', g.character);
const old = previous?.text.replace(/\r\n/g, '\n') ?? '';
const lang = g.lang ?? 'ru';
const md = buildFromSubmission({ g, previousText: old, author: row.author, today: new Date().toISOString().slice(0, 10) });
const i18nFile = `src/content/builds-i18n/${lang}/${g.character}.md`;
if (process.argv.includes('--dry')) {
  console.log(`# заявка ${id} · ${lang} · ${row.mode === 'edit' ? 'правка' : 'новый гайд'} · ${row.author} · ${row.contact ?? 'без контакта'} · ${row.status}`);
  if (row.comment) console.log(`# комментарий: ${row.comment}`);
  console.log(lang === 'ru' ? md : `# текст → ${i18nFile}\n${g.body}\n\n# билд (перенести вручную, по-русски):\n${md.slice(0, md.indexOf('\n---\n') + 4)}`);
  process.exit(0);
}
if (lang === 'ru') {
  await store.writeEntry('builds', g.character, md, { ifRevision: previous?.rev, mustNotExist: !previous });
  console.log(store.mode === 'sanity' ? `Готово: записано в Sanity (${g.character}) — сайт пересоберётся сам` : `Готово: записано в файл ${file} (автор — ${row.author}). Проверьте разницу и запустите npm run build.`);
} else {
  if (!old) { console.error(`Русского билда ${file} ещё нет — сначала создайте его, перевод без билда не показывается.`); process.exit(1); }
  const translation = await store.readEntry('buildsI18n', `${lang}/${g.character}`);
  await store.writeEntry('buildsI18n', `${lang}/${g.character}`, `---\n---\n\n${g.body.trim()}\n`, { ifRevision: translation?.rev, mustNotExist: !translation });
  const updated = addAuthor({ previousText: old, author: row.author });
  await store.writeEntry('builds', g.character, updated, { ifRevision: previous?.rev });
  console.log(store.mode === 'sanity' ? `Готово: записано в Sanity (${lang}/${g.character}) — сайт пересоберётся сам` : `Готово: записано в файл ${i18nFile} (автор — ${row.author}). Оружие, сеты и команды из заявки сравните с билдом вручную: npm run guide:md -- ${id} --dry`);
}
d1(`UPDATE guide_submissions SET status = 'approved' WHERE id = ${id}`);
