import { bodyBlock } from './objects';
import { defineField, defineType } from 'sanity';

export const endgameGuide = defineType({
  name: 'endgameGuide',
  title: 'Гайд эндгейма',
  type: 'document',
  fields: [
    defineField({ name: 'lang', title: 'Язык', type: 'string', hidden: true, initialValue: 'ru', options: { list: ['ru', 'en', 'es'] } }),
    defineField({ name: 'slug', title: 'Слаг гайда', type: 'string', description: 'Например, abyss-12, theater или onslaught.', validation: (Rule) => Rule.required() }),
    defineField({ name: 'cycle', title: 'Цикл', type: 'string', description: 'Дата начала цикла ротации.', validation: (Rule) => Rule.required() }),
    defineField({ name: 'updated', title: 'Обновлено', type: 'date', validation: (Rule) => Rule.required() }),
    defineField({ name: 'teams', title: 'Команды', type: 'array', of: [{ type: 'team' }], initialValue: [] }),
    defineField({ name: 'authors', title: 'Авторы', type: 'array', of: [{ type: 'string' }], initialValue: [] }),
    defineField({ name: 'external', title: 'Другие гайды', type: 'array', of: [{ type: 'externalLink' }], initialValue: [] }),
    defineField({ name: 'body', title: 'Текст гайда', type: 'array', of: [bodyBlock], validation: (Rule) => Rule.required() }),
    defineField({ name: 'bodyMarkdown', title: 'Исходный Markdown', type: 'text', hidden: true }),
    defineField({ name: 'bodyHash', title: 'Отпечаток текста', type: 'string', hidden: true }),
  ],
  preview: { select: { title: 'slug', subtitle: 'cycle' } },
});
