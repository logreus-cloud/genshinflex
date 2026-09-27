# Сторонние компоненты и данные

Код GenshinFlex распространяется по лицензии [MIT](LICENSE), тексты руководств — по [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Ниже — то, что в репозитории или на сайте принадлежит другим авторам и идёт под своими лицензиями.

## Распространяется вместе с сайтом

| Компонент | Где | Лицензия | Примечание |
|---|---|---|---|
| [gcsim](https://github.com/genshinsim/gcsim) v2.47.6 | `public/gcsim/gcsim.wasm.gz` | **AGPL-3.0** | Движок симулятора, собран в WebAssembly без изменений. Исходник, команда сборки и контрольные суммы — [`public/gcsim/NOTICE.md`](public/gcsim/NOTICE.md), текст лицензии — [`public/gcsim/LICENSE`](public/gcsim/LICENSE). Работает отдельной программой в Web Worker; лицензия AGPL относится к этому движку, а не к остальному коду сайта. |
| Go `wasm_exec.js` (Go 1.27.0) | `public/gcsim/wasm_exec.js` | BSD-3-Clause | Загрузчик WebAssembly, [`public/gcsim/LICENSE-go`](public/gcsim/LICENSE-go). |

Если вы форкаете проект и выкладываете сайт с этим движком, вы тоже распространяете gcsim под AGPL-3.0: оставьте `public/gcsim/NOTICE.md` и `LICENSE` и дайте ссылку на исходник той версии, которую собрали. Изменённый движок — только с публикацией своих изменений.

## Используется при сборке

| Проект | Лицензия | Для чего |
|---|---|---|
| [genshin-db](https://github.com/theBowja/genshin-db) | MIT | игровые данные: статы, таланты, материалы |
| [Astro](https://astro.build) | MIT | генератор сайта |
| [Pagefind](https://pagefind.app) | MIT | поиск |

Остальные npm-зависимости — под своими лицензиями, см. `package.json` и `node_modules/*/LICENSE`.

## Данные и изображения

- Genshin Impact, игровые тексты, изображения и данные © HoYoverse. GenshinFlex — неофициальный фанатский проект и с HoYoverse не связан.
- Изображения персонажей и оружия берутся с enka.network и HoYoLAB.
- Витрины игроков по UID — через API enka.network; история молитв — через API HoYoverse по ссылке игрока. Ничего из этого не хранится в репозитории.
