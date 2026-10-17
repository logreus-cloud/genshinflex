# gcsim в браузере GenshinFlex

`gcsim.wasm.gz` — движок боевого симулятора [gcsim](https://github.com/genshinsim/gcsim), собранный в WebAssembly **без изменений** исходного кода. Сайт GenshinFlex запускает его в отдельном Web Worker и обменивается с ним только сообщениями (конфиг команды на входе, результат симуляции на выходе).

## Лицензия

- **gcsim** — © The gcsim contributors, **GNU Affero General Public License v3.0**, полный текст — [`LICENSE`](LICENSE). До v2.47.2 проект был под MIT; с 2026-09-19 весь проект — под AGPL-3.0.
- **`wasm_exec.js`** — стандартный загрузчик WebAssembly из Go 1.27.0, © The Go Authors, BSD-3-Clause, текст — [`LICENSE-go`](LICENSE-go).

Остальной код GenshinFlex распространяется под MIT и в этот каталог не входит.

## Исходный код (Corresponding Source)

- Репозиторий: https://github.com/genshinsim/gcsim
- Версия: тег `v2.49.0`, коммит `4eda9fc5f818d7a742f2a967f38fbbde6db84303`
- Исходник этой версии: https://github.com/genshinsim/gcsim/tree/4eda9fc5f818d7a742f2a967f38fbbde6db84303

Сборка (Go 1.27.0):

```bash
git clone https://github.com/genshinsim/gcsim && cd gcsim
git checkout 4eda9fc5f818d7a742f2a967f38fbbde6db84303
GOOS=js GOARCH=wasm go build -trimpath -o gcsim.wasm ./cmd/wasm
gzip -9 -c gcsim.wasm > gcsim.wasm.gz
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
```

Контрольные суммы SHA-256:

- `gcsim.wasm` (распакованный): `6f440f6ca80da36ec7023c4b99271a30d56198fc96e9ceef134d22a9dd3a77d4`
- `gcsim.wasm.gz`: `defb9981cba86ca175e35976b36abc84082ef61fa7368beb254166faa7c5cb04`

При обновлении движка на новую версию обновите тег, коммит и суммы в этом файле.
