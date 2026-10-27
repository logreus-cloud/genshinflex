import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregate, buildOverall, classifyTeam, elementFromRu, fitsAbyssHalf, fitsTheater, rankTeams, reactionLabel, scoreRole, simUrl, supportStrength, swapPairs, tierOf, type RatingData, type RatingManual, type TeamRow } from './core.ts';

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
  assert.equal(tierOf(85), 'S');
  assert.equal(tierOf(70), 'A');
  assert.equal(tierOf(50), 'B');
  assert.equal(tierOf(49), 'C');
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
