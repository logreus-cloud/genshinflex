import { getCollection } from 'astro:content';
import { characters, weapons } from '../lib/data';

// Карта сайта для Google и Яндекса: все страницы, у гайдов — дата последнего обновления билда
export async function GET({ site }: { site: URL }) {
  const builds = new Map((await getCollection('builds')).map((b) => [b.data.character, b.data.updated]));
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const today = day(new Date());
  const pages: [string, string, string][] = [
    ['/', today, '1.0'], ['/characters/', today, '0.9'], ['/guides/', today, '0.9'], ['/rotation/', today, '0.9'],
    ['/banners/', today, '0.8'], ['/weapons/', today, '0.7'], ['/artifacts/', today, '0.7'], ['/rating/', today, '0.4'],
    ['/tools/team-check/', today, '0.8'], ['/about/', today, '0.3'], ['/feedback/', today, '0.3'], ['/tools/wishes/', today, '0.8'], ['/tools/rotation-builder/', today, '0.6'],
    ...characters.map((c) => [`/characters/${c.slug}/`, day(builds.get(c.slug) ?? new Date()), builds.has(c.slug) ? '0.8' : '0.5'] as [string, string, string]),
    ...weapons.map((w) => [`/weapons/${w.slug}/`, today, '0.4'] as [string, string, string]),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(([p, mod, prio]) => `  <url><loc>${new URL(p, site)}</loc><lastmod>${mod}</lastmod><priority>${prio}</priority></url>`).join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
