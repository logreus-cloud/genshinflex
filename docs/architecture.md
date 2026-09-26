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
Редактор → Sanity → подписанный вебхук → Worker → GitHub Actions → Pages
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
3. Для Worker задать `SUPABASE_SERVICE_ROLE_KEY` и `TELEGRAM_BOT_TOKEN` через секреты Wrangler. При необходимости HS256 задать `SUPABASE_JWT_SECRET`; для асимметричных JWT используется JWKS Supabase. Выполнить `wrangler deploy` из `apps/api` и назначить маршрут `api.genshinflex.com`.
4. Установить зависимости рабочих областей, собрать и развернуть Studio. После настройки проекта проверить `npm run api:test`.
5. В `@BotFather` выполнить `/setdomain` для `genshinflex.com`. Из `apps/api` задать Worker-секреты командами `npx wrangler secret put TELEGRAM_BOT_TOKEN` и `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`.

Не публиковать service role key и токены Sanity, Telegram и GitHub в клиентском коде или репозитории. Публичные страницы профилей читают `public.public_profiles`; прямое чтение `profiles` ограничено публичными столбцами. Приватный `game_uid` читает Worker с service role key, а менять его может только владелец профиля.

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

## Этап 4b: автосборка

0. Файл `.github/workflows/deploy-sanity.yml` должен лежать в ветке по умолчанию (`main`): GitHub запускает `repository_dispatch` и показывает «Run workflow» только для workflow из неё. Сам workflow собирает ветку из `DEPLOY_REF` (сейчас `platform`), так что достаточно перенести в `main` один этот файл.
1. В GitHub → Settings → Developer settings создать fine-grained token сроком на год. Доступ — только к репозиторию `logreus-cloud/genshinflex`, право **Contents: Read and write** для `repository_dispatch`. Из `apps/api` выполнить `npx wrangler secret put GITHUB_DISPATCH_TOKEN`, затем `npx wrangler deploy`.
2. В Cloudflare → My Profile → API Tokens создать Custom token с правом Account → Cloudflare Pages → Edit. Account ID взять из дашборда Cloudflare.
3. В GitHub → репозиторий → Settings → Secrets and variables → Actions добавить `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` и `SANITY_READ_TOKEN`.
4. В sanity.io/manage → API → Webhooks → Create указать URL `https://api.genshinflex.com/hooks/sanity`, dataset `production`, Trigger on Create/Update/Delete, фильтр `_type in ["build","news","rotation","banner","weaponGuide","endgameGuide"]`, projection `{_id, _type}` и HTTP method POST. Для Secret создать случайную строку и задать её в Worker командой `npx wrangler secret put SANITY_WEBHOOK_SECRET` из `apps/api`; после этого выполнить `npx wrangler deploy`. Drafts выключить, чтобы вебхук срабатывал только при публикации.
5. Проверить вручную: Actions → «Deploy from Sanity» → Run workflow. Затем изменить документ в Studio и нажать Publish: примерно через 2–3 минуты изменение должно появиться на `platform.genshinflex.pages.dev`.
6. После слияния `platform` в `main` изменить в `apps/api/wrangler.toml` значения на `DEPLOY_REF = "main"` и `DEPLOY_BRANCH = ""`, затем выполнить `npx wrangler deploy` из `apps/api`.

## Этап 4c: скрипты и Sanity

Без `CONTENT_SOURCE` скрипты читают и пишут файлы `src/content`. Для работы с опубликованными документами Sanity задайте `CONTENT_SOURCE=sanity` в корневом `.env`. Скрипты `guide:md` и `cms:external` записывают изменения в Sanity; `sim` читает билды, а `discord:news` читает новости. Сборка сайта после публикации запускается вебхуком этапа 4b.

Для записи откройте sanity.io/manage → API → Tokens, создайте токен с ролью Editor и сохраните его в корневом `.env` как `SANITY_WRITE_TOKEN`. Не добавляйте `.env` в git. Чтение использует `SANITY_READ_TOKEN` или `SANITY_WRITE_TOKEN`. Если у документа есть неопубликованный черновик, скрипт предупреждает: последующая публикация черновика может перезаписать запись скрипта.

`npm run cms:push -- src/content/builds-i18n` выгружает отдельные файлы или папки в Sanity независимо от `CONTENT_SOURCE`. Это нужно, например, после `scripts/i18n/bodies.py`. Скрипт хранит ревизии в `.cache/cms-push.json`: если содержимое в Studio изменилось после последней выгрузки, файл не заменяется. `--dry` показывает действия без записи; `--force` разрешает перезапись. Документы с одинаковым содержимым пропускаются.

При слиянии `platform` в `main` переключайте источник в таком порядке:

1. Заморозьте правки Markdown.
2. Из актуального `main` выполните `npm run cms:export` и импортируйте результат с `--replace`. Это последний импорт, при котором Markdown перезаписывает Sanity.
3. Укажите `CONTENT_SOURCE=sanity` в `.env`; в `apps/api/wrangler.toml` установите `DEPLOY_REF = "main"` и `DEPLOY_BRANCH = ""`.
4. С этого момента редактируйте контент только через Studio и скрипты.

Проверки: `npm run cms:store-test` и `npm run cms:test`.

## Этап 6: данные и конфиденциальность

Политика опубликована на трёх языках. Worker выдаёт копию данных аккаунта через `GET /me/export` и удаляет аккаунт через `DELETE /me` после подтверждения и свежего входа. Удаление пользователя каскадно удаляет связанные строки; файлы аватаров удаляются отдельно.

Перед запуском владелец должен проверить текст политики: это не юридическая консультация. Если появится почта для запросов о данных, добавьте `privacyEmail` в `src/data/social.json`.
