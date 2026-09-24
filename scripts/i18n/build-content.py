# Собирает src/i18n/content.{en,es}.json: автоматические переводы + ручные части, проверяет покрытие
import json, runpy, pathlib
here = pathlib.Path(__file__).parent
root = here.parent.parent
auto = json.load(open(here / 'content-auto.json', encoding='utf-8'))
en, es = dict(auto['en']), dict(auto['es'])
for part in sorted(here.glob('content-part*.py')):
    for ru, e, s in runpy.run_path(str(part))['T']:
        en[ru], es[ru] = e, s
json.dump(en, open(root / 'src/i18n/content.en.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
json.dump(es, open(root / 'src/i18n/content.es.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
need = json.load(open('/tmp/content-manual.json', encoding='utf-8'))
missing = [s for s in need if s not in en]
print(f'строк контента: {len(en)}, не переведено: {len(missing)}')
for s in missing: print('  -', s)
