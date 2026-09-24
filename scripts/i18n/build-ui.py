# Собирает src/i18n/ui.{en,es}.json из частей перевода и проверяет, что все ключи из кода покрыты
import json, runpy, pathlib, re
here = pathlib.Path(__file__).parent
rows = []
for part in sorted(here.glob('ui-part*.py')):
    rows += runpy.run_path(str(part))['T']
en = {ru: e for ru, e, s in rows}
es = {ru: s for ru, e, s in rows}
dupes = [ru for ru in en if sum(1 for r in rows if r[0] == ru) > 1]
root = here.parent.parent
json.dump(en, open(root / 'src/i18n/ui.en.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
json.dump(es, open(root / 'src/i18n/ui.es.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
# Ключи из кода: литералы t('…')
keys = set()
pat = re.compile(r"\bt\('((?:[^'\\]|\\.)*)'")
for f in list((root / 'src').rglob('*.astro')) + list((root / 'src').rglob('*.ts')):
    for m in pat.finditer(f.read_text(encoding='utf-8')):
        k = m.group(1).replace("\\'", "'")
        if re.search('[А-Яа-яЁё]', k): keys.add(k)
missing = sorted(keys - set(en))
# Плейсхолдеры должны совпадать
bad = [ru for ru in en if set(re.findall(r'\{\w+\}', ru)) != set(re.findall(r'\{\w+\}', en[ru])) or set(re.findall(r'\{\w+\}', ru)) != set(re.findall(r'\{\w+\}', es[ru]))]
print(f'строк: {len(en)}, дубли: {dupes}, не переведено из кода: {len(missing)}, плейсхолдеры не совпадают: {bad}')
for k in missing: print('  -', k)
