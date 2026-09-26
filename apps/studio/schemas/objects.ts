import { defineArrayMember, defineField, defineType } from 'sanity';

const required = (Rule: any) => Rule.required();
const elements = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo']
  .map((value) => ({ title: value, value }));

export const localeString = defineType({
  name: 'localeString', title: 'Текст по языкам', type: 'object',
  fields: [
    defineField({ name: 'ru', title: 'Русский', type: 'string', validation: required }),
    defineField({ name: 'en', title: 'English', type: 'string' }),
    defineField({ name: 'es', title: 'Español', type: 'string' }),
  ],
});

export const source = defineType({
  name: 'source', title: 'Источник', type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Название', type: 'string', validation: required }),
    defineField({ name: 'url', title: 'Ссылка', type: 'url', validation: (Rule) => Rule.required().uri({ scheme: ['http', 'https'] }) }),
  ],
  preview: { select: { title: 'title', subtitle: 'url' } },
});

export const team = defineType({
  name: 'team', title: 'Команда', type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Название', type: 'string', description: 'Можно оставить пустым для команд ротации.' }),
    defineField({
      name: 'members', title: 'Персонажи', type: 'array',
      description: 'Четыре слага персонажей из src/data/generated.',
      of: [{ type: 'string' }], validation: (Rule) => Rule.required().length(4),
    }),
    defineField({ name: 'note', title: 'Примечание', type: 'text' }),
  ],
  preview: { select: { title: 'name', subtitle: 'note' } },
});

export const rotationTeam = defineArrayMember({
  name: 'rotationTeam', title: 'Команда ротации', type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Название', type: 'localeString' }),
    defineField({
      name: 'members', title: 'Персонажи', type: 'array',
      description: 'Четыре слага персонажей из src/data/generated.',
      of: [{ type: 'string' }], validation: (Rule) => Rule.required().length(4),
    }),
    defineField({ name: 'note', title: 'Примечание', type: 'localeString' }),
  ],
  preview: { select: { title: 'name.ru', subtitle: 'note.ru' } },
});

export const externalLink = defineType({
  name: 'externalLink', title: 'Внешний гайд', type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Название', type: 'string', validation: required }),
    defineField({ name: 'url', title: 'Ссылка', type: 'url', validation: (Rule) => Rule.required().uri({ scheme: ['http', 'https'] }) }),
    defineField({ name: 'author', title: 'Автор', type: 'string' }),
    defineField({ name: 'lang', title: 'Язык', type: 'string', options: { list: ['ru', 'en', 'es'] }, validation: required }),
  ],
});

export const video = defineType({
  name: 'video', title: 'Видео YouTube', type: 'object',
  fields: [
    defineField({ name: 'id', title: 'ID ролика', type: 'string', validation: (Rule) => Rule.required().regex(/^[\w-]{11}$/) }),
    defineField({ name: 'title', title: 'Название', type: 'string', validation: required }),
    defineField({ name: 'author', title: 'Автор', type: 'string', validation: required }),
    defineField({ name: 'lang', title: 'Язык', type: 'string', initialValue: 'ru', options: { list: ['ru', 'en'] }, validation: required }),
  ],
});

export const weaponChoice = defineType({
  name: 'weaponChoice', title: 'Оружие билда', type: 'object',
  fields: [
    defineField({ name: 'slug', title: 'Слаг оружия', type: 'string', validation: required }),
    defineField({ name: 'note', title: 'Примечание', type: 'string' }),
  ],
});

export const artifactChoice = defineType({
  name: 'artifactChoice', title: 'Артефакты билда', type: 'object',
  fields: [
    defineField({ name: 'sets', title: 'Сеты', type: 'array', of: [{ type: 'string' }], validation: (Rule) => Rule.required().min(1) }),
    defineField({ name: 'note', title: 'Примечание', type: 'string' }),
  ],
});

export const mainStats = defineType({
  name: 'mainStats', title: 'Основные характеристики', type: 'object',
  fields: [
    defineField({ name: 'sands', title: 'Часы', type: 'string', validation: required }),
    defineField({ name: 'goblet', title: 'Кубок', type: 'string', validation: required }),
    defineField({ name: 'circlet', title: 'Корона', type: 'string', validation: required }),
  ],
});

export const rotationCast = defineType({
  name: 'rotationCast', title: 'Персонажи цикла', type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Название', type: 'localeString', validation: required }),
    defineField({ name: 'members', title: 'Персонажи', type: 'array', of: [{ type: 'string' }], validation: required }),
  ],
});

