# gcsim в браузере GenshinFlex

`gcsim.wasm.gz` — движок боевого симулятора [gcsim](https://github.com/genshinsim/gcsim), собранный в WebAssembly **без изменений** исходного кода. Сайт GenshinFlex запускает его в отдельном Web Worker и обменивается с ним только сообщениями (конфиг команды на входе, результат симуляции на выходе).

## Лицензия

- **gcsim** — © The gcsim contributors, **GNU Affero General Public License v3.0**, полный текст — [`LICENSE`](LICENSE). До v2.47.2 проект был под MIT; с 2026-09-19 весь проект — под AGPL-3.0.
- **`wasm_exec.js`** — стандартный загрузчик WebAssembly из Go 1.27.0, © The Go Authors, BSD-3-Clause, текст — [`LICENSE-go`](LICENSE-go).

Остальной код GenshinFlex распространяется под MIT и в этот каталог не входит.

## Исходный код (Corresponding Source)

- Репозиторий: https://github.com/genshinsim/gcsim
- Версия: тег `v2.48.8`, коммит `1f9c1f2e9698239a24b44e38a21358a00fd16bff`
- Исходник этой версии: https://github.com/genshinsim/gcsim/tree/1f9c1f2e9698239a24b44e38a21358a00fd16bff

Сборка (Go 1.27.0):

```bash
git clone https://github.com/genshinsim/gcsim && cd gcsim
git checkout 1f9c1f2e9698239a24b44e38a21358a00fd16bff
GOOS=js GOARCH=wasm go build -trimpath -o gcsim.wasm ./cmd/wasm
gzip -9 -c gcsim.wasm > gcsim.wasm.gz
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
```

Контрольные суммы SHA-256:

- `gcsim.wasm` (распакованный): `ef043a1a9d404cb860704a533683db948a9867594c9efd77b125cbbe7db4c072`
- `gcsim.wasm.gz`: `ce99e8917c786979a7e44d75438dbe9c3d28dc69fdb1389f639969b3933c8ae3`

При обновлении движка на новую версию обновите тег, коммит и суммы в этом файле.
