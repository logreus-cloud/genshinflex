import argparse
import json
import re
import shutil
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
    hide(width - 140 * scale, 430 * scale, width, 640 * scale)
    mask[:4] = 0
    mask[-4:] = 0
    mask[:, :4] = 0
    mask[:, -4:] = 0
    return cv2.erode(mask, np.ones((5, 5), np.uint8))


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
    tiles = out / "tiles"
    if tiles.is_symlink() or not tiles.resolve().is_relative_to(out.resolve()):
        raise ValueError("Папка tiles вне --out")
    if tiles.exists():
        shutil.rmtree(tiles)
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


def align_gain(warped, sums, weight, overlap):
    source = np.clip(np.rint(warped[overlap]), 0, 255).astype(np.uint8)
    target = (sums[overlap] if weight is None
              else sums[overlap] / weight[overlap, None])
    target = np.clip(np.rint(target), 0, 255).astype(np.uint8)
    source = cv2.cvtColor(source.reshape(-1, 1, 3),
                          cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float64)
    target = cv2.cvtColor(target.reshape(-1, 1, 3),
                          cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float64)
    light = source[:, 0]
    reference = target[:, 0]
    centered = light - light.mean()
    variance = np.sum(centered ** 2)
    a = float(np.clip(np.sum(centered * (reference - reference.mean())) / variance,
                      .7, 1.4)) if variance else 1.0
    b = float(reference.mean() - a * light.mean())
    shift_a = float(np.mean(target[:, 1] - source[:, 1]))
    shift_b = float(np.mean(target[:, 2] - source[:, 2]))
    lab = cv2.cvtColor(np.clip(np.rint(warped), 0, 255).astype(np.uint8),
                       cv2.COLOR_BGR2LAB).astype(np.float32)
    lab[:, :, 0] = np.clip(lab[:, :, 0] * a + b, 0, 255)
    lab[:, :, 1] = np.clip(lab[:, :, 1] + shift_a, 0, 255)
    lab[:, :, 2] = np.clip(lab[:, :, 2] + shift_b, 0, 255)
    gain = {"L": {"a": a, "b": b}, "A": shift_a, "B": shift_b}
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32), gain


