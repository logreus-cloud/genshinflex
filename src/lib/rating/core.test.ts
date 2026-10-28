import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregate, buildOverall, classifyTeam, consensusScore, consVariants, elementFromRu, fitsAbyssHalf, fitsTheater, PRYDWEN_SCORE, rankTeams, reactionLabel, scoreRole, simUrl, supportStrength, swapPairs, TIERS, tierOf, WOTPACK_SCORE, type OverallRow, type RatingData, type RatingExternal, type RatingManual, type TeamRow } from './core.ts';

test('classifyTeam распределяет роли по долям', () => {
  const members = [
    { slug: 'a', dps: 45, fieldTime: 50 }, { slug: 'b', dps: 20, fieldTime: 20 },
    { slug: 'c', dps: 5, fieldTime: 10 },
  ];
  assert.deepEqual(classifyTeam(members, 100), { a: 'carry', b: 'subdps', c: 'support' });
  assert.deepEqual(classifyTeam([{ slug: 'a', dps: 40, fieldTime: 10 }, { slug: 'b', dps: 40, fieldTime: 20 }], 100), { a: 'subdps', b: 'carry' });
  assert.deepEqual(classifyTeam(members, 0), { a: 'support', b: 'support', c: 'support' });
  assert.deepEqual(classifyTeam([{ slug: 'a', dps: 30, fieldTime: 20 }, { slug: 'b', dps: 20, fieldTime: 10 }], 100), { a: 'subdps', b: 'subdps' });
  // Запускает цветение вне поля: большая доля урона, но не керри
  assert.deepEqual(classifyTeam([{ slug: 'xq', dps: 60, fieldTime: 5 }, { slug: 'n', dps: 20, fieldTime: 80 }], 100), { xq: 'subdps', n: 'subdps' });
});

test('aggregate берёт два лучших значения', () => {
  assert.equal(aggregate([]), null);
  assert.equal(aggregate([7]), 7);
  assert.equal(aggregate([2, 10, 8]), 9);
});

test('swapPairs сравнивает замены при одинаковых напарниках и числе целей', () => {
  const teams: TeamRow[] = [
    { id: 'a', m: ['x', 'y', 'z', 'a'], dps: 200, targets: 1 },
    { id: 'b', m: ['b', 'z', 'x', 'y'], dps: 100, targets: 1 },
    { id: 'two', m: ['x', 'y', 'z', 'c'], dps: 50, targets: 2 },
    { id: 'zero', m: ['x', 'y', 'z', 'd'], dps: 0, targets: 1 },
  ];
  const pairs = swapPairs(teams, new Set(['a', 'b', 'c', 'd']));
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a, 'a');
  assert.equal(pairs[0].b, 'b');
  assert.equal(pairs[0].r, Math.log(2));
  assert.deepEqual(swapPairs(teams, new Set(['a'])), []);
});

test('supportStrength ослабляет одну пару и сохраняет транзитивность', () => {
  const r = Math.log(2);
  const two = supportStrength([{ a: 'a', b: 'b', r }]);
  assert.equal(two.a.n, 1);
  assert.equal(two.b.n, 1);
  assert.ok(two.a.s - two.b.s > 0);
  assert.ok(two.a.s - two.b.s < r);
  const three = supportStrength([{ a: 'a', b: 'b', r }, { a: 'b', b: 'c', r }]);
  assert.ok(three.a.s > three.b.s);
  assert.ok(three.b.s > three.c.s);
  assert.ok(three.a.s > three.c.s);
  assert.deepEqual(supportStrength([]), {});
});

test('tierOf соблюдает границы', () => {
  assert.deepEqual(TIERS, ['T0', 'T0.5', 'T1', 'T1.5', 'T2', 'T3', 'T4']);
  assert.deepEqual(
    [95, 94, 88, 87, 80, 79, 70, 69, 55, 54, 40, 39].map(tierOf),
    ['T0', 'T0.5', 'T0.5', 'T1', 'T1', 'T1.5', 'T1.5', 'T2', 'T2', 'T3', 'T3', 'T4'],
  );
});

