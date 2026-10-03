// Перезагружает страницу при переходе между разными сборками: иначе старые и новые модули
// работают одновременно и, например, дважды вешают обработчик на кнопку меню.
if (!window.gfBuildGuard) {
  window.gfBuildGuard = true;
  document.addEventListener('astro:before-preparation', (event) => {
    const load = event.loader;
    event.loader = async () => {
      await load();
      const current = document.querySelector<HTMLMetaElement>('meta[name="gf-build"]')?.content;
      const next = event.newDocument?.querySelector<HTMLMetaElement>('meta[name="gf-build"]')?.content;
      // Отмена после загрузки: Astro сам открывает to.href через location.href до pushState,
      // поэтому при обычном переходе в истории одна запись, а при «назад/вперёд» URL уже выбран popstate
      if (current && next && current !== next) event.preventDefault();
    };
  });
}
