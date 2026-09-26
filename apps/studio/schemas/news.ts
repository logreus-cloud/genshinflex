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
    defineField({ name: 'title', title: 'Заголовок', type: 'string', validation: (Rule) => Rule.required().min(1) }),
    defineField({ name: 'summary', title: 'Краткое описание', type: 'text', validation: (Rule) => Rule.required().min(1) }),
    defineField({ name: 'date', title: 'Дата', type: 'date', validation: (Rule) => Rule.required() }),
    defineField({ name: 'draft', title: 'Черновик', type: 'boolean', initialValue: false }),
    defineField({ name: 'body', title: 'Текст новости', type: 'array', of: [{ type: 'block' }] }),
  ],
  preview: { select: { title: 'title', subtitle: 'date' } },
});