test('scoreRole пересчитывает баллы и места', () => {
  assert.deepEqual(scoreRole([]), []);
  assert.deepEqual(scoreRole([{ value: 5 }]).map(({ score, rank }) => [score, rank]), [[100, 1]]);
  const rows = scoreRole([{ value: 80 }, { value: 100 }, { value: 100 }]);
  assert.deepEqual(rows.map(({ score, rank }) => [score, rank]), [[100, 1], [100, 1], [80, 3]]);
  assert.deepEqual(scoreRole([{ value: 0 }, { value: 0 }]).map(({ score, rank }) => [score, rank]), [[0, 1], [0, 1]]);
});

test('buildOverall добавляет экспертов, заменяет симуляцию и строит сустейн', () => {
  const generated: RatingData = {
    _meta: { date: '2026-10-27', source: 'https://db.kqm.gg', entries: 2, baseline: 2, teams: 2, shares: 2, pairs: 0, own: 0 },
    characters: {
      a: { carry: { value: 100, n: 2, best: { id: 'sim-a', team: ['a', 'b'] } } },
      b: { carry: { value: 50, n: 1, best: { id: 'sim-b', team: ['a', 'b'] } } },
    },
    teams: [],
  };
  const manual: RatingManual = {
    characters: {
      a: { patch: '7.1', sources: [{ title: 'Guide', url: 'https://example.com/a' }], roles: [{ role: 'carry', score: 90, override: true }] },
      c: { patch: '7.1', sources: [{ title: 'Guide', url: 'https://example.com/c' }], roles: [{ role: 'carry', score: 80 }] },
    },
    sustain: { d: { level: 'plenty', kind: 'heal' } },
  };
  const overall = buildOverall(generated, manual);
  assert.deepEqual(overall.carry.map(({ slug, score, rank, kind }) => [slug, score, rank, kind]), [
    ['a', 90, 1, 'expert'], ['c', 80, 2, 'expert'], ['b', 50, 3, 'sim'],
  ]);
  assert.equal(overall.carry[2].source?.url, simUrl('sim-b'));
  assert.equal(overall.carry[0].value, null);
  assert.deepEqual(overall.sustain.map(({ slug, score, kind }) => [slug, score, kind]), [['d', 90, 'expert']]);
});

test('консенсус смешивается с симуляцией и баллы нормируются к новому лидеру', () => {
  const generated: RatingData = {
    _meta: { date: '', source: '', entries: 0, baseline: 0, teams: 0, shares: 0, pairs: 0, own: 0 },
    characters: {
      a: { carry: { value: 100, n: 1, best: { id: 'a', team: ['a'] } } },
      b: { carry: { value: 80, n: 1, best: { id: 'b', team: ['b'] } } },
    },
    teams: [],
  };
  const manual: RatingManual = { characters: {}, sustain: {} };
  const external: RatingExternal = {
    _meta: { date: '', sources: {
      prydwen: { title: 'Prydwen', url: 'https://example.com/prydwen' },
      wotpack: { title: 'WotPack', url: 'https://example.com/wotpack' },
    } },
    prydwen: { a: { carry: 'T3' }, b: { carry: 'T0' } }, wotpack: {}, teams: {},
  };
  assert.equal(PRYDWEN_SCORE['T0.5'], 93);
  assert.equal(WOTPACK_SCORE['S+'], 95);
  const rows = buildOverall(generated, manual, external).carry;
  assert.deepEqual(rows.map(({ slug, score, rank }) => [slug, score, rank]), [['b', 100, 1], ['a', 95, 2]]);
  assert.equal(rows[0].simScore, 80);
  assert.equal(rows[0].consensus?.score, 100);
  assert.equal(rows[1].simScore, 100);
  assert.deepEqual(buildOverall(generated, manual).carry.map(({ slug, score }) => [slug, score]), [['a', 100], ['b', 80]]);
});

