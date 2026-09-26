import { defineField, defineType } from 'sanity';

const serverTime = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

export const banner = defineType({
  name: 'banner',
  title: 'Баннер',
  type: 'document',
  fields: [
    defineField({
      name: 'slug', title: 'Слаг файла', type: 'slug',
      options: { source: 'version' }, validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'version', title: 'Версия', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'phase', title: 'Фаза', type: 'number', validation: (Rule) => Rule.required().integer() }),
    // Серверное время сохраняем строкой: его нельзя переводить в UTC до выбора региона.
    defineField({ name: 'start', title: 'Начало по серверу', type: 'string', validation: (Rule) => Rule.required().regex(serverTime) }),
    defineField({ name: 'end', title: 'Конец по серверу', type: 'string', validation: (Rule) => Rule.required().regex(serverTime) }),
    defineField({ name: 'featured', title: 'Главные персонажи', type: 'array', of: [{ type: 'featuredCharacter' }], validation: (Rule) => Rule.required() }),
    defineField({ name: 'fourStars', title: 'Персонажи 4★', type: 'array', of: [{ type: 'string' }], initialValue: [] }),
    defineField({ name: 'weapons', title: 'Оружие', type: 'array', of: [{ type: 'string' }], initialValue: [] }),
    defineField({ name: 'sources', title: 'Источники', type: 'array', of: [{ type: 'source' }], initialValue: [] }),
  ],
  preview: { select: { title: 'version', phase: 'phase' }, prepare: ({ title, phase }) => ({ title: `Версия ${title}`, subtitle: `Фаза ${phase}` }) },
});
