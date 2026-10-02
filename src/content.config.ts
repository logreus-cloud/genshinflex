import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { contentSchemas } from './lib/content-schemas';
import { sanityLoader } from './lib/sanity-loader';

const fromSanity = process.env.CONTENT_SOURCE === 'sanity';

const builds = defineCollection({
  loader: fromSanity ? sanityLoader('builds') : glob({ pattern: '**/*.md', base: './src/content/builds' }),
  schema: contentSchemas.builds,
});

const rotations = defineCollection({
  loader: fromSanity ? sanityLoader('rotations') : glob({ pattern: '**/*.json', base: './src/content/rotations' }),
  schema: contentSchemas.rotations,
});

const banners = defineCollection({
  loader: fromSanity ? sanityLoader('banners') : glob({ pattern: '**/*.json', base: './src/content/banners' }),
  schema: contentSchemas.banners,
});

const buildsI18n = defineCollection({
  loader: fromSanity ? sanityLoader('buildsI18n') : glob({ pattern: '**/*.md', base: './src/content/builds-i18n' }),
  schema: contentSchemas.buildsI18n,
});

const weaponGuides = defineCollection({
  loader: fromSanity ? sanityLoader('weaponGuides') : glob({ pattern: '**/*.md', base: './src/content/weapon-guides' }),
  schema: contentSchemas.weaponGuides,
});

const endgameGuides = defineCollection({
  loader: fromSanity ? sanityLoader('endgameGuides') : glob({ pattern: '**/*.md', base: './src/content/endgame-guides' }),
  schema: contentSchemas.endgameGuides,
});

const news = defineCollection({
  loader: fromSanity ? sanityLoader('news') : glob({ pattern: '**/*.md', base: './src/content/news' }),
  schema: contentSchemas.news,
});

export const collections = { builds, rotations, banners, buildsI18n, weaponGuides, endgameGuides, news };
