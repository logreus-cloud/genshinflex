import { getCollection } from 'astro:content';
import { useData } from '../../lib/data';

export async function GET() {
  const { characters, weapons, artifacts } = useData(undefined);
  const characterBySlug = new Map(characters.map((item) => [item.slug, item]));
  const weaponBySlug = new Map(weapons.map((item) => [item.slug, item.name]));
  const artifactBySlug = new Map(artifacts.map((item) => [item.slug, item.name]));

  const builds = (await getCollection('builds')).flatMap(({ data }) => {
    const character = characterBySlug.get(data.character);
    if (!character) return [];
    return [{
      s: character.slug, n: character.name, e: character.nameEn, el: character.element, r: character.rarity,
      i: new URL(character.icon, 'https://genshinflex.com').href,
      role: data.role, patch: data.patch, updated: data.updated.toISOString().slice(0, 10),
      weapons: data.weapons?.map(({ slug, note }) => ({ n: weaponBySlug.get(slug) ?? slug, ...(note ? { note } : {}) })),
      artifacts: data.artifacts?.map(({ sets, note }) => ({ n: sets.map((slug) => artifactBySlug.get(slug) ?? slug).join(' + '), ...(note ? { note } : {}) })),
      mainStats: data.mainStats,
      substats: data.substats,
      teams: data.teams?.map(({ name, members }) => ({ name, members: members.map((slug) => characterBySlug.get(slug)?.name ?? slug) })),
      url: `/characters/${character.slug}/`,
    }];
  }).sort((a, b) => a.n.localeCompare(b.n, 'ru'));

  return new Response(JSON.stringify({ builds }), { headers: { 'Content-Type': 'application/json' } });
}
