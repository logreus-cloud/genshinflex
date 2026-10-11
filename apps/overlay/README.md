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
