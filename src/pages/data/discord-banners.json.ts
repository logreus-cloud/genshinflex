import { getCollection } from 'astro:content';
import { useData, LANGS } from '../../lib/data';
import { STANDARD_CHARACTERS } from '../../data/standard-banner';

// Баннеры и стандартный пул для Discord-бота: /баннеры и /гарант (apps/api/src/lib/discord-wishes.ts)
export async function GET() {
  const { characters, weapons } = useData(undefined);
  const characterBySlug = new Map(characters.map((item) => [item.slug, item]));
  const weaponBySlug = new Map(weapons.map((item) => [item.slug, item.name]));
  const nameOf = (slug: string) => characterBySlug.get(slug)?.name ?? slug;

  const banners = (await getCollection('banners')).map(({ data }) => ({
    version: data.version, phase: data.phase, start: data.start, end: data.end,
    featured: data.featured.map(({ slug, rerun }) => {
      const character = characterBySlug.get(slug);
      return {
        s: slug, n: character?.name ?? slug,
        ...(character?.element ? { el: character.element } : {}),
        ...(character?.icon ? { i: new URL(character.icon, 'https://genshinflex.com').href } : {}),
        rerun,
      };
    }),
    fourStars: data.fourStars.map(nameOf),
    weapons: data.weapons.map((slug) => weaponBySlug.get(slug) ?? slug),
  })).sort((a, b) => a.start.localeCompare(b.start));

  // Молитвы хранятся с именами на языке импорта, поэтому сверяем по ID и по именам на всех языках
  const sources = LANGS.map((lang) => new Map(useData(lang === 'ru' ? undefined : lang).characters.map((item) => [item.slug, item])));
  const standard = STANDARD_CHARACTERS.filter((slug) => characterBySlug.has(slug)).map((slug) => ({
    id: characterBySlug.get(slug)!.id ? String(characterBySlug.get(slug)!.id) : null,
    names: [...new Set(sources.map((source) => source.get(slug)?.name.toLowerCase()).filter((name): name is string => !!name))],
  }));

  return new Response(JSON.stringify({ banners, standard }), { headers: { 'Content-Type': 'application/json' } });
}
