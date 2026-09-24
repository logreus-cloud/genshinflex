import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const source = z.object({ title: z.string(), url: z.url() });

// Билд персонажа: слаги ссылаются на src/data/generated/*.json
const builds = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/builds' }),
  schema: z.object({
    character: z.string(),
    role: z.string(),
    updated: z.coerce.date(),
    patch: z.string(),
    weapons: z.array(z.object({ slug: z.string(), note: z.string().optional() })),
    artifacts: z.array(z.object({ sets: z.array(z.string()).min(1), note: z.string().optional() })),
    mainStats: z.object({ sands: z.string(), goblet: z.string(), circlet: z.string() }),
    substats: z.array(z.string()),
    talents: z.array(z.enum(['normal', 'skill', 'burst'])),
    teams: z.array(z.object({ name: z.string(), members: z.array(z.string()).length(4), note: z.string().optional() })),
    sources: z.array(source).default([]),
  }),
});

// Ротация контента: Бездна, Театр воображариума, Натиск
const rotations = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/rotations' }),
  schema: z.object({
    mode: z.enum(['abyss', 'theater', 'onslaught']),
    cycle: z.string(),
    start: z.coerce.date(),
    end: z.coerce.date(),
    draft: z.boolean().default(false),
    buffs: z.array(z.string()).default([]),
    stages: z.array(z.object({
      name: z.string(),
      halves: z.array(z.object({ enemies: z.array(z.string()), note: z.string().optional() })),
    })).default([]),
    teams: z.array(z.object({ members: z.array(z.string()).length(4), note: z.string().optional() })).default([]),
    sources: z.array(source).default([]),
  }),
});

export const collections = { builds, rotations };
