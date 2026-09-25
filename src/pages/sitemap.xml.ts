import { getCollection } from 'astro:content';
import { characters, weapons } from '../lib/data';

// Карта сайта для Google и Яндекса: все страницы, у гайдов — дата последнего обновления билда
export async function GET({ site }: { site: URL }) {
  const builds = new Map((await getCollection('builds')).map((b) => [b.data.character, b.data.updated]));
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const today = day(new Date());
  const pages: [string, string, string][] = [
    ['/', today, '1.0'], ['/characters/', today, '0.9'], ['/guides/', today, '0.9'], ['/rotation/', today, '0.9'], ['/abyss/', today, '0.9'], ['/theater/', today, '0.8'], ['/onslaught/', today, '0.6'],
    ['/calendar/', today, '0.8'], ['/banners/', today, '0.8'], ['/weapons/', today, '0.7'], ['/artifacts/', today, '0.7'], ['/rating/', today, '0.4'], ['/news/', today, '0.5'],
    ['/tools/team-check/', today, '0.8'], ['/about/', today, '0.3'], ['/feedback/', today, '0.3'], ['/tools/wishes/', today, '0.8'], ['/tools/rotation-builder/', today, '0.6'], ['/tools/calculator/', today, '0.8'],
    ...characters.map((c) => [`/characters/${c.slug}/`, day(builds.get(c.slug) ?? new Date()), builds.has(c.slug) ? '0.8' : '0.5'] as [string, string, string]),
    ...weapons.map((w) => [`/weapons/${w.slug}/`, today, '0.4'] as [string, string, string]),
  ];
  // Каждый адрес — в трёх языках, с перекрёстными ссылками hreflang (так рекомендует Google)
  const prefixes = { ru: '', en: '/en', es: '/es' } as const;
  const alts = (p: string) => Object.entries(prefixes).map(([l, pre]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${new URL(pre + p, site)}"/>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.flatMap(([p, mod, prio]) => Object.values(prefixes).map((pre) =>
  `  <url><loc>${new URL(pre + p, site)}</loc><lastmod>${mod}</lastmod><priority>${prio}</priority>${alts(p)}</url>`)).join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
