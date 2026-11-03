import { getCollection } from 'astro:content';
import { useData, LANGS } from './data';
import { STANDARD_CHARACTERS } from '../data/standard-banner';

export async function discordBuilds(locale?: string) {
  const { lang, base, characters, weapons, artifacts, t, stat } = useData(locale);
  const characterBySlug = new Map(characters.map((item) => [item.slug, item]));
  const weaponBySlug = new Map(weapons.map((item) => [item.slug, item.name]));
  const artifactBySlug = new Map(artifacts.map((item) => [item.slug, item.name]));

  const builds = (await getCollection('builds')).flatMap(({ data }) => {
    const character = characterBySlug.get(data.character);
    if (!character) return [];
    return [{
      s: character.slug, n: character.name, e: character.nameEn, el: character.element, r: character.rarity,
      i: new URL(character.icon, 'https://genshinflex.com').href,
      role: t(data.role), patch: data.patch, updated: data.updated.toISOString().slice(0, 10),
      weapons: data.weapons?.map(({ slug, note }) => ({ n: weaponBySlug.get(slug) ?? slug, ...(note ? { note: t(note) } : {}) })),
      artifacts: data.artifacts?.map(({ sets, note }) => ({ n: sets.map((slug) => artifactBySlug.get(slug) ?? slug).join(' + '), ...(note ? { note: t(note) } : {}) })),
      mainStats: {
        sands: stat(data.mainStats.sands), goblet: stat(data.mainStats.goblet), circlet: stat(data.mainStats.circlet),
      },
      substats: data.substats.map(stat),
      teams: data.teams?.map(({ name, members }) => ({ name: name ? t(name) : '', members: members.map((slug) => characterBySlug.get(slug)?.name ?? slug) })),
      url: `${base}/characters/${character.slug}/`,
    }];
  }).sort((a, b) => a.n.localeCompare(b.n, lang));

  return new Response(JSON.stringify({ builds }), { headers: { 'Content-Type': 'application/json' } });
}

export async function discordBanners(locale?: string) {
  const { characters, weapons } = useData(locale);
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