export const rotationHalf = defineType({
  name: 'rotationHalf', title: 'Требования половины', type: 'object',
  fields: [
    defineField({ name: 'half', title: 'Номер половины', type: 'number', validation: (Rule) => Rule.required().integer() }),
    defineField({ name: 'label', title: 'Название', type: 'localeString', validation: required }),
    defineField({
      name: 'need', title: 'Группы стихий', type: 'array',
      description: 'Каждую группу нужно закрыть; внутри группы достаточно одной стихии.',
      of: [{
        type: 'object', name: 'elementGroup', title: 'Группа стихий',
        fields: [
          defineField({
            name: 'elements', title: 'Стихии', type: 'array',
            of: [{ type: 'string', options: { list: elements } }],
            validation: (Rule) => Rule.required().min(1),
          }),
        ],
        preview: {
          select: { elements: 'elements' },
          prepare: ({ elements }) => ({
            title: Array.isArray(elements) && elements.length ? elements.join(' / ') : 'Без стихий',
          }),
        },
      }],
    }),
    defineField({ name: 'tip', title: 'Подсказка', type: 'localeString', validation: required }),
  ],
});

export const rotationEnemyHalf = defineType({
  name: 'rotationEnemyHalf', title: 'Враги половины', type: 'object',
  fields: [
    defineField({
      name: 'enemies', title: 'Враги', type: 'array',
      description: 'Название врага или ID из enemies.json, количество и примечание.',
      of: [
        {
          type: 'object', name: 'enemyText', title: 'Враг по названию',
          fields: [
            defineField({ name: 'name', title: 'Название', type: 'string', validation: required }),
            defineField({ name: 'n', title: 'Количество', type: 'number', validation: (Rule) => Rule.integer().min(1) }),
            defineField({ name: 'note', title: 'Примечание', type: 'localeString' }),
          ],
          preview: { select: { title: 'name', subtitle: 'note.ru' } },
        },
        {
          type: 'object', name: 'enemy', title: 'Враг из базы',
          fields: [
            defineField({ name: 'id', title: 'ID или английское название', type: 'string', validation: required }),
            defineField({ name: 'n', title: 'Количество', type: 'number', validation: (Rule) => Rule.integer().min(1) }),
            defineField({ name: 'note', title: 'Примечание', type: 'localeString' }),
          ],
          preview: { select: { title: 'id', subtitle: 'note.ru' } },
        },
      ],
      validation: required,
    }),
    defineField({ name: 'note', title: 'Примечание', type: 'localeString' }),
  ],
});

export const rotationChamber = defineType({
  name: 'rotationChamber', title: 'Зал', type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Название', type: 'localeString', validation: required }),
    defineField({ name: 'stars', title: 'Звёзды', type: 'string', validation: required }),
    defineField({ name: 'halves', title: 'Половины', type: 'array', of: [{ type: 'rotationEnemyHalf' }], validation: required }),
  ],
});

export const rotationFloor = defineType({
  name: 'rotationFloor', title: 'Этаж Бездны', type: 'object',
  fields: [
    defineField({ name: 'floor', title: 'Номер этажа', type: 'number', validation: (Rule) => Rule.required().integer() }),
    defineField({ name: 'levels', title: 'Уровни врагов', type: 'string', validation: required }),
    defineField({ name: 'disorder', title: 'Аномалии', type: 'array', of: [{ type: 'localeString' }], initialValue: [] }),
    defineField({ name: 'chambers', title: 'Залы', type: 'array', of: [{ type: 'rotationChamber' }], validation: required }),
    defineField({ name: 'teams', title: 'Команды', type: 'array', of: [rotationTeam], initialValue: [] }),
  ],
});

export const rotationStage = defineType({
  name: 'rotationStage', title: 'Этап', type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Название', type: 'localeString', validation: required }),
    defineField({ name: 'halves', title: 'Половины', type: 'array', of: [{ type: 'rotationEnemyHalf' }], validation: required }),
  ],
});

export const featuredCharacter = defineType({
  name: 'featuredCharacter', title: 'Персонаж баннера', type: 'object',
  fields: [
    defineField({ name: 'slug', title: 'Слаг персонажа', type: 'string', validation: required }),
    defineField({ name: 'rerun', title: 'Реран', type: 'boolean', initialValue: false }),
  ],
});
