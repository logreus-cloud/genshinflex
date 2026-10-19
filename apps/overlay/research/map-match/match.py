import argparse
import json
import math
import os
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[4]


def read_image(path):
    image = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Не удалось прочитать {path}")
    return image


def save_image(path, image, ext, params=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    ok, data = cv2.imencode(ext, image, params or [])
    if not ok:
        raise ValueError(f"Не удалось закодировать {path}")
    data.tofile(path)


def make_detector(name):
    if name == "sift":
        return cv2.SIFT_create(nfeatures=6000)
    if name == "orb":
        return cv2.ORB_create(nfeatures=6000)
    return cv2.AKAZE_create()


def get_features(ref, cache, name):
    start = time.perf_counter()
    if cache.exists():
        with np.load(cache, allow_pickle=False) as saved:
            return saved["pts"], saved["desc"], 0.0
    detector = make_detector(name)
    all_pts, all_desc = [], []
    height, width = ref.shape[:2]
    step = 2048 - 256
    ys = [y for y in range(0, height, step) if y == 0 or y - step + 2048 < height]
    xs = [x for x in range(0, width, step) if x == 0 or x - step + 2048 < width]
    for y in ys:
        for x in xs:
            block = ref[y:y + 2048, x:x + 2048]
            gray = cv2.cvtColor(block, cv2.COLOR_BGR2GRAY)
            mask = np.any(block != 0, axis=2).astype(np.uint8) * 255
            keys, desc = detector.detectAndCompute(gray, mask)
            if desc is None:
                continue
            for key, row in zip(keys, desc):
                px, py = key.pt
                if x and px < 128:
                    continue
                if y and py < 128:
                    continue
                if x + 2048 < width and px >= block.shape[1] - 128:
                    continue
                if y + 2048 < height and py >= block.shape[0] - 128:
                    continue
                all_pts.append((x + px, y + py))
                all_desc.append(row)
    pts = np.asarray(all_pts, dtype=np.float32).reshape(-1, 2)
    dtype = np.float32 if name == "sift" else np.uint8
    desc = np.stack(all_desc) if all_desc else np.empty((0, 0), dtype=dtype)
    np.savez_compressed(cache, pts=pts, desc=desc)
    return pts, desc, (time.perf_counter() - start) * 1000


def flann_matcher(desc, name):
    try:
        if name == "sift":
            index = {"algorithm": 1, "trees": 5}
        else:
            index = {"algorithm": 6, "table_number": 12, "key_size": 20, "multi_probe_level": 2}
        matcher = cv2.FlannBasedMatcher(index, {"checks": 64})
        matcher.add([desc])
        matcher.train()
        return matcher
    except (AttributeError, cv2.error):
        return None


def match_frame(gray, mask, pts, desc, name, matcher=None, center=None):
    start = time.perf_counter()
    result = {"ok": False, "inliers": 0, "good": 0, "scale": None, "rot": None,
              "center_ref": None, "reproj_px": None, "matrix": None, "corners_ref": None,
              "detect_ms": 0.0, "match_ms": 0.0, "ransac_ms": 0.0, "total_ms": 0.0}
    detector = make_detector(name)
    keys, query = detector.detectAndCompute(gray, mask)
    result["detect_ms"] = (time.perf_counter() - start) * 1000
    if query is None or len(query) < 2 or len(desc) < 2:
        result["total_ms"] = (time.perf_counter() - start) * 1000
        return result
    tick = time.perf_counter()
    matcher = matcher if matcher is not None else flann_matcher(desc, name)
    try:
        pairs = matcher.knnMatch(query, k=2) if matcher is not None else None
    except (AttributeError, cv2.error):
        pairs = None
    if pairs is None:
        norm = cv2.NORM_L2 if name == "sift" else cv2.NORM_HAMMING
        pairs = cv2.BFMatcher(norm).knnMatch(query, desc, k=2)
    good = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < .75 * pair[1].distance]
    result["good"] = len(good)
    result["match_ms"] = (time.perf_counter() - tick) * 1000
    if len(good) < 3:
        result["total_ms"] = (time.perf_counter() - start) * 1000
        return result
    tick = time.perf_counter()
    src = np.float32([keys[m.queryIdx].pt for m in good])
    dst = np.float32([pts[m.trainIdx] for m in good])
    matrix, inlier_mask = cv2.estimateAffinePartial2D(
        src, dst, method=cv2.RANSAC, ransacReprojThreshold=8,
        maxIters=5000, confidence=0.995
    )
    result["ransac_ms"] = (time.perf_counter() - tick) * 1000
    if matrix is None or inlier_mask is None:
        result["total_ms"] = (time.perf_counter() - start) * 1000
        return result
    inliers = inlier_mask.ravel().astype(bool)
    count = int(inliers.sum())
    scale = math.hypot(matrix[0, 0], matrix[1, 0])
    result["inliers"] = count
    result["scale"] = float(scale)
    result["rot"] = float(math.degrees(math.atan2(matrix[1, 0], matrix[0, 0])))
    if count < 15 or count / len(good) < .15 or not .02 < scale < 50:
        result["total_ms"] = (time.perf_counter() - start) * 1000
        return result
    point = center if center is not None else (gray.shape[1] / 2, gray.shape[0] / 2)
    center_point = np.array([point[0], point[1], 1.0])
    corners = np.float32([[0, 0], [gray.shape[1], 0],
                          [gray.shape[1], gray.shape[0]], [0, gray.shape[0]]])
    predicted = src[inliers] @ matrix[:, :2].T + matrix[:, 2]
    result["reproj_px"] = float(np.median(np.linalg.norm(predicted - dst[inliers], axis=1)))
    result["center_ref"] = (matrix @ center_point).tolist()
    result["corners_ref"] = cv2.transform(corners[None], matrix)[0].tolist()
    result["matrix"] = matrix
    result["ok"] = True
    result["total_ms"] = (time.perf_counter() - start) * 1000
    return result


