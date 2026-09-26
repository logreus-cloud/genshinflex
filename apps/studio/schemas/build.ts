import { defineField, defineType } from 'sanity';

export const build = defineType({
  name: 'build', title: 'Билд персонажа', type: 'document',
  fields: [
    defineField({ name: 'lang', title: 'Язык', type: 'string', hidden: true, options: { list: ['ru', 'en', 'es'] }, initialValue: 'ru' }),
    defineField({ name: 'character', title: 'Слаг персонажа', type: 'string', description: 'Ссылка на персонажа из src/data/generated.', validation: (Rule) => Rule.required() }),
    defineField({ name: 'role', title: 'Роль', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'updated', title: 'Обновлено', type: 'date', validation: (Rule) => Rule.required() }),
    defineField({ name: 'patch', title: 'Патч', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'weapons', title: 'Оружие', type: 'array', of: [{ type: 'weaponChoice' }], validation: (Rule) => Rule.required() }),
    defineField({ name: 'artifacts', title: 'Артефакты', type: 'array', of: [{ type: 'artifactChoice' }], validation: (Rule) => Rule.required() }),
    defineField({ name: 'mainStats', title: 'Основные характеристики', type: 'mainStats', validation: (Rule) => Rule.required() }),
    defineField({ name: 'substats', title: 'Дополнительные характеристики', type: 'array', of: [{ type: 'string' }], validation: (Rule) => Rule.required() }),
    defineField({
      name: 'talents', title: 'Приоритет талантов', type: 'array',
      of: [{ type: 'string', options: { list: [
        { title: 'Обычная атака', value: 'normal' },
        { title: 'Навык', value: 'skill' },
        { title: 'Взрыв стихии', value: 'burst' },
      ] } }],
      initialValue: [],
    }),
    defineField({
      name: 'teams', title: 'Команды', type: 'array', of: [{ type: 'team' }], initialValue: [],
      validation: (Rule) => Rule.custom((items) =>
        !items || items.every((item) => Boolean(item.name)) || 'У команды билда должно быть название'),
    }),
    defineField({ name: 'sources', title: 'Источники', type: 'array', of: [{ type: 'source' }], initialValue: [] }),
    defineField({ name: 'external', title: 'Другие гайды', type: 'array', of: [{ type: 'externalLink' }], initialValue: [] }),
    defineField({ name: 'authors', title: 'Авторы', type: 'array', of: [{ type: 'string' }], initialValue: [] }),
    defineField({ name: 'videos', title: 'Видео', type: 'array', of: [{ type: 'video' }], initialValue: [] }),
    defineField({ name: 'body', title: 'Текст билда', type: 'array', of: [{ type: 'block' }], validation: (Rule) => Rule.required() }),
  ],
  preview: {
    select: { title: 'character', role: 'role', lang: 'lang' },
    prepare: ({ title, role, lang }) => ({ title, subtitle: `${role || 'Без роли'} · ${lang || 'ru'}` }),
  },
});