test('Prydwen учитывается только в своей роли, WotPack — в любой, а новые роли добавляются', () => {
  const generated: RatingData = {
    _meta: { date: '', source: '', entries: 0, baseline: 0, teams: 0, shares: 0, pairs: 0, own: 0 },
    characters: {},
    teams: [],
  };
  const manual: RatingManual = {
    characters: { a: { patch: '', sources: [], roles: [{ role: 'carry', score: 92 }] } },
    sustain: {},
  };
  const external: RatingExternal = {
    _meta: { date: '', sources: {
      prydwen: { title: 'Prydwen', url: 'https://example.com/prydwen' },
      wotpack: { title: 'WotPack', url: 'https://example.com/wotpack' },
    } },
    prydwen: { a: { support: 'T0' }, vesna: { support: 'T1' } },
    wotpack: { a: 'S+' },
    teams: { vesna: { members: ['vesna', 'a', 'b', 'c'], title: 'Vesna team', url: 'https://example.com/vesna' } },
  };
  assert.deepEqual(consensusScore('a', 'carry', external, manual)?.parts.map(({ source }) => source), ['wotpack', 'manual']);
  assert.deepEqual(consensusScore('a', 'support', external, manual)?.parts.map(({ source }) => source), ['prydwen', 'wotpack']);
  const rows = buildOverall(generated, manual, external);
  assert.equal(rows.carry[0].consensus?.score, 93.5);
  assert.equal(rows.support.find((row) => row.slug === 'vesna')?.kind, 'expert');
  assert.deepEqual(rows.support.find((row) => row.slug === 'vesna')?.team, ['vesna', 'a', 'b', 'c']);
  assert.equal(rows.support.find((row) => row.slug === 'vesna')?.teamSource?.url, 'https://example.com/vesna');
  assert.deepEqual(rows.sustain, []);
});

test('consVariants пересчитывает созвездия и сохраняет исходный C0', () => {
  const rows: OverallRow[] = [
    { slug: 'a', role: 'carry', value: 100, score: 100, tier: 'T0', rank: 1, kind: 'sim' },
    { slug: 'b', role: 'carry', value: 80, score: 80, tier: 'T1', rank: 2, kind: 'sim' },
    { slug: 'c', role: 'carry', value: 80, score: 80, tier: 'T1', rank: 2, kind: 'sim' },
  ];
  const variants = consVariants(rows, (slug, level, weapon) => slug === 'b' && level === 1 && !weapon ? 50 : null);
  assert.deepEqual(rows.map((row) => variants.get(row.slug)![0]), rows.map(({ score, tier, rank }) => ({ score, tier, rank, gain: null })));
  assert.deepEqual(variants.get('b')![1], { score: 100, tier: 'T0', rank: 1, gain: 50 });
  assert.deepEqual(variants.get('a')![1], { score: 83, tier: 'T1', rank: 2, gain: null });
  assert.deepEqual(variants.get('c')![1], { score: 67, tier: 'T2', rank: 3, gain: null });
  assert.deepEqual(rows.map((row) => variants.get(row.slug)![2].rank), [1, 2, 2]);
  assert.deepEqual(rows.map(({ score, tier, rank }) => [score, tier, rank]), [[100, 'T0', 1], [80, 'T1', 2], [80, 'T1', 2]]);
});

test('consVariants перемножает приросты в C2 с оружием и пересчитывает места', () => {
  const rows: OverallRow[] = [
    { slug: 'a', role: 'carry', value: 100, score: 100, tier: 'T0', rank: 1, kind: 'sim' },
    { slug: 'b', role: 'carry', value: 80, score: 80, tier: 'T1', rank: 2, kind: 'sim' },
    { slug: 'c', role: 'carry', value: 80, score: 80, tier: 'T1', rank: 2, kind: 'sim' },
  ];
  const variants = consVariants(rows, (slug, level, weapon) => {
    if (slug !== 'b') return null;
    const cons = level === 2 ? 20 : 0;
    const weaponGain = weapon ? 30 : 0;
    return cons || weaponGain ? ((1 + cons / 100) * (1 + weaponGain / 100) - 1) * 100 : null;
  });
  assert.equal(Math.round(variants.get('b')!['2w'].gain!), 56);
  assert.deepEqual(['a', 'b', 'c'].map((slug) => [variants.get(slug)!['2w'].score, variants.get(slug)!['2w'].rank]), [
    [80, 2], [100, 1], [64, 3],
  ]);
});

