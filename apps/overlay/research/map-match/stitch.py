import argparse
import json
import re
import sys
import time
from pathlib import Path

import cv2
import numpy as np

# match.py лежит рядом; при запуске с -I папки скрипта нет в sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import match


def parse_shot(value):
    folder, separator, box = value.partition("::")
    if not folder:
        raise argparse.ArgumentTypeError("Пустой путь к папке")
    if not separator:
        return Path(folder), None
    try:
        rect = tuple(int(part) for part in box.split(","))
        if len(rect) != 4 or min(rect[:2]) < 0 or min(rect[2:]) <= 0:
            raise ValueError
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Ожидалось ПАПКА::x,y,w,h") from exc
    return Path(folder), rect


def client_view(image, rect):
    if rect is None:
        return image
    x, y, width, height = rect
    if x + width > image.shape[1] or y + height > image.shape[0]:
        raise ValueError("Клиентская область выходит за пределы кадра")
    return image[y:y + height, x:x + width]


def interface_mask(width, height):
    mask = np.full((height, width), 255, np.uint8)
    scale = width / 1920

    def hide(x0, y0, x1, y1):
        x0, x1 = max(0, round(x0)), min(width, round(x1))
        y0, y1 = max(0, round(y0)), min(height, round(y1))
        mask[y0:y1, x0:x1] = 0

    hide(0, 0, width, 110 * scale)
    hide(0, 0, 500 * scale, 380 * scale)
    hide(0, 380 * scale, 110 * scale, 700 * scale)
    hide(0, height - 130 * scale, 130 * scale, height)
    hide(width - 520 * scale, height - 140 * scale, width, height)
    hide(width - 140 * scale, 0, width, 140 * scale)
    mask[:4] = 0
    mask[-4:] = 0
    mask[:, :4] = 0
    mask[:, -4:] = 0
    return mask


def save_mask(path, image, mask):
    debug = image.copy()
    debug[mask == 0] = (debug[mask == 0] * .25).astype(np.uint8)
    match.save_image(path, debug, ".png")


def tile_image(mosaic, left, top, x, y, factor):
    size = 256 * factor
    tile = np.zeros((size, size, 4), np.uint8)
    gx0, gy0 = x * size, y * size
    gx1, gy1 = max(gx0, left), max(gy0, top)
    gx2 = min(gx0 + size, left + mosaic.shape[1])
    gy2 = min(gy0 + size, top + mosaic.shape[0])
    if gx2 <= gx1 or gy2 <= gy1:
        return None
    tile[gy1 - gy0:gy2 - gy0, gx1 - gx0:gx2 - gx0] = mosaic[
        gy1 - top:gy2 - top, gx1 - left:gx2 - left]
    if not np.any(tile[:, :, 3]):
        return None
    if factor == 1:
        return tile
    alpha = tile[:, :, 3].astype(np.float32) / 255
    premult = tile[:, :, :3].astype(np.float32) * alpha[:, :, None]
    alpha = cv2.resize(alpha, (256, 256), interpolation=cv2.INTER_AREA)
    premult = cv2.resize(premult, (256, 256), interpolation=cv2.INTER_AREA)
    result = np.zeros((256, 256, 4), np.uint8)
    valid = alpha > 0
    result[:, :, :3][valid] = np.clip(
        np.rint(premult[valid] / alpha[valid, None]), 0, 255).astype(np.uint8)
    result[:, :, 3] = np.rint(alpha * 255).astype(np.uint8)
    return result if np.any(result[:, :, 3]) else None


def write_tiles(out, mosaic, left, top, zoom):
    for depth in range(4):
        factor = 1 << depth
        size = 256 * factor
        x0, x1 = left // size, (left + mosaic.shape[1] - 1) // size
        y0, y1 = top // size, (top + mosaic.shape[0] - 1) // size
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                tile = tile_image(mosaic, left, top, x, y, factor)
                if tile is not None:
                    match.save_image(out / "tiles" / str(zoom - depth) / f"{x}_{y}.png",
                                     tile, ".png")


def write_coverage(path, count):
    height, width = count.shape
    preview_width = min(width, 2400)
    preview_height = max(1, round(height * preview_width / width))
    small = cv2.resize(count, (preview_width, preview_height),
                       interpolation=cv2.INTER_NEAREST)
    colors = np.array(((0, 0, 0), (128, 0, 0), (0, 180, 0), (0, 220, 255)),
                      dtype=np.uint8)
    match.save_image(path, colors[small], ".png")


GLYPHS = {
    " ": ("00000",) * 7,
    "(": ("00100", "01000", "10000", "10000", "10000", "01000", "00100"),
    ")": ("00100", "00010", "00001", "00001", "00001", "00010", "00100"),
    "а": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "е": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "й": ("01010", "00100", "10001", "10011", "10101", "11001", "10001"),
    "к": ("10001", "10010", "10100", "11000", "10100", "10010", "10001"),
    "л": ("00111", "01001", "10001", "10001", "10001", "10001", "10001"),
    "н": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "о": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "с": ("01111", "10000", "10000", "10000", "10000", "10000", "01111"),
    "т": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "ш": ("10101", "10101", "10101", "10101", "10101", "10101", "11111"),
    "ь": ("10000", "10000", "10000", "11110", "10001", "10001", "11110"),
    "э": ("11110", "00001", "00001", "01111", "00001", "00001", "11110"),
}


