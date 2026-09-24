// Run the actual page script with a minimal DOM and mocked network/storage.
// This checks event/state behavior; it does not replace visual browser testing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/pages/[...locale]/tools/team-check.astro', import.meta.url), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;\s*$/gm, '');
const js = stripTypeScriptTypes(script);
const newTranslations = readFileSync(new URL('./i18n/ui-part9.py', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((line) => line.startsWith('('))
  .map((line) => JSON.parse(`[${line.slice(1, -2)}]`));

class Element {
  value = ''; innerHTML = ''; textContent = ''; hidden = false; dataset = {};
  listeners = new Map(); attributes = new Map();
  classList = { toggle() {} };
  addEventListener(type, callback) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }
  async emit(type, target = this) {
    for (const callback of this.listeners.get(type) ?? []) await callback({ target });
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  hasAttribute(name) { return this.attributes.has(name); }
  closest(selector) { return selector === 'button' || (selector === '#editor' && this.inEditor) ? this : null; }
  scrollIntoView() {}
  querySelector() { return new Element(); }
}

for (const lang of ['ru', 'en', 'es']) {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const document = new Element();
  document.getElementById = node;
  document.querySelector = node;
  node('picker').hidden = true;
  const saved = new Map();
  const dict = lang === 'ru' ? {} : JSON.parse(readFileSync(new URL(`../src/i18n/ui.${lang}.json`, import.meta.url), 'utf8'));
  if (lang !== 'ru') {
    const placeholders = (text) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
    for (const [ru, en, es] of newTranslations) {
      assert.equal(dict[ru], lang === 'en' ? en : es, `${lang}: translation source matches dictionary`);
      assert.deepEqual(placeholders(dict[ru]), placeholders(ru));
    }
    for (const [, key] of source.matchAll(/\bt\('([^'\\]*)'/g)) {
      if (/[А-Яа-яЁё]/.test(key)) assert.ok(dict[key], `${lang}: missing translation: ${key}`);
    }
  }
  const t = (key, vars = {}) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
  const characters = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((n, i) => ({
    id: i + 1, s: n.toLowerCase(), n, el: i % 2 ? 'hydro' : 'pyro', w: 'sword', r: 5, i: '/test.png', base: { 90: [10000, 250, 600] },
  }));
  const fixture = { characters, weapons: [], artifacts: [], abyss: { halves: [1, 2].map((half) => ({
    half, label: 'Test', need: [['pyro']], tip: '', teams: [{ name: 'Test team', members: characters.slice(0, 4).map((c) => c.s) }],
  })) } };
  const context = vm.createContext({
    document, LANG: lang, BASE: lang === 'ru' ? '' : `/${lang}`, t,
    store: { get: (key, fallback) => saved.get(key) ?? fallback, set: (key, value) => saved.set(key, structuredClone(value)) },
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (url) => ({ ok: true, json: async () => url.includes('/api/enka/')
      ? { avatarInfoList: [{ avatarId: 1, propMap: { 4001: { val: 80 } }, fightPropMap: {} }] }
      : fixture }),
  });
  await new vm.Script(`(async () => { ${js}\n })()`).runInContext(context);
  const click = async (dataset) => {
    const button = new Element(); button.dataset = dataset;
    await document.emit('click', button);
  };
  const roster = () => saved.get('gf:roster');
  const teams = () => saved.get('gf:abyss-teams');

  await node('open-picker').emit('click');
  assert.equal(node('picker').hidden, false);
  node('picker-search').value = 'AlPh';
  await node('picker-search').emit('input');
  assert.match(node('picker-grid').innerHTML, /Alpha/);
  assert.doesNotMatch(node('picker-grid').innerHTML, /Beta/);
  node('picker-search').value = '';
  await click({ filterEl: 'hydro' });
  assert.match(node('picker-grid').innerHTML, /Beta/);
  assert.doesNotMatch(node('picker-grid').innerHTML, /Alpha/);
  await click({ filterEl: 'hydro' });

  // Manual addition opens the editor, including translated talent labels.
  node('add-char').value = 'Alpha';
  await node('add-char').emit('change');
  assert.equal(roster().length, 1);
  assert.match(node('editor').innerHTML, new RegExp(t('Уровень таланта {n}', { n: 1 })));
  const alphaKey = roster()[0].key;
  await click({ toHalf: '1', key: alphaKey });
  await node('check').emit('click');
  assert.match(node('result').innerHTML, /Alpha/);
  const resultBeforeEdit = node('result').innerHTML;
  const input = new Element(); input.inEditor = true; input.dataset.f = 'level'; input.value = '40';
  await document.emit('input', input);
  assert.notEqual(node('result').innerHTML, resultBeforeEdit);

  // Reimporting a selected character must preserve the team and editor identity.
  node('uid').value = '700000000';
  await node('load-uid').emit('click');
  assert.equal(roster()[0].level, 80);
  assert.equal(roster()[0].key, alphaKey);
  assert.deepEqual(teams()[1], [alphaKey]);
  assert.match(node('editor').innerHTML, /data-f="level" value="80"/);
  assert.match(node('result').innerHTML, /Alpha/);

  for (const c of characters.slice(1)) await click({ pick: c.s });
  await click({ takeHalf: '1', takeTeam: '0' });
  assert.equal(teams()[1].length, 4);
  const fifth = roster().find((e) => e.s === 'epsilon').key;
  await click({ toHalf: '1', key: fifth });
  assert.equal(teams()[1].length, 4);
  await click({ toHalf: '2', key: alphaKey });
  assert.ok(!teams()[1].includes(alphaKey));
  assert.deepEqual(teams()[2], [alphaKey]);
  await click({ clearHalf: '2' });
  assert.equal(teams()[2].length, 0);
  await node('reset-teams').emit('click');
  assert.equal(teams()[1].length + teams()[2].length, 0);
  assert.equal(node('result').innerHTML, '');
  assert.equal(roster().length, 5);
  await node('autofill').emit('click');
  assert.equal(new Set([...teams()[1], ...teams()[2]]).size, 5);
  await click({ pick: 'alpha' });
  assert.ok(!roster().some((e) => e.s === 'alpha'));
  assert.ok(![...teams()[1], ...teams()[2]].includes(alphaKey));
  await node('clear-roster').emit('click');
  assert.equal(roster().length, 4);
  await node('clear-roster').emit('click');
  assert.equal(roster().length, 0);
  assert.equal(teams()[1].length + teams()[2].length, 0);
  assert.equal(node('result').innerHTML, '');
  console.log(`${lang}: picker, editor, live result, UID refresh, teams and reset passed`);
}
