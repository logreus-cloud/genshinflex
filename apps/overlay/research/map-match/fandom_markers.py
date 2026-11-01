"""Перенос меток с интерактивной карты Genshin Impact Wiki (Fandom) на нашу мозаику.

Данные карт Fandom распространяются по CC BY-SA, поэтому у меток в базе
остаётся пометка об источнике. Картинка карты Fandom нужна только локально
для совмещения и в репозиторий не кладётся.

Порядок:
1. Совмещает картинку Fandom с mosaic_z12 по особым точкам SIFT
   (уменьшенные копии, RANSAC, преобразование подобия), затем уточняет
   его на полном разрешении по фрагментам вокруг меток.
2. Переводит позиции меток в координаты z12 сайта (пиксель мозаики + offset_px).
3. Пишет markers.json, insert.sql и review/ с вырезками для проверки глазами.
"""
import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np


def read_image(path, flags=cv2.IMREAD_COLOR):
    image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), flags)
    if image is None:
        raise ValueError(f"Не удалось прочитать изображение: {path}")
    return image


def write_jpeg(path, image):
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        raise ValueError(f"Не удалось записать: {path}")
    encoded.tofile(path)


def to_gray(image):
    if image.ndim == 3 and image.shape[2] == 4:
        alpha = image[:, :, 3]
        gray = cv2.cvtColor(image[:, :, :3], cv2.COLOR_BGR2GRAY)
        gray[alpha < 128] = 0
        return gray, alpha >= 128
    if image.ndim == 3:
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), None
    return image, None


def similarity(points_from, points_to, threshold):
    matrix, inliers = cv2.estimateAffinePartial2D(
        points_from, points_to, method=cv2.RANSAC,
        ransacReprojThreshold=threshold, maxIters=20000, confidence=0.999)
    if matrix is None:
        raise RuntimeError("Не удалось оценить преобразование")
    return matrix, inliers.ravel().astype(bool)


def coarse_register(fandom, mosaic, mosaic_mask, work_width):
    scale_f = work_width / fandom.shape[1]
    scale_m = work_width / mosaic.shape[1]
    small_f = cv2.resize(fandom, None, fx=scale_f, fy=scale_f, interpolation=cv2.INTER_AREA)
    small_m = cv2.resize(mosaic, None, fx=scale_m, fy=scale_m, interpolation=cv2.INTER_AREA)
    mask = None
    if mosaic_mask is not None:
        mask = cv2.resize(mosaic_mask.astype(np.uint8) * 255, small_m.shape[::-1],
                          interpolation=cv2.INTER_NEAREST)
        mask = cv2.erode(mask, np.ones((5, 5), np.uint8))
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    small_f, small_m = clahe.apply(small_f), clahe.apply(small_m)
    sift = cv2.SIFT_create(nfeatures=40000)
    kp_f, des_f = sift.detectAndCompute(small_f, None)
    kp_m, des_m = sift.detectAndCompute(small_m, mask)
    matcher = cv2.FlannBasedMatcher({"algorithm": 1, "trees": 5}, {"checks": 64})
    good = []
    for pair in matcher.knnMatch(des_f, des_m, k=2):
        if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance:
            good.append(pair[0])
    src = np.float32([kp_f[m.queryIdx].pt for m in good]) / scale_f
    dst = np.float32([kp_m[m.trainIdx].pt for m in good]) / scale_m
    matrix, inliers = similarity(src, dst, threshold=6 / scale_m)
    print(f"Грубое совмещение: {len(good)} пар, {inliers.sum()} согласованных")
    return matrix, int(inliers.sum())


def apply(matrix, point):
    x, y = point
    return (matrix[0, 0] * x + matrix[0, 1] * y + matrix[0, 2],
            matrix[1, 0] * x + matrix[1, 1] * y + matrix[1, 2])