test('consVariants на C0 с оружием учитывает только доступный прирост оружия', () => {
  const rows: OverallRow[] = [
    { slug: 'a', role: 'carry', value: 100, score: 100, tier: 'T0', rank: 1, kind: 'sim' },
    { slug: 'b', role: 'carry', value: 80, score: 80, tier: 'T1', rank: 2, kind: 'sim' },
    { slug: 'c', role: 'carry', value: 80, score: 80, tier: 'T1', rank: 2, kind: 'sim' },
  ];
  const variants = consVariants(rows, (slug, _level, weapon) => slug === 'b' && weapon ? 30 : null);
  assert.deepEqual(rows.map((row) => variants.get(row.slug)![0].rank), [1, 2, 2]);
  assert.equal(variants.get('b')!['0w'].gain, 30);
  assert.equal(variants.get('a')!['0w'].gain, null);
  assert.equal(variants.get('c')!['0w'].gain, null);
  assert.deepEqual(rows.map((row) => [variants.get(row.slug)!['0w'].score, variants.get(row.slug)!['0w'].rank]), [
    [96, 2], [100, 1], [77, 3],
  ]);
});

test('фильтры ротации и русские стихии', () => {
  assert.equal(fitsAbyssHalf(['pyro', 'hydro'], [['pyro', 'cryo'], ['hydro']]), true);
  assert.equal(fitsAbyssHalf(['pyro'], [['hydro']]), false);
  assert.equal(fitsAbyssHalf([], []), true);
  assert.equal(fitsTheater([{ slug: 'a', element: 'pyro' }, { slug: 'b', element: 'geo' }], ['pyro'], ['b']), true);
  assert.equal(fitsTheater([{ slug: 'b', element: 'geo' }], ['pyro'], []), false);
  assert.equal(elementFromRu('  пИрО  '), 'pyro');
  assert.equal(elementFromRu('другое'), null);
});

test('rankTeams фильтрует и ранжирует команды', () => {
  const teams: TeamRow[] = [
    { id: 'a', m: [], dps: 10, targets: 1 }, { id: 'b', m: [], dps: 20, targets: 1 },
    { id: 'c', m: [], dps: 30, targets: 1 },
  ];
  assert.deepEqual(rankTeams(teams, (team) => team.id !== 'c', 1).map(({ id, score, rank }) => [id, score, rank]), [['b', 100, 1]]);
});

test('reactionLabel переводит реакцию и подбирает моно стихию', () => {
  assert.equal(reactionLabel('swirl-pyro', ['pyro']), 'Рассеивание');
  assert.equal(reactionLabel('unknown', ['hydro', 'pyro', 'hydro']), 'Моно Гидро');
  assert.equal(reactionLabel(undefined, ['pyro', 'hydro']), 'Моно Пиро');
  assert.equal(reactionLabel(undefined, ['pyro', 'hydro', 'hydro', 'pyro']), 'Моно Пиро');
  assert.equal(reactionLabel('constructor', ['pyro']), 'Моно Пиро');
  assert.equal(reactionLabel('__proto__', ['pyro']), 'Моно Пиро');
});

test('simUrl строит ссылку на запись базы', () => {
  assert.equal(simUrl('abc'), 'https://gcsim.app/db/abc');
  assert.equal(simUrl('own:odette'), 'https://github.com/logreus-cloud/genshinflex/blob/main/scripts/sim-teams/odette.txt');
  assert.equal(simUrl('own:team#1'), 'https://github.com/logreus-cloud/genshinflex/blob/main/scripts/sim-teams/team%231.txt');
});
