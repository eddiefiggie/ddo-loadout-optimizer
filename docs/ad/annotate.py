"""Crop + annotate ad screenshots (arrows + callouts)."""
from PIL import Image, ImageDraw, ImageFont
import os, math

RAW = os.path.join(os.path.dirname(__file__), "raw")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "web", "screenshots", "ad")
os.makedirs(OUT, exist_ok=True)

ACCENT = (99, 155, 255)
BG = (11, 17, 33, 240)
WHITE = (238, 242, 250)

def font(sz, bold=False):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
              "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
        try: return ImageFont.truetype(p, sz)
        except Exception: pass
    return ImageFont.load_default()

F = font(21); FB = font(22, True)

def wrap(draw, text, fnt, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= maxw: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def callout(im, xy, text, target, maxw=320):
    """Draw a rounded callout at xy (top-left) with an arrow to target (full-img coords)."""
    d = ImageDraw.Draw(im, "RGBA")
    lines = wrap(d, text, F, maxw)
    lh = F.size + 7
    pad = 13
    w = min(maxw, max(d.textlength(l, font=F) for l in lines)) + pad*2
    h = lh*len(lines) + pad*2 - 5
    x, y = xy
    # arrow: from nearest box edge midpoint to target
    tx, ty = target
    cx, cy = x + w/2, y + h/2
    # pick edge point on the box facing the target
    ex = max(x, min(tx, x+w)); ey = max(y, min(ty, y+h))
    # start slightly outside the box toward target
    ang = math.atan2(ty-cy, tx-cx)
    sx, sy = cx + (w/2+2)*math.cos(ang), cy + (h/2+2)*math.sin(ang)
    d.line([(sx, sy), (tx, ty)], fill=ACCENT, width=4)
    # arrowhead
    ah = 15
    a1 = (tx - ah*math.cos(ang - 0.5), ty - ah*math.sin(ang - 0.5))
    a2 = (tx - ah*math.cos(ang + 0.5), ty - ah*math.sin(ang + 0.5))
    d.polygon([ (tx,ty), a1, a2 ], fill=ACCENT)
    # box
    d.rounded_rectangle([x, y, x+w, y+h], radius=11, fill=BG, outline=ACCENT, width=3)
    ty0 = y + pad - 2
    for l in lines:
        d.text((x+pad, ty0), l, font=F, fill=WHITE); ty0 += lh

# (raw file, crop box (l,t,r,b), [ (callout_text, callout_xy, target_xy, maxw) ... ])
CFG = {
 "1-character.jpg": ((66,232,772,700), [
   ("Lock in how you actually play — fighting style, weapon type, even a dual-wield off-hand weapon.", (392,362), (176,662), 330)]),
 "2-priorities.jpg": ((66,176,1004,816), [
   ("Rank what matters. The solver maxes #1, then #2 without giving up any of #1 — that order IS the objective.", (612,505), (205,529), 330)]),
 "3-loadout.jpg": ((66,132,1004,812), [
   ("Exact crafting steps per slot — every augment and seal needed to build it.", (792,470), (600,555), 200)]),
 "4-proof.jpg": ((100,492,1004,722), [
   ("It shows its work: every point traced to the exact item and bonus type.", (560,505), (300,632), 300)]),
 "5-alternatives.jpg": ((100,496,1004,952), [
   ("Near-optimal trade-offs — see exactly what you gain and what you give up.", (566,800), (350,605), 320)]),
}

for fn,(crop,calls) in CFG.items():
    im = Image.open(os.path.join(RAW, fn)).convert("RGB")
    for text,xy,target,mw in calls: callout(im, xy, text, target, mw)
    im = im.crop(crop)
    outp = os.path.join(OUT, fn.replace(".jpg",".png"))
    im.save(outp)
    print("wrote", os.path.basename(outp), im.size)
