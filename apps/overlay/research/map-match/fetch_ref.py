# Тайлы Kongying нужны только для локальных замеров: лицензии на данные нет, в репо и прод их не кладём.

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[4]
BASE = "https://assets.yuanshen.site/tiles_twt672"
USER_AGENT = "GenshinFlex-research/0.1"


def tile_url(zoom, x, y):
    return f"{BASE}/{zoom}/{x}_{y}.png"


def request_tile(zoom, x, y, method):
    for attempt in range(3):
        try:
            request = Request(tile_url(zoom, x, y), headers={"User-Agent": USER_AGENT}, method=method)
            with urlopen(request, timeout=20) as response:
                return response.read() if method == "GET" else True
        except HTTPError as exc:
            if exc.code == 404:
                return None if method == "GET" else False
            if attempt == 2:
                raise
        except OSError:
            if attempt == 2:
                raise
        time.sleep(attempt + 1)


def read_image(path):
    image = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Не удалось прочитать {path}")
    return image


def valid_tile(path):
    try:
        return read_image(path).shape[:2] == (256, 256)
    except (OSError, ValueError, cv2.error):
        return False


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Скачать и склеить эталонные тайлы")
    parser.add_argument("--zoom", type=int, default=11)
    parser.add_argument("--out", type=Path, default=ROOT / ".cache/map-ref")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    if args.zoom < 10 or args.workers < 1:
        parser.error("Нужны zoom >= 10 и workers >= 1")
    args.out.mkdir(parents=True, exist_ok=True)
    index_path = args.out / f"tiles_z{args.zoom}.json"
    if index_path.exists():
        tiles = [tuple(item) for item in json.loads(index_path.read_text(encoding="utf-8"))]
    else:
        limit = 16 << (args.zoom - 10)
        candidates = ((x, y) for y in range(-limit, limit + 1) for x in range(-limit, limit + 1))

        def exists(tile):
            return tile, request_tile(args.zoom, *tile, "HEAD")

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            tiles = [tile for tile, found in pool.map(exists, candidates) if found]
        index_path.write_text(json.dumps(tiles), encoding="utf-8")
    if not tiles:
        raise RuntimeError("Тайлы не найдены")
    tile_dir = args.out / "tiles" / f"z{args.zoom}"
    tile_dir.mkdir(parents=True, exist_ok=True)

    def download(tile):
        x, y = tile
        target = tile_dir / f"{x}_{y}.png"
        if not target.exists() or not valid_tile(target):
            data = request_tile(args.zoom, x, y, "GET")
            if data is None:
                raise RuntimeError(f"Тайл {x}_{y} исчез после поиска")
            temporary = target.with_suffix(".png.tmp")
            try:
                temporary.write_bytes(data)
                if not valid_tile(temporary):
                    raise ValueError(f"Повреждённый тайл: {x}_{y}")
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        return tile, target

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        files = list(pool.map(download, tiles))
    x0 = min(x for x, y in tiles)
    y0 = min(y for x, y in tiles)
    width = (max(x for x, y in tiles) - x0 + 1) * 256
    height = (max(y for x, y in tiles) - y0 + 1) * 256
    mosaic = np.zeros((height, width, 3), np.uint8)
    for (x, y), path in files:
        tile = read_image(path)
        if tile.shape[:2] != (256, 256):
            raise ValueError(f"Неверный размер тайла: {path}")
        row, col = (y - y0) * 256, (x - x0) * 256
        mosaic[row:row + 256, col:col + 256] = tile
    output = args.out / f"ref_z{args.zoom}.png"
    ok, data = cv2.imencode(".png", mosaic)
    if not ok:
        raise RuntimeError("Не удалось закодировать мозаику")
    data.tofile(output)
    metadata = {"zoom": args.zoom, "tile": 256, "x0": x0, "y0": y0,
                "width": width, "height": height, "source": "tiles_twt672"}
    output.with_suffix(".json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Склеено {len(files)} тайлов: {output}")


if __name__ == "__main__":
    main()
