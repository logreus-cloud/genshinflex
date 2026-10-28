import assert from 'node:assert/strict';
import test from 'node:test';
import { explorationScore, explorationTags, passiveTags, rankExploration } from './exploration.ts';

test('пассивка Кадзухи снижает расход выносливости при беге', () => {
  assert.deepEqual(passiveTags('Decreases sprinting Stamina consumption for your own party members by 20%.'), ['sprint-stamina']);
});

test('пассивка отмечает местные диковинки на карте', () => {
  assert.deepEqual(passiveTags('Displays the location of nearby resources unique to Mondstadt on the mini-map.'), ['specialties']);
});

test('боевые пассивки не дают теги исследования', () => {
  assert.deepEqual(passiveTags('Increases the damage dealt by Normal Attacks by 20%.'), []);
  assert.deepEqual(passiveTags("Varesa's Sprint speed is increased. When she is not in combat, she gains an additional bonus."), []);
  assert.deepEqual(passiveTags('Increases Movement SPD while in an area with Phlogiston.'), []);
});

test('теги навыков и пассивок объединяются без повторов в заданном порядке', () => {
  const tags = explorationTags(
    [
      { description: 'Decreases sprinting Stamina consumption.' },
      { description: 'Displays local specialties on the mini-map.' },
    ],
    ['kit-water', 'kit-sprint', 'kit-water'],
  );
  assert.deepEqual(tags, ['kit-sprint', 'kit-water', 'sprint-stamina', 'specialties']);
  assert.equal(explorationScore(tags), 9);
});

test('рейтинг пропускает пустые строки и даёт лучшему 100 баллов', () => {
  const rows = rankExploration([
    { slug: 'empty', tags: [] },
    { slug: 'other', tags: ['ore'] },
    { slug: 'best', tags: ['kit-sprint', 'kit-water'] },
  ]);
  assert.deepEqual(rows.map(({ slug, score, rank, tier }) => [slug, score, rank, tier]), [
    ['best', 100, 1, 'T0'], ['other', 20, 2, 'T4'],
  ]);
});

test('сбор — только на расстоянии, дерево и рыбалка — удобство', () => {
  assert.deepEqual(passiveTags('Nahida can use All Schemes to Know to interact with some harvestable items within a fixed AoE.'), ['harvest']);
  assert.deepEqual(passiveTags('While in an area with Phlogiston Mechanics within Natlan, 15 Phlogiston will be restored when interacting with some harvestable items.'), []);
  assert.deepEqual(passiveTags('When a party member uses attacks to obtain wood from a tree, they have a 25% chance to get an additional log of wood.'), ['crafting']);
  assert.deepEqual(passiveTags('While in an area with Phlogiston Mechanics within Natlan, can use Nightsoul Transmission: Citlali.'), ['utility']);
});
