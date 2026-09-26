import type { StructureResolver } from 'sanity/structure';

export const structure: StructureResolver = (S) =>
  S.list()
    .title('Контент')
    .items([
      S.documentTypeListItem('build').title('Билды'),
      S.listItem()
        .title('Эндгейм')
        .child(S.list().title('Эндгейм').items([
          S.documentTypeListItem('rotation').title('Ротации'),
          S.documentTypeListItem('endgameGuide').title('Гайды эндгейма'),
        ])),
      S.documentTypeListItem('banner').title('Баннеры'),
      S.documentTypeListItem('weaponGuide').title('Оружие'),
      S.documentTypeListItem('news').title('Новости'),
      S.listItem()
        .title('Модерация')
        .child(S.list().title('Модерация').items([
          S.documentTypeListItem('guideSubmission').title('Заявки гайдов'),
          S.documentTypeListItem('feedback').title('Отзывы'),
        ])),
    ]);
