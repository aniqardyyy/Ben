#!/usr/bin/env python3
"""
Renderer gambar laporan PnL (Daily + Kalender Bulanan) untuk BEN Agent LP.

Pemakaian (dipanggil otomatis oleh pnl-report.js):
    python3 render.py daily    data.json out.jpg
    python3 render.py calendar data.json out.jpg

Butuh: python3 + Pillow  (pip install pillow)
Template gambar ada di assets/, teks lama sudah dihapus; semua angka digambar dari data nyata.
"""
import sys, json, os, calendar as cal
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, "assets")
F = os.path.join(A, "fonts")

GREEN = (29, 252, 162)
RED = (254, 72, 78)
GRAY = (157, 167, 185)
MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]


def font(name, size):
    return ImageFont.truetype(os.path.join(F, f"Poppins-{name}.ttf"), int(size))


def text_w(draw, s, f, spacing=0):
    return draw.textlength(s, font=f) + spacing * max(0, len(s) - 1)


def spaced(draw, xy, s, f, fill, spacing=0, anchor="ls"):
    """Teks dengan jarak huruf (letter-spacing)."""
    x, y = xy
    for ch in s:
        draw.text((x, y), ch, font=f, fill=fill, anchor=anchor)
        x += draw.textlength(ch, font=f) + spacing


def fmt_sol(v, sign=True, dec=3):
    r = round(v, dec)
    if r == 0:
        return f"{0:.{dec}f}"
    s = f"{abs(r):.{dec}f}"
    if sign:
        return ("+" if r > 0 else "-") + s
    return ("-" if r < 0 else "") + s


def gradient_text(img, xy, s, f, top, bottom, glow=None, anchor="ls"):
    """Teks dengan gradasi vertikal + glow lembut."""
    W, H = img.size
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).text(xy, s, font=f, fill=255, anchor=anchor)
    bbox = mask.getbbox()
    if not bbox:
        return
    if glow:
        g = mask.filter(ImageFilter.GaussianBlur(18))
        glow_layer = Image.new("RGBA", (W, H), glow + (0,))
        glow_layer.putalpha(g.point(lambda p: int(p * 0.55)))
        img.alpha_composite(glow_layer)
    grad = Image.new("RGB", (W, H))
    gd = ImageDraw.Draw(grad)
    y0, y1 = bbox[1], bbox[3]
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(1, (y1 - y0))
        gd.line([(0, y), (W, y)], fill=tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3)))
    layer = grad.convert("RGBA")
    layer.putalpha(mask)
    img.alpha_composite(layer)


# ─────────────────────────── DAILY ───────────────────────────
def render_daily(d, out):
    pnl = float(d["pnl_sol"])
    profit = round(pnl, 3) >= 0
    img = Image.open(os.path.join(A, "daily_profit.png" if profit else "daily_loss.png")).convert("RGBA")
    dr = ImageDraw.Draw(img)
    accent = GREEN if profit else RED

    # pill tanggal: "10 Okt 2026 | ● Active"
    y, m, dd = [int(x) for x in d["date"].split("-")]
    date_s = f"{dd} {MONTHS_ID[m - 1]} {y}"
    f_pill = font("Medium", 27)
    dr.text((144, 500), date_s, font=f_pill, fill=(236, 244, 244), anchor="lm")
    dr.line([(304, 484), (304, 516)], fill=(40, 95, 80), width=2)
    dr.ellipse([326, 491, 343, 508], fill=accent)
    status = d.get("status") or "Active"
    dr.text((358, 500), status, font=f_pill, fill=(236, 244, 244), anchor="lm")

    # angka PnL besar
    val = fmt_sol(pnl) + " SOL"
    size = 142
    while size > 60:
        f_big = font("Bold", size)
        if text_w(dr, val, f_big) <= 705:
            break
        size -= 4
    if profit:
        gradient_text(img, (68, 668), val, f_big, (120, 255, 214), (34, 232, 150), glow=(30, 255, 170))
    else:
        gradient_text(img, (68, 668), val, f_big, (255, 92, 112), (244, 40, 70), glow=(255, 40, 70))

    # baris posisi
    n, o, c = int(d["positions"]), int(d["open"]), int(d["closed"])
    sub = f"{n} {'position' if n == 1 else 'positions'}  •  {o} open  •  {c} closed"
    col = (170, 172, 255) if profit else (255, 150, 205)
    dr = ImageDraw.Draw(img)
    f_sub = font("Medium", 36)
    while text_w(dr, sub, f_sub) > 700:
        f_sub = font("Medium", f_sub.size - 2)
    dr.text((70, 722), sub, font=f_sub, fill=col, anchor="lm")

    img.convert("RGB").save(out, quality=93)


# ─────────────────────────── CALENDAR ───────────────────────────
STYLES = {
    "profit": dict(fill=(3, 66, 41), border=(22, 205, 125), dot=GREEN, amt=(120, 255, 200)),
    "loss": dict(fill=(72, 18, 21), border=(238, 62, 72), dot=RED, amt=(255, 140, 150)),
    "none": dict(fill=(31, 39, 46), border=(118, 128, 144), dot=GRAY, amt=(160, 170, 185)),
    "future": dict(fill=(2, 14, 12), border=(14, 52, 42), dot=None, amt=None),
}


