import argparse
import json
import math
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np


def read_image(path):
    image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError(f"Не удалось прочитать изображение: {path}")
    return image


def save_jpeg(path, image):
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise ValueError(f"Не удалось записать изображение: {path}")
    encoded.tofile(path)


def load_templates(folder, scales):
    manifest = json.loads((folder / "templates.json").read_text(encoding="utf-8"))
    templates = []
    for item in manifest["templates"]:
        image = read_image(folder / item["file"])
        if image.ndim != 3 or image.shape[2] != 3:
            raise ValueError(f"Шаблон должен быть BGR без альфы: {item['file']}")
        for scale in scales:
            width = max(1, round(image.shape[1] * scale))
            height = max(1, round(image.shape[0] * scale))
            resized = cv2.resize(image, (width, height),
                                 interpolation=cv2.INTER_AREA if scale < 1
                                 else cv2.INTER_LINEAR)
            templates.append({
                "name": item["name"], "type": item["type"],
                "image": resized, "scale": scale,
                "anchor": (item["anchor"][0] * scale,
                           item["anchor"][1] * scale),
                "width": width, "height": height
            })
    if not templates:
        raise ValueError("Нет шаблонов")
    return templates


def find_candidates(mosaic, templates, thresholds, tile):
    height, width = mosaic.shape[:2]
    overlap_x = max(item["width"] for item in templates) - 1
    overlap_y = max(item["height"] for item in templates) - 1
    columns = math.ceil(width / tile)
    rows = math.ceil(height / tile)
    candidates = []
    started = time.perf_counter()
    for row in range(rows):
        for column in range(columns):
            x0, y0 = column * tile, row * tile
            x1, y1 = min(x0 + tile, width), min(y0 + tile, height)
            region = mosaic[y0:min(y1 + overlap_y, height),
                            x0:min(x1 + overlap_x, width)]
            alpha = region[:, :, 3]
            if cv2.countNonZero(alpha) < alpha.size * .01:
                print(f"Тайл {row * columns + column + 1}/{rows * columns}: "
                      f"нет данных; {time.perf_counter() - started:.1f} с",
                      flush=True)
                continue
            bgr = np.ascontiguousarray(region[:, :, :3])
            integral = None
            before = len(candidates)
            for item in templates:
                tw, th = item["width"], item["height"]
                if tw > bgr.shape[1] or th > bgr.shape[0]:
                    continue
                scores = cv2.matchTemplate(bgr, item["image"],
                                           cv2.TM_CCOEFF_NORMED)
                scores = scores[:y1 - y0, :x1 - x0]
                peaks = cv2.dilate(scores, np.ones((3, 3), np.uint8))
                yy, xx = np.nonzero((scores >= thresholds[item["type"]])
                                    & (scores >= peaks))
                if not len(xx):
                    continue
                if integral is None:
                    integral = cv2.integral((alpha == 0).astype(np.uint8))
                missing = (integral[yy + th, xx + tw]
                           - integral[yy, xx + tw]
                           - integral[yy + th, xx]
                           + integral[yy, xx])
                valid = missing <= th * tw * .1
                for x, y in zip(xx[valid], yy[valid]):
                    candidates.append({
                        "type": item["type"], "template": item["name"],
                        "scale": item["scale"], "score": float(scores[y, x]),
                        "cx": x0 + int(x) + item["anchor"][0],
                        "cy": y0 + int(y) + item["anchor"][1],
                        "width": tw
                    })
            print(f"Тайл {row * columns + column + 1}/{rows * columns}: "
                  f"+{len(candidates) - before} кандидатов; "
                  f"{time.perf_counter() - started:.1f} с", flush=True)
    return candidates


def suppress(candidates):
    cell = 64
    radius = max(20, max((item["width"] * .6 for item in candidates), default=0))
    reach = math.ceil(radius / cell)
    grid = defaultdict(list)
    kept = []
    for item in sorted(candidates, key=lambda candidate: candidate["score"],
                       reverse=True):
        gx = math.floor(item["cx"] / cell)
        gy = math.floor(item["cy"] / cell)
        duplicate = False
        for dy in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                for other in grid[gx + dx, gy + dy]:
                    distance = (item["cx"] - other["cx"]) ** 2 + (
                        item["cy"] - other["cy"]) ** 2
                    limit = (.6 * max(item["width"], other["width"])
                             if item["type"] == other["type"] else 20)
                    if distance < limit ** 2:
                        duplicate = True
                        break
                if duplicate:
                    break
            if duplicate:
                break
        if not duplicate:
            kept.append(item)
            grid[gx, gy].append(item)
    return kept


def write_reviews(out, mosaic, markers, offset, kinds):
    height, width = mosaic.shape[:2]
    for kind in kinds:
        found = sorted((item for item in markers if item["type"] == kind),
                       key=lambda item: item["score"])
        for start in range(0, len(found), 400):
            batch = found[start:start + 400]
            columns = min(20, len(batch))
            rows = math.ceil(len(batch) / columns)
            sheet = np.full((rows * 148, columns * 128, 3), 36, np.uint8)
            for index, item in enumerate(batch):
                x = round(item["cx"]) - 32
                y = round(item["cy"]) - 32
                crop = np.full((64, 64, 3), 36, np.uint8)
                x0, y0 = max(x, 0), max(y, 0)
                x1, y1 = min(x + 64, width), min(y + 64, height)
                if x1 > x0 and y1 > y0:
                    crop[y0 - y:y1 - y, x0 - x:x1 - x] = mosaic[
                        y0:y1, x0:x1, :3]
                col, row = index % columns, index // columns
                px, py = col * 128, row * 148
                sheet[py:py + 128, px:px + 128] = cv2.resize(
                    crop, (128, 128), interpolation=cv2.INTER_NEAREST)
                cv2.drawMarker(sheet, (px + 64, py + 64), (0, 255, 255),
                               cv2.MARKER_CROSS, 10, 1)
                cv2.putText(sheet, f"{item['score']:.3f}", (px + 5, py + 143),
                            cv2.FONT_HERSHEY_SIMPLEX, .45, (240, 240, 240), 1,
                            cv2.LINE_AA)
            suffix = f"_{start // 400 + 1}" if len(found) > 400 else ""
            save_jpeg(out / f"review_{kind}{suffix}.jpg", sheet)


