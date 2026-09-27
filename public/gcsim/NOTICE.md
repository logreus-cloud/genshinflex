# gcsim в браузере GenshinFlex

`gcsim.wasm.gz` — движок боевого симулятора [gcsim](https://github.com/genshinsim/gcsim), собранный в WebAssembly **без изменений** исходного кода. Сайт GenshinFlex запускает его в отдельном Web Worker и обменивается с ним только сообщениями (конфиг команды на входе, результат симуляции на выходе).

## Лицензия

- **gcsim** — © The gcsim contributors, **GNU Affero General Public License v3.0**, полный текст — [`LICENSE`](LICENSE). До v2.47.2 проект был под MIT; с 2026-09-19 весь проект — под AGPL-3.0.
- **`wasm_exec.js`** — стандартный загрузчик WebAssembly из Go 1.27.0, © The Go Authors, BSD-3-Clause, текст — [`LICENSE-go`](LICENSE-go).

Остальной код GenshinFlex распространяется под MIT и в этот каталог не входит.

## Исходный код (Corresponding Source)

- Репозиторий: https://github.com/genshinsim/gcsim
- Версия: тег `v2.47.6`, коммит `3d48bd5044b2841d840d59888b48f4483252ff8d`
- Исходник этой версии: https://github.com/genshinsim/gcsim/tree/3d48bd5044b2841d840d59888b48f4483252ff8d

Сборка (Go 1.27.0):

```bash
git clone https://github.com/genshinsim/gcsim && cd gcsim
git checkout 3d48bd5044b2841d840d59888b48f4483252ff8d
GOOS=js GOARCH=wasm go build -trimpath -o gcsim.wasm ./cmd/wasm
gzip -9 -c gcsim.wasm > gcsim.wasm.gz
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
```

Контрольные суммы SHA-256:

- `gcsim.wasm` (распакованный): `75288a81263522375ba0fd27861a2f2f56647e36030f7f97603bd35fbfa65ddc`
- `gcsim.wasm.gz`: `d3b89137fb16f82fda47b31ebb7eb14088d22c17f511a432d3f1ee1fa6462bb2`

При обновлении движка на новую версию обновите тег, коммит и суммы в этом файле.
