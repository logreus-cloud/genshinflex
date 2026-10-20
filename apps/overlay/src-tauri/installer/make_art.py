"""Generate NSIS installer bitmaps for GenshinFlex Overlay (sidebar 164x314, header 150x57).
Usage: python make_art.py <dir with Unbounded.ttf and Onest.ttf from Google Fonts> <out dir>"""
import math, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONTS = sys.argv[1]
OUT = sys.argv[2]
SS = 4  # supersampling

GOLD = (227, 176, 75)
INK = (28, 32, 51)
TEXT = (241, 239, 233)
MUTED = (150, 154, 172)


def font(name, size, wght):
    f = ImageFont.truetype(f"{FONTS}/{name}.ttf", size * SS)
    try:
        f.set_variation_by_axes([wght])
    except Exception:
        pass
    return f


def hexagon(cx, cy, r, rot=-90):
    return [(cx + r * math.cos(math.radians(rot + 60 * i)), cy + r * math.sin(math.radians(rot + 60 * i))) for i in range(6)]


def logo(d, cx, cy, r, ring=GOLD, core=GOLD):
    # favicon geometry: outer hex r=25 stroke 4.5, inner hex r=12.5
    w = max(1, round(r * 4.5 / 25))
    pts = hexagon(cx, cy, r)
    d.line(pts + [pts[0], pts[1]], fill=ring, width=w, joint="curve")
    d.polygon(hexagon(cx, cy, r * 0.5), fill=core)


def text_c(d, cx, y, s, f, fill, spacing=0):
    if spacing:
        widths = [d.textlength(ch, font=f) for ch in s]
        total = sum(widths) + spacing * SS * (len(s) - 1)
        x = cx - total / 2
        for ch, w in zip(s, widths):
            d.text((x, y), ch, font=f, fill=fill)
            x += w + spacing * SS
    else:
        w = d.textlength(s, font=f)
        d.text((cx - w / 2, y), s, font=f, fill=fill)


def sidebar():
    W, H = 164 * SS, 314 * SS
    top, bot = (32, 37, 58), (19, 21, 30)
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        c = tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = c

    # decorative honeycomb outlines, fading out
    deco = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(deco)
    r = 30 * SS
    dx, dy = r * math.sqrt(3), r * 1.5
    for row in range(-1, 10):
        for col in range(-1, 5):
            cx = col * dx + (dx / 2 if row % 2 else 0)
            cy = row * dy
            dist = math.hypot(cx - W * 0.5, cy - H * 0.33) / (W)
            a = max(0, int(26 - dist * 22))
            if a:
                p = hexagon(cx, cy, r)
                dd.line(p + [p[0]], fill=GOLD + (a,), width=SS)
    img.paste(deco, (0, 0), deco)

    cx, cy, lr = W // 2, int(H * 0.33), 30 * SS
    # glow
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((cx - lr * 2.2, cy - lr * 2.2, cx + lr * 2.2, cy + lr * 2.2), fill=GOLD + (70,))
    glow = glow.filter(ImageFilter.GaussianBlur(28 * SS))
    img.paste(glow, (0, 0), glow)
    # logo plate
    d = ImageDraw.Draw(img)
    logo(d, cx, cy, lr)

    text_c(d, cx, cy + lr + 20 * SS, "GenshinFlex", font("Unbounded", 15, 600), TEXT)
    text_c(d, cx, cy + lr + 44 * SS, "OVERLAY", font("Onest", 9, 600), GOLD, spacing=3.2)

    # hotkey hint
    kf = font("Onest", 9, 600)
    y0 = H - 40 * SS
    keys = ["Alt", "G"]
    kw = [d.textlength(k, font=kf) + 14 * SS for k in keys]
    plus = d.textlength("+", font=kf) + 10 * SS
    total = sum(kw) + plus
    x = cx - total / 2
    for i, k in enumerate(keys):
        d.rounded_rectangle((x, y0, x + kw[i], y0 + 20 * SS), radius=5 * SS, fill=(40, 45, 66), outline=(64, 70, 96), width=SS)
        d.text((x + 7 * SS, y0 + 4 * SS), k, font=kf, fill=TEXT)
        x += kw[i]
        if i == 0:
            d.text((x + 5 * SS, y0 + 4 * SS), "+", font=kf, fill=MUTED)
            x += plus

    # gold hairline on the right edge separating from the page
    d.rectangle((W - SS, 0, W, H), fill=(60, 52, 36))
    return img.resize((164, 314), Image.LANCZOS)


def header():
    W, H = 150 * SS, 57 * SS
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    cy = H // 2
    # small dark rounded tile with the logo, like the favicon
    t = 34 * SS
    x0 = 8 * SS
    d.rounded_rectangle((x0, cy - t / 2, x0 + t, cy + t / 2), radius=8 * SS, fill=INK)
    logo(d, x0 + t / 2, cy, 11.5 * SS)
    tx = x0 + t + 8 * SS
    d.text((tx, cy - 15 * SS), "GenshinFlex", font=font("Unbounded", 11, 600), fill=INK)
    of = font("Onest", 8, 600)
    x = tx + SS
    for ch in "OVERLAY":
        d.text((x, cy + 3 * SS), ch, font=of, fill=(184, 134, 36))
        x += d.textlength(ch, font=of) + 2.2 * SS
    return img.resize((150, 57), Image.LANCZOS)


sidebar().save(f"{OUT}/sidebar.bmp")
header().save(f"{OUT}/header.bmp")
sidebar().resize((328, 628), Image.NEAREST).save(f"{OUT}/sidebar_preview.png")
header().resize((300, 114), Image.NEAREST).save(f"{OUT}/header_preview.png")
