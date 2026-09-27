import { defineField, defineType } from 'sanity';
import { rotationTeam } from './objects';

export const rotation = defineType({
  name: 'rotation',
  title: 'Ротация',
  type: 'document',
  fields: [
    defineField({
      name: 'slug', title: 'Слаг файла', type: 'slug',
      options: { source: 'cycle' }, validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'mode', title: 'Режим', type: 'string', validation: (Rule) => Rule.required(),
      options: { list: [
        { title: 'Бездна', value: 'abyss' },
        { title: 'Театр', value: 'theater' },
        { title: 'Натиск', value: 'onslaught' },
      ] },
    }),
    defineField({ name: 'cycle', title: 'Цикл', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'start', title: 'Начало', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'end', title: 'Конец', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'draft', title: 'Черновик', type: 'boolean', initialValue: false }),
    defineField({ name: 'note', title: 'Примечание', type: 'localeString' }),
    defineField({ name: 'tags', title: 'Метки карточки', type: 'array', of: [{ type: 'localeString' }], initialValue: [] }),
    defineField({ name: 'buffs', title: 'Бонусы', type: 'array', of: [{ type: 'localeString' }], initialValue: [] }),
    defineField({ name: 'cast', title: 'Состав', type: 'array', of: [{ type: 'rotationCast' }], initialValue: [] }),
    defineField({ name: 'halves', title: 'Требования половин', type: 'array', of: [{ type: 'rotationHalf' }], initialValue: [] }),
    defineField({ name: 'floors', title: 'Этажи', type: 'array', of: [{ type: 'rotationFloor' }], initialValue: [] }),
    defineField({ name: 'stages', title: 'Этапы', type: 'array', of: [{ type: 'rotationStage' }], initialValue: [] }),
    defineField({ name: 'teams', title: 'Общие команды', type: 'array', of: [rotationTeam], initialValue: [] }),
    defineField({ name: 'sources', title: 'Источники', type: 'array', of: [{ type: 'source' }], initialValue: [] }),
  ],
  preview: { select: { title: 'mode', subtitle: 'cycle' } },
});
