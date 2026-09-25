# Полные арты оружия (с баннера) вместо квадратных иконок: в иконке игра обрезает длинное оружие.
# Качаем UI_Gacha_EquipIcon_* с enka.network, обрезаем прозрачные поля, уменьшаем и кладём в public/img/weapons/<slug>.webp.
# Уже скачанные не трогаем; список оружия с артом — src/data/generated/weapon-art.json.
# Запуск: python scripts/import-weapon-art.py [--force]
import json, sys, io, pathlib, urllib.request
from PIL import Image

root = pathlib.Path(__file__).resolve().parent.parent
out = root / 'public/img/weapons'
out.mkdir(parents=True, exist_ok=True)
force = '--force' in sys.argv
weapons = json.loads((root / 'src/data/generated/weapons.json').read_text(encoding='utf-8'))
have, missing = [], []
for w in weapons:
    target = out / f"{w['slug']}.webp"
    if target.exists() and not force:
        have.append(w['slug'])
        continue
    icon = (w.get('icon') or '').rsplit('/', 1)[-1]
    if not icon.startswith('UI_EquipIcon_'):
        missing.append(w['slug'])
        continue
    url = 'https://enka.network/ui/' + icon.replace('UI_EquipIcon_', 'UI_Gacha_EquipIcon_')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'GenshinFlex/1.0'})
        data = urllib.request.urlopen(req, timeout=30).read()
        im = Image.open(io.BytesIO(data)).convert('RGBA')
    except Exception as e:
        missing.append(w['slug'])
        print(f"— {w['slug']}: нет арта ({e})")
        continue
    # Длинное оружие (мечи, копья, луки) кладём по диагонали, как в игровых иконках:
    # в квадратной карточке вертикальный арт превращается в тонкую полоску
    box = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    if box and (box[3] - box[1]) > 1.6 * (box[2] - box[0]):
        im = im.crop(box).rotate(-45, expand=True, resample=Image.BICUBIC)
        box = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    # Обрезаем почти прозрачные поля (тени и ореолы с альфой < 8 не считаем)
    if box:
        im = im.crop(box)
    im.thumbnail((320, 320), Image.LANCZOS)
    im.save(target, 'WEBP', quality=85, method=6)
    have.append(w['slug'])
    print(f"✓ {w['slug']} {im.size[0]}×{im.size[1]}")

(root / 'src/data/generated/weapon-art.json').write_text(json.dumps(sorted(have)), encoding='utf-8')
print(f'артов: {len(have)}, без арта: {len(missing)}' + (f" ({', '.join(missing)})" if missing else ''))