def caption(width, label):
    scale = 2 if width >= 400 else 1
    banner = np.full((7 * scale + 12, width, 3), 36, np.uint8)
    for i, letter in enumerate(label):
        x = 8 + i * 6 * scale
        if x + 5 * scale > width:
            break
        glyph = np.array([[int(bit) for bit in row] for row in GLYPHS[letter]],
                         dtype=np.uint8)
        glyph = cv2.resize(glyph, None, fx=scale, fy=scale,
                           interpolation=cv2.INTER_NEAREST)
        banner[6:6 + 7 * scale, x:x + 5 * scale][glyph != 0] = 240
    return banner


def write_compare(path, mosaic, ref, meta, left, top, factor):
    height, width = mosaic.shape[:2]
    preview_width = min(width, 1200)
    preview_height = max(1, round(height * preview_width / width))
    size = (preview_width, preview_height)
    scale = preview_width / width
    alpha = cv2.resize(mosaic[:, :, 3], size, interpolation=cv2.INTER_AREA)
    ours = cv2.resize(mosaic[:, :, :3], size, interpolation=cv2.INTER_AREA)
    cells = ((np.arange(preview_height)[:, None] // 16
              + np.arange(preview_width)[None, :] // 16) % 2)
    checker = np.where(cells == 0, 180, 210).astype(np.float32)
    ours = np.clip(ours.astype(np.float32)
                   + checker[:, :, None] * (1 - alpha[:, :, None] / 255), 0, 255
                   ).astype(np.uint8)
    matrix = np.float64([[factor * scale, 0,
                          (meta["x0"] * 256 * factor - left) * scale],
                         [0, factor * scale,
                          (meta["y0"] * 256 * factor - top) * scale]])
    reference = cv2.warpAffine(ref, matrix, size, flags=cv2.INTER_LINEAR)
    result = np.concatenate((
        np.vstack((caption(preview_width, "наша склейка"), ours)),
        np.vstack((caption(preview_width, "эталон (только локально)"), reference))
    ), axis=1)
    match.save_image(path, result, ".jpg", [cv2.IMWRITE_JPEG_QUALITY, 90])


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cv2.setNumThreads(1)
    parser = argparse.ArgumentParser(description="Склеить карту из скриншотов")
    parser.add_argument("--ref", type=Path, required=True)
    parser.add_argument("--shots", type=parse_shot, nargs="+", required=True)
    parser.add_argument("--only")
    parser.add_argument("--zoom", type=int, default=12)
    parser.add_argument("--out", type=Path, default=match.ROOT / ".cache/map-stitch")
    parser.add_argument("--tiles", action="store_true")
    args = parser.parse_args()
    if args.zoom < 3:
        parser.error("zoom должен быть >= 3")
    try:
        only = re.compile(args.only, re.IGNORECASE) if args.only else None
    except re.error as exc:
        parser.error(f"Неверное регулярное выражение: {exc}")
    started = time.perf_counter()
    args.out.mkdir(parents=True, exist_ok=True)
    ref = match.read_image(args.ref)
    meta = json.loads(args.ref.with_suffix(".json").read_text(encoding="utf-8"))
    if meta["zoom"] != 11:
        parser.error("Нужен эталон уровня z11")
    cache = args.ref.parent / "feat_sift_z11.npz"
    pts, desc, _ = match.get_features(ref, cache, "sift")
    matcher = match.flann_matcher(desc, "sift") if len(desc) >= 2 else None
    factor = 2 ** (args.zoom - 11)
    offset = np.float64([meta["x0"] * 256 * factor, meta["y0"] * 256 * factor])
    jobs = []
    for index, (folder, rect) in enumerate(args.shots):
        if not folder.is_dir():
            parser.error(f"Нет папки: {folder}")
        paths = sorted(path for path in folder.rglob("*")
                       if path.is_file() and path.suffix.casefold() == ".png")
        jobs.extend((index, folder, rect, path) for path in paths
                    if only is None or only.search(path.name))
    records, aligned = [], []
    debugged = set()
    for number, (folder_index, folder, rect, path) in enumerate(jobs, 1):
        start = time.perf_counter()
        kind, layer, _ = match.classify(path)
        row = {"name": path.name, "folder": folder.name, "ok": False,
               "scale_z": None, "inliers": 0, "footprint": None,
               "mask_fraction": None, "reason": None}
        image = None
        try:
            if folder_index not in debugged:
                image = client_view(match.read_image(path), rect)
                first_mask = interface_mask(image.shape[1], image.shape[0])
                save_mask(args.out / "debug" / f"mask_{folder.name}.png",
                          image, first_mask)
                debugged.add(folder_index)
            if kind != "map" or layer != "surface":
                row["reason"] = f"Пропущено: {kind}, {layer}"
            else:
                if image is None:
                    image = client_view(match.read_image(path), rect)
                mask = interface_mask(image.shape[1], image.shape[0])
                row["mask_fraction"] = float(np.count_nonzero(mask) / mask.size)
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                result = match.match_frame(gray, mask, pts, desc, "sift", matcher)
                row["inliers"] = result["inliers"]
                if not result["ok"]:
                    row["reason"] = "Не удалось привязать"
                else:
                    matrix = result["matrix"].astype(np.float64) * factor
                    matrix[:, 2] += offset
                    corners = np.float64([[0, 0], [image.shape[1], 0],
                                          [image.shape[1], image.shape[0]],
                                          [0, image.shape[0]]])
                    footprint = corners @ matrix[:, :2].T + matrix[:, 2]
                    scale_z = result["scale"] * factor
                    row.update(ok=True, scale_z=float(scale_z),
                               footprint=footprint.tolist())
                    aligned.append((path, rect, matrix, footprint, scale_z))
        except Exception as exc:
            row["reason"] = f"{type(exc).__name__}: {exc}"
        row["time_ms"] = (time.perf_counter() - start) * 1000
        records.append(row)
        status = "OK" if row["ok"] else row["reason"]
        print(f"{number:04d} {folder.name}/{path.name}: {status}; "
              f"inliers={row['inliers']}; {row['time_ms']:.0f} мс")
    if not aligned:
        raise SystemExit("Нет привязанных кадров")
    points = np.concatenate([item[3] for item in aligned])
    left, top = np.floor(points.min(axis=0)).astype(int)
    right, bottom = np.ceil(points.max(axis=0)).astype(int)
    width, height = int(right - left), int(bottom - top)
    if width * height > 400_000_000:
        raise ValueError("Холст больше 400 Мпикс; сузьте выбор через --only")
    sums = np.zeros((height, width, 3), np.float32)
    weight = np.zeros((height, width), np.float32)
    count = np.zeros((height, width), np.uint8)
    for path, rect, matrix, footprint, scale_z in aligned:
        image = client_view(match.read_image(path), rect)
        mask = interface_mask(image.shape[1], image.shape[0])
        feather = np.minimum(cv2.distanceTransform(mask, cv2.DIST_L2, 3), 40) / 40
        x0, y0 = np.floor(footprint.min(axis=0)).astype(int) - [left, top]
        x1, y1 = np.ceil(footprint.max(axis=0)).astype(int) - [left, top]
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(width, x1), min(height, y1)
        if x1 <= x0 or y1 <= y0:
            continue
        local = matrix.copy()
        local[:, 2] -= [left + x0, top + y0]
        size = (x1 - x0, y1 - y0)
        interpolation = cv2.INTER_CUBIC if scale_z > 2 else cv2.INTER_LINEAR
        warped = cv2.warpAffine(image, local, size, flags=interpolation)
        warped_mask = cv2.warpAffine(mask, local, size, flags=cv2.INTER_NEAREST)
        warped_feather = cv2.warpAffine(feather, local, size,
                                        flags=cv2.INTER_LINEAR)
        valid = (warped_mask != 0) & (warped_feather > 0)
        q = 1 / max(scale_z, .25) ** 2
        pixel_weight = warped_feather * valid * q
        region = np.s_[y0:y1, x0:x1]
        sums[region] += warped.astype(np.float32) * pixel_weight[:, :, None]
        weight[region] += pixel_weight
        count[region] = np.minimum(count[region] + valid.astype(np.uint8), 3)
    mosaic = np.zeros((height, width, 4), np.uint8)
    covered = 0
    for y in range(0, height, 512):
        ys = slice(y, min(y + 512, height))
        block = mosaic[ys]
        block_weight = weight[ys]
        valid = block_weight > 0
        covered += int(np.count_nonzero(valid))
        block[:, :, :3][valid] = np.clip(
            np.rint(sums[ys][valid] / block_weight[valid, None]), 0, 255
        ).astype(np.uint8)
        block[:, :, 3][valid] = 255
    del sums, weight
    match.save_image(args.out / f"mosaic_z{args.zoom}.png", mosaic, ".png")
    write_coverage(args.out / f"coverage_z{args.zoom}.png", count)
    write_compare(args.out / f"compare_z{args.zoom}.jpg",
                  mosaic, ref, meta, left, top, factor)
    if args.tiles:
        write_tiles(args.out, mosaic, left, top, args.zoom)
    report = {
        "parameters": {"ref": str(args.ref), "shots": [
            str(folder) + ("::" + ",".join(map(str, rect)) if rect else "")
            for folder, rect in args.shots], "only": args.only,
            "zoom": args.zoom, "out": str(args.out), "tiles": args.tiles},
        "canvas": {"width": width, "height": height, "offset_px": [int(left), int(top)]},
        "frames": records, "coverage_fraction": covered / (width * height),
        "time_s": time.perf_counter() - started
    }
    (args.out / "stitch.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Итого: {len(aligned)}/{len(jobs)}; холст {width}×{height}; "
          f"покрытие {100 * report['coverage_fraction']:.1f}%; "
          f"{report['time_s']:.1f} с")


if __name__ == "__main__":
    main()
