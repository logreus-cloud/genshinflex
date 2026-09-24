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
    // Гайды сообщества на других сайтах — блок «Также можете посмотреть»
    external: z.array(z.object({ title: z.string(), url: z.url(), author: z.string().optional(), lang: z.enum(['ru', 'en', 'es']) })).default([]),
    // Авторы из редактора гайдов (подпись на странице персонажа)
    authors: z.array(z.string()).default([]),
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
    // Этажи Бездны: враг — английское название из genshin-db (src/data/generated/enemies.json) или готовая строка, если врага нет в базе
    floors: z.array(z.object({
      floor: z.number().int(),
      levels: z.string(),
      disorder: z.array(z.string()).default([]),
      chambers: z.array(z.object({
        name: z.string(),
        stars: z.string(),
        halves: z.array(z.object({
          enemies: z.array(z.union([z.string(), z.object({ id: z.string(), n: z.number().int().optional(), note: z.string().optional() })])),
          note: z.string().optional(),
        })),
      })),
      // Команды для этажа (у верхнего этажа — общие teams режима)
      teams: z.array(z.object({ name: z.string().optional(), members: z.array(z.string()).length(4), note: z.string().optional() })).default([]),
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

// Переводы текстов разборов: src/content/builds-i18n/<язык>/<слаг>.md (id вида «en/vesna»)
const buildsI18n = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/builds-i18n' }),
  schema: z.object({}),
});

// Гайды сообщества из редактора (npm run guide:md): текст, ссылки и подпись; id вида «ru/the-flute»
const external = z.array(z.object({ title: z.string(), url: z.url(), author: z.string().optional(), lang: z.enum(['ru', 'en', 'es']) })).default([]);
const guideTeam = z.object({ name: z.string().optional(), members: z.array(z.string()).length(4), note: z.string().optional() });

// Гайды на оружие: src/content/weapon-guides/<язык>/<слаг>.md
const weaponGuides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/weapon-guides' }),
  schema: z.object({ updated: z.coerce.date(), authors: z.array(z.string()).default([]), external }),
});

// Гайды на эндгейм: src/content/endgame-guides/<язык>/<abyss-12 | theater | onslaught>.md.
// cycle — дата начала цикла: гайд показывается, только пока идёт тот же цикл
const endgameGuides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/endgame-guides' }),
  schema: z.object({ cycle: z.string(), updated: z.coerce.date(), teams: z.array(guideTeam).default([]), authors: z.array(z.string()).default([]), external }),
});

// Общий anchor сохраняется во всех переводах и в постоянных ссылках из баннера.
const news = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
  schema: z.object({
    lang: z.enum(['ru', 'en', 'es']),
    anchor: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1),
    summary: z.string().min(1),
    date: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { builds, rotations, banners, buildsI18n, weaponGuides, endgameGuides, news };