def local_refine(fandom, mosaic, mosaic_mask, matrix, point, window):
    """Сдвиг по фрагменту вокруг метки: фрагмент Fandom переносится в
    пространство мозаики текущим преобразованием и ищется в окрестности."""
    mx, my = apply(matrix, point)
    half = window // 2
    search = window
    x0, y0 = int(mx) - half - search, int(my) - half - search
    x1, y1 = int(mx) + half + search, int(my) + half + search
    if x0 < 0 or y0 < 0 or x1 > mosaic.shape[1] or y1 > mosaic.shape[0]:
        return None
    if mosaic_mask is not None:
        covered = mosaic_mask[int(my) - half:int(my) + half, int(mx) - half:int(mx) + half]
        if covered.mean() < 0.9:
            return None
    # Фрагмент Fandom в координатах мозаики размером window×window с центром в (mx, my).
    shift = np.array([[1, 0, half - mx], [0, 1, half - my]], dtype=np.float64)
    full = np.vstack([matrix, [0, 0, 1]])
    warp = (np.vstack([shift, [0, 0, 1]]) @ full)[:2]
    patch = cv2.warpAffine(fandom, warp, (window, window), flags=cv2.INTER_LINEAR)
    region = mosaic[y0:y1, x0:x1]
    result = cv2.matchTemplate(region, patch, cv2.TM_CCOEFF_NORMED)
    _, score, _, best = cv2.minMaxLoc(result)
    dx = best[0] - search
    dy = best[1] - search
    return mx + dx, my + dy, float(score)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--map-json", type=Path, required=True, help="JSON страницы Map:* с Fandom")
    parser.add_argument("--fandom-image", type=Path, required=True)
    parser.add_argument("--mosaic", type=Path, required=True)
    parser.add_argument("--stitch", type=Path, required=True, help="stitch.json склейки")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--type", required=True, help="тип метки на сайте, например boss")
    parser.add_argument("--source", required=True, help="название страницы для пометки об источнике")
    parser.add_argument("--work-width", type=int, default=4000)
    parser.add_argument("--window", type=int, default=384)
    parser.add_argument("--min-score", type=float, default=0.35)
    args = parser.parse_args()

    data = json.loads(args.map_json.read_text(encoding="utf-8"))
    if data.get("origin", "top-left") != "top-left" or data.get("coordinateOrder", "xy") != "xy":
        raise ValueError("Ожидается origin top-left и coordinateOrder xy")
    (bx0, by0), (bx1, by1) = data["mapBounds"]
    canvas = json.loads(args.stitch.read_text(encoding="utf-8"))["canvas"]
    offset = canvas["offset_px"]

    fandom, _ = to_gray(read_image(args.fandom_image))
    mosaic, mosaic_mask = to_gray(read_image(args.mosaic, cv2.IMREAD_UNCHANGED))
    sx = fandom.shape[1] / (bx1 - bx0)
    sy = fandom.shape[0] / (by1 - by0)

    matrix, inliers = coarse_register(fandom, mosaic, mosaic_mask, args.work_width)
    scale = math.hypot(matrix[0, 0], matrix[1, 0])
    angle = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
    print(f"Масштаб {scale:.4f}, поворот {angle:.3f}°")

    categories = {c["id"]: c["name"] for c in data["categories"]}
    raw = []
    for marker in data["markers"]:
        px = (marker["position"][0] - bx0) * sx
        py = (marker["position"][1] - by0) * sy
        raw.append((marker, (px, py)))

    # Уточнение: локальные сдвиги по надёжным фрагментам, затем общее
    # преобразование заново по парам «точка Fandom → уточнённая точка».
    pairs_from, pairs_to, refined = [], [], {}
    for marker, point in raw:
        local = local_refine(fandom, mosaic, mosaic_mask, matrix, point, args.window)
        if local and local[2] >= args.min_score:
            pairs_from.append(point)
            pairs_to.append(local[:2])
            refined[marker["id"]] = local
    if len(pairs_from) >= 8:
        matrix2, keep = similarity(np.float32(pairs_from), np.float32(pairs_to), threshold=12)
        print(f"Уточнение: {len(pairs_from)} фрагментов, {keep.sum()} согласованных")
        matrix = matrix2

    out = []
    for marker, point in raw:
        mx, my = apply(matrix, point)
        inside = 0 <= mx < mosaic.shape[1] and 0 <= my < mosaic.shape[0]
        covered = bool(inside and mosaic_mask is not None and mosaic_mask[int(my), int(mx)])
        local = refined.get(marker["id"])
        popup = marker.get("popup") or {}
        title = popup.get("title") or ""
        description = popup.get("description") or ""
        out.append({
            "fandom_id": marker["id"],
            "category": categories.get(marker["categoryId"], marker["categoryId"]),
            "title": title,
            "description": description,
            "cx": mx, "cy": my,
            "x": round((mx + offset[0]) * 2) / 2,
            "y": round((my + offset[1]) * 2) / 2,
            "covered": covered,
            "local_score": round(local[2], 3) if local else None,
            "local_shift": round(math.hypot(local[0] - mx, local[1] - my), 1) if local else None,
        })

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "markers.json").write_text(json.dumps({
        "source": args.source,
        "license": "CC BY-SA (Genshin Impact Wiki, Fandom)",
        "matrix": matrix.tolist(),
        "coarse_inliers": inliers,
        "markers": out,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    review = args.out / "review"
    review.mkdir(exist_ok=True)
    color_mosaic = None
    half = 160
    for item in out:
        if not item["covered"]:
            continue
        if color_mosaic is None:
            color_mosaic = read_image(args.mosaic)
        x, y = int(item["cx"]), int(item["cy"])
        crop = color_mosaic[max(0, y - half):y + half, max(0, x - half):x + half].copy()
        cv2.circle(crop, (min(x, half), min(y, half)), 14, (0, 0, 255), 2)
        cv2.putText(crop, f"{item['fandom_id']} {item['title']}"[:40], (6, 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        write_jpeg(review / f"{int(item['fandom_id']):03d}.jpg", crop)

    source = args.source.replace("'", "''")
    values = []
    for item in out:
        if not item["covered"]:
            continue
        title = item["title"].replace("'", "''")
        note = f"Источник: Genshin Impact Wiki, {source} (CC BY-SA)"
        values.append(f"('surface', '{args.type}', {item['x']:.1f}, {item['y']:.1f}, "
                      f"'{title}', '{note}', 'approved')")
    (args.out / "insert.sql").write_text(
        "insert into public.map_markers (layer, type, x, y, title, note, status) values\n"
        + ",\n".join(values) + ";\n", encoding="utf-8")
    skipped = [item["title"] for item in out if not item["covered"]]
    print(f"Меток: {len(out)}, на склейке: {len(values)}, вне склейки: {len(skipped)}")
    for title in skipped:
        print("  вне склейки:", title)


if __name__ == "__main__":
    main()
