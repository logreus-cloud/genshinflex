# Отделяем персонажей от фона моделью rembg, сохраняя исходную прозрачность.
# Берём PNG из папки кадров и кладём PNG с теми же именами в папку результата.
# Рядом с результатом лежит <имя>.key — отпечаток кадра и модели: если он совпадает, кадр не режем заново
# (прерванный запуск продолжается с места остановки).
# Нужен pip install rembg[cpu].
# Запуск: python scripts/cut-char-cards.py <in_dir> <out_dir> [--model isnet-anime]
import argparse, gc, hashlib, pathlib, sys

try:
    from rembg import new_session, remove
except ImportError:
    print('Нужен rembg: pip install rembg[cpu]', file=sys.stderr)
    sys.exit(2)

from PIL import Image, ImageChops

parser = argparse.ArgumentParser()
parser.add_argument('in_dir', type=pathlib.Path)
parser.add_argument('out_dir', type=pathlib.Path)
parser.add_argument('--model', default='isnet-anime')
args = parser.parse_args()

args.out_dir.mkdir(parents=True, exist_ok=True)


def key_of(source):
    return hashlib.sha1(args.model.encode() + b'\0' + source.read_bytes()).hexdigest()


pending = []
for source in sorted(args.in_dir.glob('*.png')):
    key = key_of(source)
    target = args.out_dir / source.name
    marker = target.with_suffix('.key')
    if target.exists() and marker.exists() and marker.read_text().strip() == key:
        continue
    pending.append((source, target, marker, key))

print(f'вырезать: {len(pending)}, уже готово: {len(list(args.in_dir.glob("*.png"))) - len(pending)}', flush=True)
if not pending:
    sys.exit(0)

try:
    session = new_session(args.model)
except Exception as e:
    print(f'Не удалось загрузить модель {args.model}: {e}', file=sys.stderr)
    sys.exit(2)

made, failed = 0, 0
for source, target, marker, key in pending:
    try:
        with Image.open(source) as original:
            img = original.convert('RGBA')
        mask = remove(img, session=session, only_mask=True).convert('L')
        img.putalpha(ImageChops.darker(img.getchannel('A'), mask))
        img.save(target, 'PNG')
        # Отметку пишем после картинки: оборванная запись не считается готовой
        marker.write_text(key)
        made += 1
        print(source.name, end=' ', flush=True)
    except Exception as e:
        failed += 1
        print(f'— {source.name}: {e}', file=sys.stderr)
    finally:
        gc.collect()

print(f'\nготово: {made}, ошибок {failed}')
if failed:
    sys.exit(1)
