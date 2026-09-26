# Архитектура платформы

## Сервисы и данные

| Сервис | Ответственность |
| --- | --- |
| Astro на Cloudflare Pages | Публичный сайт и страницы контента |
| Sanity Content Lake и Studio | Билды, ротации, баннеры, новости и гайды |
| Supabase Postgres, Auth и Storage | Аккаунты, пользовательские данные, роли и аватары |
| Cloudflare Worker на Hono | Авторизованный API, проверка подписей и запуск сборки |

Переводы билдов, новостей и гайдов хранятся отдельными документами Sanity с языком `ru`, `en` или `es`. Ротации используют объекты `localeString` для видимого текста. Слаги персонажей и оружия по-прежнему ссылаются на данные сайта. При миграции на этапе 4 каждую группу `halves[].need` нужно преобразовать из массива стихий в `{ elements: [...] }`, а строковых врагов в `floors[].chambers[].halves[].enemies` и `stages[].halves[].enemies` — в объекты `{ name: ... }`. Названия и примечания команд ротации нужно перенести в поле `ru` объекта `localeString`.

```text
Редактор → Sanity → подписанный вебхук → Worker → Deploy Hook → Pages
Пользователь → Supabase Auth → access token → Worker → Postgres
```

Studio редактирует содержимое Content Lake. Опубликованный сайт получает контент при сборке. Пользователь входит через Supabase Auth; Worker проверяет JWT и читает профиль. На этапе 2 Telegram Login Widget передаёт подписанные данные Worker, который выдаёт одноразовый `token_hash` для сессии Supabase.

## Бесплатные лимиты

Лимиты меняются; перед запуском сверяйте условия сервисов:

| Сервис | Бесплатный план |
| --- | --- |
| [Sanity](https://www.sanity.io/pricing) | Бесплатный проект с лимитами документов, API и участников |
| [Supabase](https://supabase.com/pricing) | Бесплатный проект с лимитами базы, Storage и Auth |
| [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/) | 100 000 запросов в день и 10 мс CPU на вызов |
| [Cloudflare Pages](https://developers.cloudflare.com/pages/platform/limits/) | Бесплатные сборки с месячным лимитом |
| [Resend](https://resend.com/pricing) | Бесплатная отправка писем с лимитом отправок |

## Настройка

1. Создать проект Sanity и dataset `production`. Указать `SANITY_STUDIO_PROJECT_ID` и `SANITY_STUDIO_DATASET` для Studio; добавить разрешённые CORS origins сайта и Studio. Создать токен записи для будущих серверных операций, хранить его как `SANITY_WRITE_TOKEN` только в Worker. Настроить вебхук на `https://api.genshinflex.com/hooks/sanity` с секретом `SANITY_WEBHOOK_SECRET`, методом POST и событиями опубликованных документов.
2. Создать проект Supabase в регионе EU. Связать проект с CLI и выполнить `supabase db push`. В Authentication → URL Configuration указать Site URL `https://genshinflex.com` и Redirect URLs `https://genshinflex.com/**`, `https://test.genshinflex.pages.dev/**`, `http://localhost:4321/**`. В Providers включить Discord (приложение в Discord Developer Portal) и Google (OAuth client в Google Cloud); redirect обоих провайдеров — `https://qhfufvdculphsqxuqxsw.supabase.co/auth/v1/callback`. В SMTP настроить Resend. В Bot protection включить Turnstile, его секрет хранить в Supabase, а site key задать в Pages как `PUBLIC_TURNSTILE_SITE_KEY`. Секреты OAuth и SMTP хранить в окружении.
3. Создать Cloudflare Pages Deploy Hook. Сохранить его URL в секрете Worker `CF_DEPLOY_HOOK_URL`.
4. Для Worker задать `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `SANITY_WEBHOOK_SECRET` и `CF_DEPLOY_HOOK_URL` через секреты Wrangler. При необходимости HS256 задать `SUPABASE_JWT_SECRET`; для асимметричных JWT используется JWKS Supabase. Выполнить `wrangler deploy` из `apps/api` и назначить маршрут `api.genshinflex.com`.
5. Установить зависимости рабочих областей, собрать и развернуть Studio. После настройки проекта проверить `npm run api:test`.
6. В `@BotFather` выполнить `/setdomain` для `genshinflex.com`. Из `apps/api` задать Worker-секреты командами `npx wrangler secret put TELEGRAM_BOT_TOKEN` и `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`.

Не публиковать service role key, токены Sanity, Telegram и URL Deploy Hook в клиентском коде или репозитории. Публичные страницы профилей читают `public.public_profiles`; прямое чтение `profiles` ограничено публичными столбцами. Приватный `game_uid` читает Worker с service role key, а менять его может только владелец профиля.

## Следующие этапы

2. Вход, регистрация и Telegram-сессия — реализованы; профили и синхронизация пользовательских данных — этап 3.
3. Перенос форм обратной связи и заявок гайдов в API и модерацию.
4. Миграция Markdown и JSON в Sanity, чтение контента сайтом.
5. Перенос Astro в `apps/web` и объединение сборки рабочих областей.
6. Наблюдаемость, лимиты запросов, резервное копирование и завершение перехода.

## Решения

- **`bio` публичный.** Описание «о себе» — это часть публичного профиля (`/u/ник`), пользователь сам решает, что туда писать, и может скрыть профиль целиком (`is_public = false`). Приватные поля — `game_uid` и всё в `user_data`.
- **Враги в ротациях** хранятся объектами `{ id }` (из genshin-db — названия переводятся по базе) или `{ name }` (редкий ручной случай, без перевода).

## Этап 4: переезд контента на Sanity

Сайт читает контент из Sanity, только если при сборке задано `CONTENT_SOURCE=sanity` (`npm run build:sanity`); иначе — из `src/content`, как раньше. Страницы не меняются: загрузчик `src/lib/sanity-loader.ts` отдаёт те же данные, id и `render(entry)`, что и `glob`.

1. `npm run cms:test` — проверка без потерь: md/JSON → документ Sanity → обратно, сравнение данных и HTML. Должно быть 0 расхождений.
2. `npm run cms:export` — пишет `.cache/sanity-import.ndjson` (детерминированные `_id`, повторный экспорт перезаписывает те же документы).
3. Импорт (из `apps/studio`, после `npx sanity login`): `npx sanity dataset import ../../.cache/sanity-import.ndjson production --replace`.
4. `npm run build:sanity` и сравнение с обычной сборкой.
5. Переключение: сборка сайта с `CONTENT_SOURCE=sanity`.

После переключения источник правды — Sanity. Скрипты `guide-to-md`, `find-external-guides`, `sim-investments` и `scripts/i18n/bodies.py` пока работают с md; повторный `cms:export` + импорт с `--replace` перезапишет правки, сделанные в Studio. Этап 4b — автосборка после публикации (вебхук Sanity → Worker → GitHub Actions → Pages).