def render_calendar(d, out):
    y, m = int(d["year"]), int(d["month"])
    days = {int(k): v for k, v in d["days"].items()}  # {1: {"pnl_sol":..,"status":..}}
    last_day = int(d.get("last_day") or cal.monthrange(y, m)[1])  # hari terakhir yang sudah direkap
    img = Image.open(os.path.join(A, "calendar_base.png")).convert("RGBA")
    S = 2  # supersampling untuk tepi halus
    W, H = img.size
    lay = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lay)

    # header hari
    x0, x1, gap = 77, 1119, 14
    cw = (x1 - x0 - 6 * gap) / 7
    hf = font("Bold", 22 * S)
    for i, nm in enumerate(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]):
        cx = x0 + i * (cw + gap)
        ld.rounded_rectangle([cx * S, 338 * S, (cx + cw) * S, 376 * S], radius=12 * S,
                             fill=(3, 28, 22, 255), outline=(20, 100, 78, 255), width=2 * S)
        ld.text(((cx + cw / 2) * S, 357 * S), nm, font=hf, fill=(140, 249, 232, 255), anchor="mm")

    first_wd = (cal.monthrange(y, m)[0] + 1) % 7  # Senin=0 -> Minggu=0
    ndays = cal.monthrange(y, m)[1]
    rows = (first_wd + ndays + 6) // 7
    gy0, gy1, rgap = 392, 880, 12
    ch = (gy1 - gy0 - (rows - 1) * rgap) / rows
    nf = font("Bold", (30 if rows <= 5 else 26) * S)
    af = font("Medium", (17 if rows <= 5 else 15) * S)

    total = 0.0
    n_profit = n_loss = 0
    for day in range(1, ndays + 1):
        idx = first_wd + day - 1
        r, c = divmod(idx, 7)
        cx = x0 + c * (cw + gap)
        cy = gy0 + r * (ch + rgap)
        info = days.get(day)
        if day > last_day:
            kind = "future"
        elif not info or info.get("status") == "none":
            kind = "none"
        elif info["status"] == "profit":
            kind = "profit"
        else:
            kind = "loss"
        st = STYLES[kind]
        ld.rounded_rectangle([cx * S, cy * S, (cx + cw) * S, (cy + ch) * S], radius=14 * S,
                             fill=st["fill"] + (255,), outline=st["border"] + (255,), width=2 * S)
        numcol = (255, 255, 255, 255) if kind != "future" else (70, 95, 90, 255)
        ld.text(((cx + 18) * S, (cy + 9) * S), str(day), font=nf, fill=numcol, anchor="la")
        if st["dot"]:
            r_dot = 7 * S
            dx, dy = (cx + cw - 20) * S, (cy + 19) * S
            ld.ellipse([dx - r_dot, dy - r_dot, dx + r_dot, dy + r_dot], fill=st["dot"] + (255,))
        if kind in ("profit", "loss") and info:
            v = float(info["pnl_sol"])
            total += v
            n_profit += kind == "profit"
            n_loss += kind == "loss"
            ld.text(((cx + 18) * S, (cy + ch - 9) * S), fmt_sol(v), font=af, fill=st["amt"] + (255,), anchor="lb")

    lay = lay.resize((W, H), Image.LANCZOS)
    img.alpha_composite(lay)
    dr = ImageDraw.Draw(img)

    # judul: "<BULAN> PNL CALENDAR" (otomatis mengecil kalau panjang, mis. SEPTEMBER)
    mname = cal.month_name[m].upper()
    size = 82
    while size > 40:
        tf = font("Bold", size)
        wa = text_w(dr, mname + " ", tf)
        wb = text_w(dr, "PNL CALENDAR", tf)
        if wa + wb <= 1050:
            break
        size -= 2
    gradient_text(img, (64, 300), mname + " ", tf, (255, 255, 255), (222, 226, 244))
    gradient_text(img, (64 + wa, 300), "PNL CALENDAR", tf, (92, 255, 200), (22, 214, 150))

    # footer: ringkasan bulan berjalan
    dr = ImageDraw.Draw(img)
    ff = font("Medium", 21)
    x = 150
    parts = [("MONTHLY OVERVIEW", (190, 215, 210)), ("NET " + fmt_sol(total) + " SOL", GREEN if round(total, 3) >= 0 else RED),
             (f"{n_profit} PROFIT", GREEN), (f"{n_loss} LOSS", RED)]
    for i, (t, col) in enumerate(parts):
        spaced(dr, (x, 943), t, ff, col, spacing=2.2)
        x += text_w(dr, t, ff, 2.2) + 20
        if i < len(parts) - 1:
            dr.ellipse([x - 4, 933, x, 937], fill=(110, 140, 135))
            x += 22
    img.convert("RGB").save(out, quality=93)


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("daily", "calendar"):
        sys.exit("usage: render.py daily|calendar data.json out.jpg")
    with open(sys.argv[2], encoding="utf-8") as fh:
        data = json.load(fh)
    (render_daily if sys.argv[1] == "daily" else render_calendar)(data, sys.argv[3])