def local_gain(warped, base, alpha, overlap):
    height, width = warped.shape[:2]
    size = (max(1, round(width / 8)), max(1, round(height / 8)))
    numerator = np.zeros((size[1], size[0], 3), np.float32)
    mask = np.zeros((size[1], size[0]), np.float32)
    for y in range(0, height, 512):
        ys = slice(y, min(y + 512, height))
        block_overlap = overlap[ys]
        columns = np.flatnonzero(np.any(block_overlap, axis=0))
        if not len(columns):
            continue
        x0, x1 = columns[0], columns[-1] + 1
        reference = np.zeros_like(warped[ys, x0:x1])
        np.divide(base[ys, x0:x1], alpha[ys, x0:x1, None],
                  out=reference, where=alpha[ys, x0:x1, None] > 0)
        reference = cv2.cvtColor(np.clip(reference / 255, 0, 1),
                                 cv2.COLOR_BGR2LAB)
        frame = cv2.cvtColor(np.clip(warped[ys, x0:x1] / 255, 0, 1),
                             cv2.COLOR_BGR2LAB)
        block_mask = block_overlap.astype(np.float32)
        diff = np.zeros((*block_mask.shape, 3), np.float32)
        diff[:, x0:x1] = (reference - frame) * block_mask[:, x0:x1, None]
        small_y0 = round(y * size[1] / height)
        small_y1 = round(ys.stop * size[1] / height)
        # хвост в несколько строк после округления пуст — его вклад ничтожен
        if small_y1 <= small_y0:
            continue
        small_size = (size[0], small_y1 - small_y0)
        numerator[small_y0:small_y1] = cv2.resize(
            diff, small_size, interpolation=cv2.INTER_AREA)
        mask[small_y0:small_y1] = cv2.resize(
            block_mask, small_size, interpolation=cv2.INTER_AREA)
    sigma = min(height, width) / 48
    numerator = cv2.GaussianBlur(numerator, (0, 0), sigma)
    denominator = cv2.GaussianBlur(mask, (0, 0), sigma)
    correction = numerator / np.maximum(denominator, 1e-6)[:, :, None]
    correction *= np.clip(denominator / .2, 0, 1)[:, :, None]
    correction[:, :, 0] = np.clip(correction[:, :, 0], -40, 40)
    correction[:, :, 1:] = np.clip(correction[:, :, 1:], -15, 15)
    mean_abs_L = float(np.mean(np.abs(correction[:, :, 0][mask > 0])))
    sx, sy = size[0] / width, size[1] / height
    for y in range(0, height, 512):
        block = warped[y:y + 512]
        matrix = np.float32([[sx, 0, (sx - 1) / 2],
                             [0, sy, sy * (y + .5) - .5]])
        field = cv2.warpAffine(correction, matrix,
                               (width, block.shape[0]),
                               flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                               borderMode=cv2.BORDER_REPLICATE)
        lab = cv2.cvtColor(np.clip(block / 255, 0, 1),
                           cv2.COLOR_BGR2LAB)
        lab += field
        lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
        block[:] = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR) * 255
    return warped, mean_abs_L


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
    alpha = cv2.resize(mosaic[:, :, 3], size, interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    ours = cv2.resize(mosaic[:, :, :3], size, interpolation=cv2.INTER_AREA).astype(np.float32)
    cells = ((np.arange(preview_height)[:, None] // 16
              + np.arange(preview_width)[None, :] // 16) % 2)
    checker = np.where(cells == 0, 180, 210).astype(np.float32)
    ours = np.clip(ours * alpha[:, :, None]
                   + checker[:, :, None] * (1 - alpha[:, :, None]), 0, 255
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
    parser.add_argument("--max-scale", type=float, default=.6)
    parser.add_argument("--blend", choices=("layer", "best", "mix"), default="layer")
    parser.add_argument("--gain", dest="gain", action="store_true", default=True)
    parser.add_argument("--no-gain", dest="gain", action="store_false")
    args = parser.parse_args()
    if args.zoom < 3:
        parser.error("zoom должен быть >= 3")
    if not np.isfinite(args.max_scale) or args.max_scale <= 0:
        parser.error("max-scale должен быть положительным конечным числом")
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
               "mask_fraction": None, "gain": None, "reason": None}
        image = None
        try:
            if folder_index not in debugged:
                image = client_view(match.read_image(path), rect)
                first_mask = interface_mask(image.shape[1], image.shape[0])
                save_mask(args.out / "debug" / f"mask_{folder_index + 1}_{folder.name}.png",
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
                    scale_z = result["scale"] * factor
                    row["scale_z"] = float(scale_z)
                    if result["scale"] > args.max_scale:
                        row["reason"] = "Пропущено: масштаб"
                    else:
                        matrix = result["matrix"].astype(np.float64) * factor
                        matrix[:, 2] += offset
                        corners = np.float64([[0, 0], [image.shape[1], 0],
                                              [image.shape[1], image.shape[0]],
                                              [0, image.shape[0]]])
                        footprint = corners @ matrix[:, :2].T + matrix[:, 2]
                        q = 1 / max(scale_z, .25) ** 2
                        row.update(ok=True, footprint=footprint.tolist())
                        aligned.append((path, rect, matrix, footprint, scale_z, q, row))
        except Exception as exc:
            row["reason"] = f"{type(exc).__name__}: {exc}"
        row["time_ms"] = (time.perf_counter() - start) * 1000
        records.append(row)
        status = "OK" if row["ok"] else row["reason"]
        print(f"{number:04d} {folder.name}/{path.name}: {status}; "
              f"inliers={row['inliers']}; {row['time_ms']:.0f} мс")
    parameters = {
        "ref": str(args.ref), "shots": [
            str(folder) + ("::" + ",".join(map(str, rect)) if rect else "")
            for folder, rect in args.shots], "only": args.only,
        "zoom": args.zoom, "out": str(args.out), "tiles": args.tiles,
        "max_scale": args.max_scale, "blend": args.blend, "gain": args.gain
    }
    if not aligned:
        report = {"parameters": parameters, "canvas": None, "frames": records,
                  "coverage_fraction": 0.0, "time_s": time.perf_counter() - started}
        (args.out / "stitch.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        raise SystemExit("Нет привязанных кадров")
    points = np.concatenate([item[3] for item in aligned])
    left, top = np.floor(points.min(axis=0)).astype(int)
    right, bottom = np.ceil(points.max(axis=0)).astype(int)
    width, height = int(right - left), int(bottom - top)
    if width * height > 400_000_000:
        raise ValueError("Холст больше 400 Мпикс; сузьте выбор через --only")
    if args.blend == "layer":
        canvas = np.zeros((height, width, 3), np.float32)
        alpha = np.zeros((height, width), np.float32)
    else:
        sums = np.zeros((height, width, 3), np.float32)
        weight = np.zeros((height, width), np.float32)
    count = np.zeros((height, width), np.uint8)
    for path, rect, matrix, footprint, scale_z, q, row in sorted(
            aligned, key=lambda item: item[5], reverse=args.blend != "layer"):
        image = client_view(match.read_image(path), rect)
        mask = interface_mask(image.shape[1], image.shape[0])
        distance = cv2.distanceTransform(mask, cv2.DIST_L2, 3)
        if args.blend == "layer":
            feather = np.clip(distance / (min(image.shape[:2]) * .12), 0, 1)
            feather = feather * feather * (3 - 2 * feather)
        else:
            # best: побеждает кадр, в котором пиксель ближе к середине — без обрезки, иначе кадры одного масштаба усредняются
            feather = (distance / (min(image.shape[:2]) / 2) if args.blend == "best"
                       else np.minimum(distance, 40) / 40)
        mask = mask.astype(np.float32) / 255
        row["gain"] = {"L": {"a": 1.0, "b": 0.0}, "A": 0.0, "B": 0.0}
        if args.blend == "layer":
            row["gain"].update(local=False, mean_abs_L=0.0)
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
        premult = image.astype(np.float32) * mask[:, :, None]
        warped_premult = cv2.warpAffine(premult, local, size, flags=interpolation)
        warped_mask = cv2.warpAffine(mask, local, size, flags=interpolation)
        warped_feather = cv2.warpAffine(feather, local, size,
                                        flags=cv2.INTER_LINEAR)
        valid = (warped_mask > .5) & (warped_feather > 0)
        warped = np.zeros_like(warped_premult)
        warped[valid] = warped_premult[valid] / warped_mask[valid, None]
        region = np.s_[y0:y1, x0:x1]
        if args.blend == "layer":
            alpha_region = alpha[region]
            canvas_region = canvas[region]
            if args.gain:
                overlap = valid & (alpha_region > .99)
                if np.count_nonzero(overlap) >= 2000:
                    warped, gain = align_gain(warped, canvas_region, alpha_region, overlap)
                    row["gain"].update(gain)
                    warped, mean_abs_L = local_gain(warped, canvas_region, alpha_region, overlap)
                    row["gain"].update(local=True, mean_abs_L=mean_abs_L)
            # край растворяется только поверх основы; над пустым холстом кадр кладётся целиком
            warped_feather = (1 - (1 - warped_feather) * alpha_region) * valid
            canvas_region *= (1 - warped_feather)[:, :, None]
            warped *= warped_feather[:, :, None]
            canvas_region += warped
            warped_feather *= 1 - alpha_region
            alpha_region += warped_feather
        else:
            pixel_weight = warped_feather * valid * q
            if args.blend == "best":
                pixel_weight **= 8
            if args.gain:
                overlap = valid & (weight[region] > 0)
                if np.count_nonzero(overlap) >= 2000:
                    warped, row["gain"] = align_gain(warped, sums[region], weight[region], overlap)
            sums[region] += warped * pixel_weight[:, :, None]
            weight[region] += pixel_weight
        count[region] = np.minimum(count[region] + valid.astype(np.uint8), 3)
    mosaic = np.zeros((height, width, 4), np.uint8)
    covered = 0
    for y in range(0, height, 512):
        ys = slice(y, min(y + 512, height))
        block = mosaic[ys]
        if args.blend == "layer":
            block_alpha = alpha[ys]
            valid = block_alpha > 0
            block[:, :, :3][valid] = np.clip(
                np.rint(canvas[ys][valid] / block_alpha[valid, None]), 0, 255).astype(np.uint8)
            block[:, :, 3] = np.rint(
                np.where(block_alpha > .5, 255, block_alpha * 255)).astype(np.uint8)
        else:
            block_weight = weight[ys]
            valid = block_weight > 0
            block[:, :, :3][valid] = np.clip(
                np.rint(sums[ys][valid] / block_weight[valid, None]), 0, 255
            ).astype(np.uint8)
            block[:, :, 3][valid] = 255
        covered += int(np.count_nonzero(valid))
    if args.blend == "layer":
        del canvas, alpha
    else:
        del sums, weight
    match.save_image(args.out / f"mosaic_z{args.zoom}.png", mosaic, ".png")
    write_coverage(args.out / f"coverage_z{args.zoom}.png", count)
    write_compare(args.out / f"compare_z{args.zoom}.jpg",
                  mosaic, ref, meta, left, top, factor)
    if args.tiles:
        write_tiles(args.out, mosaic, left, top, args.zoom)
    report = {
        "parameters": parameters,
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
