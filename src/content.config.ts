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
    talents: z.array(z.enum(['normal', 'skill', 'burst'])).default([]),
    teams: z.array(z.object({ name: z.string(), members: z.array(z.string()).length(4), note: z.string().optional() })),
    sources: z.array(source).default([]),
    // Видео-гайды с YouTube: id ролика (11 символов), название и автор — как на YouTube (проверены через oEmbed)
    videos: z.array(z.object({
      id: z.string().regex(/^[\w-]{11}$/), title: z.string(), author: z.string(), lang: z.enum(['ru', 'en']).default('ru'),
    })).default([]),
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
    note: z.string().optional(),
    // Короткие метки для карточки на главной: «Рассеивание», «Лунный заряд»
    tags: z.array(z.string()).default([]),
    buffs: z.array(z.string()).default([]),
    cast: z.array(z.object({ title: z.string(), members: z.array(z.string()) })).default([]),
    // Для проверки команды: какие стихии нужны в каждой половине (все группы должны быть закрыты, внутри группы — любая стихия)
    halves: z.array(z.object({
      half: z.number().int(),
      label: z.string(),
      need: z.array(z.array(z.enum(['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo']))),
      tip: z.string(),
    })).default([]),
    stages: z.array(z.object({
      name: z.string(),
      halves: z.array(z.object({ enemies: z.array(z.string()), note: z.string().optional() })),
    })).default([]),
    teams: z.array(z.object({
      name: z.string().optional(), members: z.array(z.string()).length(4), note: z.string().optional(),
    })).default([]),
    sources: z.array(source).default([]),
  }),
});

// Баннеры: время начала/конца — по времени сервера («2026-10-13T18:00»), таймеры пересчитываются под регион
const serverTime = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/);
const banners = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/banners' }),
  schema: z.object({
    version: z.string(),
    phase: z.number().int(),
    start: serverTime,
    end: serverTime,
    featured: z.array(z.object({ slug: z.string(), rerun: z.boolean().default(false) })),
    fourStars: z.array(z.string()).default([]),
    weapons: z.array(z.string()).default([]),
    sources: z.array(source).default([]),
  }),
});

export const collections = { builds, rotations, banners };
