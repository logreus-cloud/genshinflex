# Отделяем персонажей от фона сплэша моделью rembg, сохраняя исходную прозрачность.
# Берём PNG из папки кадров и кладём PNG с теми же именами в папку результата.
# Нужен pip install rembg[cpu].
# Запуск: python scripts/cut-char-cards.py <in_dir> <out_dir> [--model birefnet-general]
import argparse, pathlib, sys

try:
    from rembg import new_session, remove
except ImportError:
    print('Нужен rembg: pip install rembg[cpu]', file=sys.stderr)
    sys.exit(2)

from PIL import Image, ImageChops

parser = argparse.ArgumentParser()
parser.add_argument('in_dir', type=pathlib.Path)
parser.add_argument('out_dir', type=pathlib.Path)
parser.add_argument('--model', default='birefnet-general')
args = parser.parse_args()

try:
    session = new_session(args.model)
except Exception as e:
    print(f'Не удалось загрузить модель {args.model}: {e}', file=sys.stderr)
    sys.exit(2)

args.out_dir.mkdir(parents=True, exist_ok=True)
made, failed = 0, 0
for source in sorted(args.in_dir.glob('*.png')):
    try:
        with Image.open(source) as original:
            img = original.convert('RGBA')
        mask = remove(img, session=session, only_mask=True).convert('L')
        img.putalpha(ImageChops.darker(img.getchannel('A'), mask))
        img.save(args.out_dir / source.name, 'PNG')
        made += 1
        print(source.name, end=' ', flush=True)
    except Exception as e:
        failed += 1
        print(f'— {source.name}: {e}', file=sys.stderr)

print(f'\nготово: {made}, ошибок {failed}')
if failed:
    sys.exit(1)
