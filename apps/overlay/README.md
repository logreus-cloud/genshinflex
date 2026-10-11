# GenshinFlex Overlay

Оверлей для Windows на Tauri 2. Страницы загружаются с сайта GenshinFlex.

Нужны Rust stable, MSVC Build Tools и WebView2.

Из папки `apps/overlay`:

```sh
npm run icon
npm run dev
npm run build
```

Установщик NSIS появится в `src-tauri/target/release/bundle/nsis/`. Для локального сайта задайте `GF_OVERLAY_URL` (например, `http://localhost:4321`). В `settings.json` в каталоге конфигурации приложения можно указать `base_url` и `shortcut`.
Для входа через Discord и Google добавьте `genshinflex://auth` в Supabase → Authentication → URL Configuration → Redirect URLs.

## Релиз

Поднимите версию в `src-tauri/tauri.conf.json` и `src-tauri/Cargo.toml`, затем сделайте коммит. Создайте и отправьте тег: `git tag overlay-vX.Y.Z && git push origin overlay-vX.Y.Z`.

Дождитесь завершения Actions, проверьте черновик релиза и опубликуйте его.

Ключ подписи хранится в `~/.tauri/genshinflex-overlay.key`, пароль — в `~/.tauri/genshinflex-overlay.key.password`. Их содержимое задаётся в GitHub как секреты `TAURI_SIGNING_PRIVATE_KEY` и `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
При потере ключа старые установки не смогут обновиться.