def classify(path):
    name = path.name.casefold()
    kind = "minimap" if "миникарт" in name or "minimap" in name else "map"
    layer = "underground" if any(word in name for word in (
        "подзем", "энканом", "разлом", "underground", "chasm", "enkanomiya"
    )) else "surface"
    zoom = next((label for label, words in (
        ("close", ("приближ", "close")),
        ("medium", ("средне", "medium")),
        ("wide", ("отдал", "wide"))
    ) if any(word in name for word in words)), "other")
    return kind, layer, zoom


def prepare(image, kind, circle):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if kind == "map":
        return image, gray, None, (gray.shape[1] / 2, gray.shape[0] / 2)
    scale = image.shape[0] / 1080
    cx, cy, r = [value * scale for value in circle]
    x0 = max(0, int(round(cx - r)))
    y0 = max(0, int(round(cy - r)))
    x1 = min(image.shape[1], int(round(cx + r)))
    y1 = min(image.shape[0], int(round(cy + r)))
    if x1 <= x0 or y1 <= y0:
        raise ValueError("Круг миникарты вне кадра")
    crop = image[y0:y1, x0:x1]
    mask = np.zeros(crop.shape[:2], np.uint8)
    cv2.circle(mask, (int(round(cx - x0)), int(round(cy - y0))), int(round(.88 * r)), 255, -1)
    return crop, gray[y0:y1, x0:x1], mask, (cx - x0, cy - y0)


