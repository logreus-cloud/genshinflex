import { bodyBlock } from './objects';
import { defineField, defineType } from 'sanity';

export const news = defineType({
  name: 'news',
  title: 'Новость',
  type: 'document',
  fields: [
    defineField({ name: 'lang', title: 'Язык', type: 'string', hidden: true, initialValue: 'ru', options: { list: ['ru', 'en', 'es'] } }),
    defineField({
      name: 'anchor', title: 'Общий якорь', type: 'string',
      description: 'Одинаковый во всех переводах для постоянных ссылок.',
      validation: (Rule) => Rule.required().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    }),
    defineField({
      name: 'slug', title: 'Слаг файла', type: 'slug',
      options: { source: 'anchor' }, validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'title', title: 'Заголовок', type: 'string', validation: (Rule) => Rule.required().min(1) }),
    defineField({ name: 'summary', title: 'Краткое описание', type: 'text', validation: (Rule) => Rule.required().min(1) }),
    defineField({ name: 'date', title: 'Дата', type: 'date', validation: (Rule) => Rule.required() }),
    // Время из Markdown сохраняется отдельно, потому что date хранит только день.
    defineField({ name: 'dateTime', title: 'Исходное время', type: 'string', hidden: true }),
    defineField({ name: 'draft', title: 'Черновик', type: 'boolean', initialValue: false }),
    defineField({ name: 'body', title: 'Текст новости', type: 'array', of: [bodyBlock] }),
    defineField({ name: 'bodyMarkdown', title: 'Исходный Markdown', type: 'text', hidden: true }),
    defineField({ name: 'bodyHash', title: 'Отпечаток текста', type: 'string', hidden: true }),
  ],
  preview: { select: { title: 'title', subtitle: 'date' } },
});