def write_overview(path, mosaic, markers):
    height, width = mosaic.shape[:2]
    preview_width = min(width, 3000)
    preview_height = max(1, round(height * preview_width / width))
    preview = cv2.resize(mosaic, (preview_width, preview_height),
                         interpolation=cv2.INTER_AREA)[:, :, :3].copy()
    colors = {"waypoint": (255, 180, 0), "statue": (0, 255, 255),
              "domain": (255, 0, 255)}
    for item in markers:
        point = (round(item["cx"] * preview_width / width),
                 round(item["cy"] * preview_height / height))
        cv2.circle(preview, point, 4, colors.get(item["type"], (0, 255, 0)),
                   -1, cv2.LINE_AA)
    save_jpeg(path, preview)


def write_histogram(path, markers, kinds):
    lines = []
    for kind in kinds:
        counts = [0] * 20
        for item in markers:
            if item["type"] == kind:
                counts[min(19, max(0, int(item["score"] * 20)))] += 1
        lines.append(f"{kind}:")
        lines.extend(f"  {index * .05:.2f}–{(index + 1) * .05:.2f}: {count}"
                     for index, count in enumerate(counts))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_sql(path, markers, kinds):
    counts = Counter(item["type"] for item in markers)
    lines = ["-- " + ", ".join(f"{kind}: {counts[kind]}" for kind in kinds)]
    for start in range(0, len(markers), 500):
        batch = markers[start:start + 500]
        lines.append(
            "insert into public.map_markers (layer, type, x, y, status) values")
        values = []
        for item in batch:
            kind = item["type"].replace("'", "''")
            values.append(f"('surface', '{kind}', {item['x']:.1f}, "
                          f"{item['y']:.1f}, 'approved')")
        lines.append(",\n".join(values) + ";")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Найти иконки на склеенной карте")
    parser.add_argument("--mosaic", type=Path, required=True)
    parser.add_argument("--stitch", type=Path, required=True)
    parser.add_argument("--templates", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--scales", default="0.95,1.0,1.05")
    parser.add_argument("--threshold")
    parser.add_argument("--tile", type=int, default=2048)
    parser.add_argument("--sql", action="store_true")
    args = parser.parse_args()
    if args.tile <= 0:
        parser.error("tile должен быть положительным")
    try:
        scales = tuple(float(value) for value in args.scales.split(","))
        if not scales or any(not math.isfinite(value) or value <= 0
                             for value in scales):
            raise ValueError
    except ValueError:
        parser.error("scales: ожидаются положительные числа через запятую")
    started = time.perf_counter()
    templates = load_templates(args.templates, scales)
    kinds = sorted({item["type"] for item in templates})
    thresholds = dict.fromkeys(kinds, .8)
    if args.threshold:
        try:
            for entry in args.threshold.split(","):
                kind, value = entry.split("=")
                threshold = float(value)
                if kind not in thresholds or not math.isfinite(threshold) or not 0 <= threshold <= 1:
                    raise ValueError
                thresholds[kind] = threshold
        except ValueError:
            parser.error("threshold: ожидаются type=число от 0 до 1 через запятую")
    mosaic = read_image(args.mosaic)
    if mosaic.ndim != 3 or mosaic.shape[2] != 4:
        parser.error("Нужна мозаика BGRA")
    canvas = json.loads(args.stitch.read_text(encoding="utf-8"))["canvas"]
    if (canvas["width"], canvas["height"]) != (mosaic.shape[1], mosaic.shape[0]):
        parser.error("Размер мозаики не совпадает со stitch.json")
    offset = canvas["offset_px"]
    print(f"Мозаика {mosaic.shape[1]}×{mosaic.shape[0]}; "
          f"шаблонов с масштабами: {len(templates)}", flush=True)
    markers = suppress(find_candidates(mosaic, templates, thresholds, args.tile))
    for item in markers:
        item["x"] = round((item["cx"] + offset[0]) * 2) / 2
        item["y"] = round((item["cy"] + offset[1]) * 2) / 2
    counts = Counter(item["type"] for item in markers)
    args.out.mkdir(parents=True, exist_ok=True)
    report = {
        "source": str(args.mosaic),
        "count": {kind: counts[kind] for kind in kinds},
        "markers": [{key: item[key] for key in
                     ("type", "x", "y", "score", "template", "scale")}
                    for item in markers]
    }
    (args.out / "icons.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_reviews(args.out, mosaic, markers, offset, kinds)
    write_overview(args.out / "overview.jpg", mosaic, markers)
    write_histogram(args.out / "histogram.txt", markers, kinds)
    if args.sql:
        write_sql(args.out / "markers.sql", markers, kinds)
    print(f"Итого: {len(markers)}; " +
          ", ".join(f"{kind}: {counts[kind]}" for kind in kinds) +
          f"; {time.perf_counter() - started:.1f} с")


if __name__ == "__main__":
    main()
