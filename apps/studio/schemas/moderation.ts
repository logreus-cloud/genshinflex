import { defineField, defineType } from 'sanity';

export const guideSubmission = defineType({
  name: 'guideSubmission',
  title: 'Заявка гайда',
  type: 'document',
  fields: [
    defineField({ name: 'userId', title: 'ID пользователя', type: 'string', readOnly: true }),
    defineField({ name: 'kind', title: 'Тип гайда', type: 'string', readOnly: true }),
    defineField({ name: 'target', title: 'Цель', type: 'string', readOnly: true }),
    defineField({ name: 'mode', title: 'Новый или правка', type: 'string', readOnly: true }),
    defineField({ name: 'author', title: 'Автор', type: 'string', readOnly: true }),
    defineField({ name: 'payload', title: 'Содержимое', type: 'text', readOnly: true }),
    defineField({ name: 'createdAt', title: 'Получено', type: 'datetime', readOnly: true }),
    defineField({ name: 'status', title: 'Статус', type: 'string', initialValue: 'new', options: { list: ['new', 'accepted', 'rejected'] }, validation: (Rule) => Rule.required() }),
    defineField({ name: 'moderatorComment', title: 'Комментарий модератора', type: 'text' }),
  ],
  preview: { select: { title: 'target', subtitle: 'status' } },
});

export const feedback = defineType({
  name: 'feedback',
  title: 'Отзыв',
  type: 'document',
  fields: [
    defineField({ name: 'kind', title: 'Тип', type: 'string', readOnly: true, options: { list: ['bug', 'data', 'idea', 'other'] } }),
    defineField({ name: 'page', title: 'Страница', type: 'string', readOnly: true }),
    defineField({ name: 'message', title: 'Сообщение', type: 'text', readOnly: true }),
    defineField({ name: 'createdAt', title: 'Получено', type: 'datetime', readOnly: true }),
    defineField({ name: 'status', title: 'Статус', type: 'string', initialValue: 'new', options: { list: ['new', 'reviewed', 'closed'] }, validation: (Rule) => Rule.required() }),
  ],
  preview: { select: { title: 'kind', subtitle: 'page' } },
});
