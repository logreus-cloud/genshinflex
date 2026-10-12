import { useData } from '../../lib/data';

export const prerender = true;

const LANGS = ['ru', 'en', 'es'] as const;

export function GET() {
  const names = new Map<string, Set<string>>();
  for (const lang of LANGS) {
    for (const character of useData(lang).characters) {
      const variants = names.get(character.slug) ?? new Set<string>();
      for (const name of [character.name, character.nameEn]) {
        if (name) variants.add(name);
      }
      names.set(character.slug, variants);
    }
  }
  const characters = Array.from(names, ([s, n]) => ({ s, n: Array.from(n) }));
  return new Response(JSON.stringify({ v: 1, characters }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
