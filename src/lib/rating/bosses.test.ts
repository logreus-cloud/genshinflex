import assert from 'node:assert/strict';
import test from 'node:test';
import { bossGroup, fitsBoss, mechanicTags, rankBossTeams, type Boss, type BossMember, type BossTag } from './bosses.ts';

const member = (overrides: Partial<BossMember> = {}): BossMember => ({
  slug: 'test', element: 'hydro', weapon: 'sword', carry: false, healer: false, mechanics: [], ...overrides,
});
const boss = (tags: BossTag[], extra: Partial<Boss> = {}): Boss => ({ en: 'Test', tags, verified: true, ...extra });

test('механики распознаются по тексту талантов без повторов', () => {
  assert.deepEqual(mechanicTags("Nightsoul's Blessing"), ['nightsoul']);
  assert.deepEqual(mechanicTags('Moonsign Moonsign Pneuma'), ['lunar', 'arkhe']);
  assert.deepEqual(mechanicTags('Stellaris Phantasm'), []);
});

test('группа босса — первый тег или одиночная цель', () => {
  assert.equal(bossGroup(boss(['heal', 'adds'])), 'heal');
  assert.equal(bossGroup(boss([])), 'single');
});

test('число целей зависит от тега adds', () => {
  assert.equal(fitsBoss(boss(['single']), [], 1), true);
  assert.equal(fitsBoss(boss(['single']), [], 2), false);
  assert.equal(fitsBoss(boss(['adds']), [], 1), false);
  assert.equal(fitsBoss(boss(['adds']), [], 2), true);
});

test('counter требует стихию из каждой группы', () => {
  const target = boss(['counter'], { need: [['hydro'], ['electro']] });
  assert.equal(fitsBoss(target, [member()], 1), false);
  assert.equal(fitsBoss(target, [member(), member({ element: 'electro' })], 1), true);
});

test('иммунитет исключает только керри нужной стихии', () => {
  const target = boss(['immune'], { immune: 'electro' });
  assert.equal(fitsBoss(target, [member({ element: 'electro', carry: true })], 1), false);
  assert.equal(fitsBoss(target, [member({ element: 'electro' })], 1), true);
});

test('для воздушного босса керри нужен лук или катализатор', () => {
  const target = boss(['airborne']);
  assert.equal(fitsBoss(target, [member({ carry: true })], 1), false);
  assert.equal(fitsBoss(target, [member({ carry: true, weapon: 'bow' })], 1), true);
  assert.equal(fitsBoss(target, [member()], 1), true);
});

test('лечение и лунная механика проверяются по участникам', () => {
  assert.equal(fitsBoss(boss(['heal']), [member()], 1), false);
  assert.equal(fitsBoss(boss(['heal']), [member({ healer: true })], 1), true);
  assert.equal(fitsBoss(boss(['lunar']), [member()], 1), false);
  assert.equal(fitsBoss(boss(['lunar']), [member({ mechanics: ['lunar'] })], 1), true);
});

test('лучшей подходящей команде даётся 100 баллов с ограничением списка', () => {
  const teams = [
    { id: 'low', m: ['test'], dps: 100, targets: 1 },
    { id: 'best', m: ['test'], dps: 300, targets: 1 },
    { id: 'middle', m: ['test'], dps: 200, targets: 1 },
  ];
  const rows = rankBossTeams(boss(['single']), teams, () => [member()], 2);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.id), ['best', 'middle']);
  assert.equal(rows[0].score, 100);
});