def synthetic_frame(ref, rng):
    height, width = ref.shape[:2]
    valid = np.any(ref != 0, axis=2)
    for _ in range(1000):
        cx = int(rng.integers(64, width - 64))
        cy = int(rng.integers(64, height - 64))
        if valid[cy - 64:cy + 65, cx - 64:cx + 65].mean() > .95:
            break
    else:
        ys, xs = np.where(valid)
        if len(xs) == 0:
            raise ValueError("В эталоне нет непустых пикселей")
        i = int(rng.integers(len(xs)))
        cx, cy = int(xs[i]), int(ys[i])
    scale = float(np.exp(rng.uniform(math.log(.5), math.log(3))))
    matrix = np.float32([[scale, 0, cx - scale * 960], [0, scale, cy - scale * 540]])
    frame = cv2.warpAffine(ref, matrix, (1920, 1080), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
    noise = rng.normal(0, 4, frame.shape)
    frame = np.clip(
        frame.astype(np.float32) * rng.uniform(.85, 1.15) + rng.uniform(-38.25, 38.25) + noise,
        0, 255
    ).astype(np.uint8)
    for _ in range(int(rng.integers(30, 61))):
        x, y = int(rng.integers(1920)), int(rng.integers(1080))
        radius = int(rng.integers(10, 26))
        color = tuple(int(v) for v in rng.integers(30, 225, size=3))
        cv2.circle(frame, (x, y), radius, color, -1)
        cv2.circle(frame, (x, y), radius, (235, 235, 235), 2)
    for _ in range(int(rng.integers(3, 7))):
        x, y = int(rng.integers(1870)), int(rng.integers(1050))
        cv2.rectangle(frame, (x, y), (x + int(rng.integers(50, 180)), y + int(rng.integers(10, 30))),
                      (230, 230, 230), -1)
    return frame, (cx, cy)


def run_local(image, kind, circle, polygon, pts, desc, name, global_center, half=False):
    start = time.perf_counter()
    _, gray, mask, center = prepare(image, kind, circle)
    if half:
        original_height, original_width = gray.shape
        gray = cv2.resize(gray, None, fx=.5, fy=.5, interpolation=cv2.INTER_AREA)
        mask = None
        center = (center[0] * gray.shape[1] / original_width,
                  center[1] * gray.shape[0] / original_height)
    low = polygon.min(axis=0)
    high = polygon.max(axis=0)
    half_size = (high - low) * .5
    roi = ((pts[:, 0] >= low[0] - half_size[0]) & (pts[:, 0] <= high[0] + half_size[0])
           & (pts[:, 1] >= low[1] - half_size[1]) & (pts[:, 1] <= high[1] + half_size[1]))
    local_pts, local_desc = pts[roi], desc[roi]
    result = match_frame(gray, mask, local_pts, local_desc, name, center=center)
    cleaned = clean_match(result, global_center)
    cleaned["total_ms"] = (time.perf_counter() - start) * 1000
    return cleaned


def run_one(image, record, pts, desc, matcher, args, meta, truth=None):
    start = time.perf_counter()
    view, gray, mask, center = prepare(image, record["kind"], args.minimap_circle)
    global_result = match_frame(gray, mask, pts, desc, args.detector, matcher, center)
    for key in ("ok", "inliers", "good", "scale", "rot", "center_ref", "reproj_px"):
        record[key] = global_result[key]
    if global_result["ok"]:
        x, y = global_result["center_ref"]
        factor = 2 ** (13 - meta["zoom"])
        record["center_z13"] = [(x + meta["x0"] * 256) * factor, (y + meta["y0"] * 256) * factor]
        record["corners_ref"] = global_result["corners_ref"]
        if truth is not None:
            record["error_ref_px"] = math.dist((x, y), truth)
            record["error_z13_px"] = record["error_ref_px"] * factor
    global_result["total_ms"] = (time.perf_counter() - start) * 1000
    for key in ("detect_ms", "match_ms", "ransac_ms", "total_ms"):
        record[f"global_{key}"] = global_result[key]
    if not global_result["ok"]:
        return view, global_result
    polygon = np.asarray(global_result["corners_ref"])
    record["local_full"] = run_local(image, record["kind"], args.minimap_circle, polygon,
                                     pts, desc, args.detector, global_result["center_ref"])
    if record["kind"] == "map":
        record["local_half"] = run_local(image, record["kind"], args.minimap_circle, polygon,
                                         pts, desc, args.detector, global_result["center_ref"], half=True)
    record["local_vs_global_px"] = record["local_full"]["vs_global_px"]
    return view, global_result


def clean_match(result, global_center):
    return {"ok": result["ok"], "inliers": result["inliers"], "good": result["good"],
            "center_ref": result["center_ref"], "detect_ms": result["detect_ms"],
            "match_ms": result["match_ms"], "ransac_ms": result["ransac_ms"],
            "total_ms": result["total_ms"],
            "vs_global_px": math.dist(result["center_ref"], global_center) if result["ok"] else None}


def write_debug(path, view, ref, result):
    if result["ok"]:
        aligned = cv2.warpAffine(ref, result["matrix"], (view.shape[1], view.shape[0]),
                                 flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
        image = cv2.addWeighted(view, .5, aligned, .5, 0)
    else:
        image = view.copy()
        cv2.putText(image, "FAIL", (20, 45), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (0, 0, 255), 3)
    save_image(path, image, ".jpg", [cv2.IMWRITE_JPEG_QUALITY, 85])


def write_footprints(path, ref, records):
    ratio = min(1.0, 2400 / ref.shape[1])
    canvas = cv2.resize(ref, None, fx=ratio, fy=ratio, interpolation=cv2.INTER_AREA)
    colors = {"close": (0, 220, 0), "medium": (0, 220, 220),
              "wide": (0, 0, 220), "other": (255, 220, 0)}
    for row in records:
        if not row["ok"]:
            continue
        corners = np.rint(np.asarray(row["corners_ref"]) * ratio).astype(np.int32)
        cv2.polylines(canvas, [corners], True, colors[row["zoom"]], 2)
        x, y = corners[0]
        cv2.putText(canvas, str(row["number"]), (int(x), int(y)),
                    cv2.FONT_HERSHEY_SIMPLEX, .6, (255, 255, 255), 2)
    save_image(path, canvas, ".jpg", [cv2.IMWRITE_JPEG_QUALITY, 85])


def median(values):
    values = [value for value in values if value is not None]
    return statistics.median(values) if values else None


def fmt(value, digits=1):
    return f"{value:.{digits}f}" if value is not None else "—"


def local_ms(row, kind):
    local = row.get(kind)
    return local["total_ms"] if local else None


def local_success(rows, kind):
    attempts = [row[kind] for row in rows if row.get(kind)]
    return f"{sum(item['ok'] for item in attempts)}/{len(attempts)}" if attempts else "—"


def write_report(out, meta, ref, pts, feature_ms, args, records):
    report = {"parameters": {"detector": args.detector, "ref_zoom": meta["zoom"],
              "ref_width": ref.shape[1], "ref_height": ref.shape[0],
              "ref_points": len(pts), "feature_build_ms": feature_ms,
              "cpu_count": os.cpu_count(), "opencv": cv2.__version__},
              "records": records}
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# Сопоставление карты — #43", "",
             f"Детектор: {args.detector}; уровень эталона: {meta['zoom']}; мозаика: {ref.shape[1]}×{ref.shape[0]} px.",
             f"Точек эталона: {len(pts)}; построение признаков: {fmt(feature_ms)} мс; CPU: {os.cpu_count()}; OpenCV: {cv2.__version__}.", "",
             "## Группы", "",
             "| Набор | Вид | Слой | Масштаб | Кадров | Успешных | Inliers | Репроекция, px | Глобально, мс | Локально, мс | Половина, мс | Успех локально | Успех половины |",
             "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    groups = defaultdict(list)
    for row in records:
        groups[(row["set"], row["kind"], row["layer"], row["zoom"])].append(row)
    for key, items in sorted(groups.items()):
        good = [row for row in items if row["ok"]]
        values = [*key, str(len(items)), str(len(good)),
                  fmt(median([r["inliers"] for r in good]), 0),
                  fmt(median([r["reproj_px"] for r in good])),
                  fmt(median([r["global_total_ms"] for r in items])),
                  fmt(median([local_ms(r, "local_full") for r in good])),
                  fmt(median([local_ms(r, "local_half") for r in good])),
                  local_success(good, "local_full"),
                  local_success(good, "local_half")]
        lines.append("| " + " | ".join(values) + " |")
    synthetic = [r for r in records if r["is_synthetic"]]
    good_synthetic = [r for r in synthetic if r["ok"]]
    errors = [r["error_ref_px"] for r in good_synthetic if r["error_ref_px"] is not None]
    factor = 2 ** (13 - meta["zoom"])
    lines += ["", "## Синтетика", "",
              f"Успех: {len(good_synthetic)}/{len(synthetic)} ({fmt(100 * len(good_synthetic) / len(synthetic) if synthetic else None)}%).",
              f"Ошибка, px эталона: медиана {fmt(median(errors))}, p95 {fmt(float(np.percentile(errors, 95)) if errors else None)}.",
              f"Ошибка, px z13: медиана {fmt(median([e * factor for e in errors]))}, p95 {fmt(float(np.percentile(errors, 95)) * factor if errors else None)}.",
              f"Время глобальное, мс: {fmt(median([r['global_total_ms'] for r in synthetic]))}.", "",
              "## Оценка нагрузки", "",
              "| Разрешение | Успех локально | FPS | Одно ядро, % | Всех ядер, % |",
              "| --- | ---: | ---: | ---: | ---: |"]
    cpu = os.cpu_count() or 1
    for key, label in (("local_full", "Полное"), ("local_half", "Половина")):
        attempts = [r[key] for r in records if r["ok"] and r.get(key)]
        sample = median([item["total_ms"] for item in attempts])
        success = sum(item["ok"] for item in attempts)
        for fps in (15, 30):
            core = sample * fps / 10 if sample is not None else None
            lines.append(f"| {label} | {success}/{len(attempts)} | {fps} | {fmt(core)} | {fmt(core / cpu if core is not None else None)} |")
    lines.append("")
    for fps in (15, 30):
        samples = [(label, [r[key] for r in records if r["ok"] and r.get(key)])
                   for key, label in (("local_full", "полное"), ("local_half", "половина"))]
        verdicts = []
        for label, attempts in samples:
            if not attempts:
                verdicts.append(f"{label}: нет данных")
                continue
            ms = median([item["total_ms"] for item in attempts])
            reliable = all(item["ok"] for item in attempts)
            verdicts.append(f"{label}: {'да' if reliable and ms <= 1000 / fps and ms * fps / (10 * cpu) < 5 else 'нет'}")
        lines.append(f"{fps} кадров/с при CPU < 5%: {', '.join(verdicts)} (время режима с подготовкой и выбором ROI).")
    lines += ["", "## Все кадры", "",
              "| № | Набор | Имя | Успех | Inliers | Масштаб | Репроекция, px | Глобально, мс | Локально, мс |",
              "| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |"]
    for row in records:
        lines.append(f"| {row['number']} | {row['set']} | {row['name']} | {'да' if row['ok'] else 'нет'} | {row['inliers']} | {fmt(row['scale'], 3)} | {fmt(row['reproj_px'])} | {fmt(row['global_total_ms'])} | {fmt(local_ms(row, 'local_full'))} |")
        if row.get("error"):
            lines.append(f"\nОшибка #{row['number']}: {row['error']}\n")
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_circle(value):
    try:
        circle = tuple(float(part) for part in value.split(","))
        if len(circle) != 3 or circle[2] <= 0:
            raise ValueError
        return circle
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Ожидалось cx,cy,r с положительным r") from exc


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cv2.setNumThreads(1)
    parser = argparse.ArgumentParser(description="Сопоставить кадры с эталоном карты")
    parser.add_argument("--ref", type=Path, required=True)
    parser.add_argument("--shots", type=Path, nargs="+", default=[])
    parser.add_argument("--out", type=Path, default=ROOT / ".cache/map-match-out")
    parser.add_argument("--detector", choices=("sift", "orb", "akaze"), default="sift")
    parser.add_argument("--synthetic", type=int, default=0)
    parser.add_argument("--seed", type=int, default=43)
    parser.add_argument("--minimap-circle", type=parse_circle, default=(168, 122, 95))
    args = parser.parse_args()
    if args.synthetic < 0:
        parser.error("synthetic должен быть >= 0")
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "debug").mkdir(exist_ok=True)
    ref = read_image(args.ref)
    meta = json.loads(args.ref.with_suffix(".json").read_text(encoding="utf-8"))
    cache = args.ref.parent / f"feat_{args.detector}_z{meta['zoom']}.npz"
    pts, desc, feature_ms = get_features(ref, cache, args.detector)
    matcher = flann_matcher(desc, args.detector) if len(desc) >= 2 else None
    jobs = []
    for folder in args.shots:
        if not folder.is_dir():
            parser.error(f"Нет папки: {folder}")
        jobs.extend((folder.name, path) for path in sorted(folder.rglob("*.png")))
    jobs.extend(("synthetic", i) for i in range(args.synthetic))
    rng = np.random.default_rng(args.seed)
    records = []
    for number, (set_name, source) in enumerate(jobs, 1):
        synthetic = isinstance(source, int)
        name = f"synthetic_{source + 1:04d}.png" if synthetic else source.name
        kind, layer, zoom = ("map", "surface", "other") if synthetic else classify(source)
        row = {"number": number, "name": name, "set": set_name, "is_synthetic": synthetic,
               "debug": None, "kind": kind,
               "layer": layer, "zoom": zoom, "ok": False, "inliers": 0, "good": 0,
               "scale": None, "rot": None, "center_ref": None, "center_z13": None,
               "reproj_px": None, "global_detect_ms": None, "global_match_ms": None,
               "global_ransac_ms": None, "global_total_ms": None, "local_full": None,
               "local_half": None, "local_vs_global_px": None, "error_ref_px": None,
               "error_z13_px": None, "truth_ref": None, "corners_ref": None, "error": None}
        debug_path = args.out / "debug" / f"{number:04d}__{set_name}__{Path(name).stem}.jpg"
        if not synthetic or source < 5:
            row["debug"] = debug_path.relative_to(args.out).as_posix()
        view = None
        try:
            if synthetic:
                image, truth = synthetic_frame(ref, rng)
                row["truth_ref"] = list(truth)
            else:
                image, truth = read_image(source), None
            view = image
            view, result = run_one(image, row, pts, desc, matcher, args, meta, truth)
            if row["debug"]:
                write_debug(debug_path, view, ref, result)
        except Exception as exc:
            row["ok"] = False
            row["error"] = f"{type(exc).__name__}: {exc}"
            if view is not None and row["debug"]:
                try:
                    write_debug(debug_path, view, ref, {"ok": False})
                except Exception:
                    pass
        records.append(row)
        print(f"{number:04d} {set_name}/{name}: {'OK' if row['ok'] else 'FAIL'}; inliers={row['inliers']}; {fmt(row['global_total_ms'])} мс")
    write_footprints(args.out / "footprints.jpg", ref, records)
    write_report(args.out, meta, ref, pts, feature_ms, args, records)
    print(f"Итого: {sum(r['ok'] for r in records)}/{len(records)}; отчёт: {args.out / 'report.md'}")


if __name__ == "__main__":
    main()
