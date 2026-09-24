import { getCollection } from 'astro:content';
import { characters, weapons, artifacts } from '../../lib/data';

// Данные для проверки команды: билды разобраны в машинные ключи статов
const STAT_KEYS: [RegExp, string][] = [
  [/Шанс \/ Крит\. урон/g, 'crit'], [/Шанс крит\. попадания/g, 'cr'], [/Крит\. урон/g, 'cd'],
  [/Сила атаки %/g, 'atk%'], [/Защита %/g, 'def%'], [/HP %/g, 'hp%'], [/Мастерство стихий/g, 'em'],
  [/Восст\. энергии/g, 'er'], [/Бонус лечения/g, 'heal'], [/Бонус физ\. урона/g, 'phys'], [/Бонус \S+ урона/g, 'dmg'],
];
const keys = (text: string) => {
  let t = text;
  for (const [re, k] of STAT_KEYS) t = t.replace(re, `#${k}#`);
  return [...t.matchAll(/#([a-z%]+)#/g)].map((m) => m[1]);
};
const roleClass = (role: string) => (/главный|^дд/i.test(role) ? 'dps' : /саб/i.test(role) ? 'sub' : 'support');

export async function GET() {
  const builds = new Map((await getCollection('builds')).map((b) => [b.data.character, b.data]));
  const abyss = (await getCollection('rotations')).find((r) => r.data.mode === 'abyss')?.data;
  const body = {
    characters: characters.map((c) => {
      const b = builds.get(c.slug);
      return {
        id: c.slug.startsWith('traveler-') ? null : c.id,
        s: c.slug, n: c.name, el: c.element, w: c.weapon, r: c.rarity, i: c.icon,
        base: Object.fromEntries(c.stats.map((p) => [p.level, [p.hp, p.atk, p.def]])),
        build: b && {
          role: b.role, cls: roleClass(b.role),
          weapons: b.weapons.map((w) => w.slug),
          sets: b.artifacts.map((a) => a.sets),
          main: { sands: keys(b.mainStats.sands), goblet: keys(b.mainStats.goblet), circlet: keys(b.mainStats.circlet) },
          subs: b.substats.flatMap(keys),
        },
      };
    }),
    weapons: weapons.map((w) => ({ id: w.id, s: w.slug, n: w.name, w: w.weapon, r: w.rarity, i: w.icon, atk: w.stats.at(-1)!.atk })),
    artifacts: artifacts.map((a) => ({ id: a.id, s: a.slug, n: a.name, i: a.icon })),
    abyss: abyss && {
      cycle: abyss.cycle, end: abyss.end,
      halves: abyss.halves.map((h) => ({
        ...h,
        teams: abyss.teams.filter((t) => t.name?.startsWith(`${h.half}-я половина`)).map((t) => ({ name: t.name, members: t.members })),
      })),
    },
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}
