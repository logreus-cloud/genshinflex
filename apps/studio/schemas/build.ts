import { bodyBlock } from './objects';
import { defineField, defineType } from 'sanity';

const onlyRussian = ({ document }: { document?: { lang?: string } }) => Boolean(document?.lang && document.lang !== 'ru');
const requiredForRussian = (Rule: any) => Rule.custom((value: unknown, context: { document?: { lang?: string } }) =>
  (context.document?.lang ?? 'ru') !== 'ru' || value !== undefined && value !== null || 'Обязательно для русской версии');

export const build = defineType({
  name: 'build', title: 'Билд персонажа', type: 'document',
  fields: [
    defineField({ name: 'lang', title: 'Язык', type: 'string', hidden: true, options: { list: ['ru', 'en', 'es'] }, initialValue: 'ru' }),
    defineField({ name: 'character', title: 'Слаг персонажа', type: 'string', description: 'Структура билда берётся из русской версии. Ссылка на персонажа из src/data/generated.', validation: (Rule) => Rule.required() }),
    defineField({ name: 'role', title: 'Роль', type: 'string', hidden: onlyRussian, validation: requiredForRussian }),
    defineField({ name: 'updated', title: 'Обновлено', type: 'date', hidden: onlyRussian, validation: requiredForRussian }),
    defineField({ name: 'patch', title: 'Патч', type: 'string', hidden: onlyRussian, validation: requiredForRussian }),
    defineField({ name: 'weapons', title: 'Оружие', type: 'array', of: [{ type: 'weaponChoice' }], hidden: onlyRussian, validation: requiredForRussian }),
    defineField({ name: 'artifacts', title: 'Артефакты', type: 'array', of: [{ type: 'artifactChoice' }], hidden: onlyRussian, validation: requiredForRussian }),
    defineField({ name: 'mainStats', title: 'Основные характеристики', type: 'mainStats', hidden: onlyRussian, validation: requiredForRussian }),
    defineField({ name: 'substats', title: 'Дополнительные характеристики', type: 'array', of: [{ type: 'string' }], hidden: onlyRussian, validation: requiredForRussian }),
    defineField({
      name: 'talents', title: 'Приоритет талантов', type: 'array',
      of: [{ type: 'string', options: { list: [
        { title: 'Обычная атака', value: 'normal' },
        { title: 'Навык', value: 'skill' },
        { title: 'Взрыв стихии', value: 'burst' },
      ] } }],
      initialValue: [],
      hidden: onlyRussian,
    }),
    defineField({
      name: 'teams', title: 'Команды', type: 'array', of: [{ type: 'team' }], initialValue: [],
      hidden: onlyRussian,
      validation: (Rule) => Rule.custom((items) =>
        !items || items.every((item) => Boolean(item.name)) || 'У команды билда должно быть название'),
    }),
    defineField({ name: 'sources', title: 'Источники', type: 'array', of: [{ type: 'source' }], initialValue: [], hidden: onlyRussian }),
    defineField({ name: 'external', title: 'Другие гайды', type: 'array', of: [{ type: 'externalLink' }], initialValue: [], hidden: onlyRussian }),
    defineField({ name: 'authors', title: 'Авторы', type: 'array', of: [{ type: 'string' }], initialValue: [], hidden: onlyRussian }),
    defineField({ name: 'videos', title: 'Видео', type: 'array', of: [{ type: 'video' }], initialValue: [], hidden: onlyRussian }),
    defineField({ name: 'body', title: 'Текст билда', type: 'array', of: [bodyBlock], validation: (Rule) => Rule.required() }),
    defineField({ name: 'bodyMarkdown', title: 'Исходный Markdown', type: 'text', hidden: true }),
    defineField({ name: 'bodyHash', title: 'Отпечаток текста', type: 'string', hidden: true }),
  ],
  preview: {
    select: { title: 'character', role: 'role', lang: 'lang' },
    prepare: ({ title, role, lang }) => ({ title, subtitle: `${role || 'Без роли'} · ${lang || 'ru'}` }),
  },
});
