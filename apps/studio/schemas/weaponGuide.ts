import { defineField, defineType } from 'sanity';

export const weaponGuide = defineType({
  name: 'weaponGuide',
  title: 'Гайд на оружие',
  type: 'document',
  fields: [
    defineField({ name: 'lang', title: 'Язык', type: 'string', hidden: true, initialValue: 'ru', options: { list: ['ru', 'en', 'es'] } }),
    defineField({
      name: 'slug', title: 'Слаг оружия', type: 'string',
      description: 'Сохраняет имя markdown-файла при миграции.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'updated', title: 'Обновлено', type: 'date', validation: (Rule) => Rule.required() }),
    defineField({ name: 'authors', title: 'Авторы', type: 'array', of: [{ type: 'string' }], initialValue: [] }),
    defineField({ name: 'external', title: 'Другие гайды', type: 'array', of: [{ type: 'externalLink' }], initialValue: [] }),
    defineField({ name: 'body', title: 'Текст гайда', type: 'array', of: [{ type: 'block' }], validation: (Rule) => Rule.required() }),
  ],
  preview: { select: { title: 'slug', subtitle: 'updated' } },
});
