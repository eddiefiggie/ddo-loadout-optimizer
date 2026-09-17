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
#
# Coordinates are in the RAW's own space (1280x1600 window shots from
# `capture.js`), and callouts are drawn BEFORE the crop — so a callout box has to
# sit inside its crop box or it is cut off. Re-shoot with `capture.js`, then tune
# here; the two steps are split so a crop can be re-aimed without re-shooting.
CFG = {
 # level, race and armor proficiency — the "only show gear you can equip" promise
 "1-character.jpg": ((128,0,1180,450), [
   ("Lock in how you actually play — level cap, race, armor proficiency, then combat style below, down to a dual-wield off-hand.", (700,120), (360,390), 300)]),
 # the ranked list: grip, jump-to-end, link-into-a-group, inline Advanced summary
 "2-priorities.jpg": ((105,110,890,1320), [
   ("Rank what matters. The solver maxes #1, then #2 without giving up any of #1 — that order IS the objective. Drag, jump or link rows into a group.", (516,700), (300,985), 330)]),
 # per-slot gear with its stats, augments AND the crafting steps to build it
 "3-loadout.jpg": ((128,660,1180,1170), [
   ("Exact crafting steps per slot — every augment, gem and seal needed to build it.", (900,700), (700,1120), 250)]),
 # every point traced to an item and a bonus type, against the reachable ceiling
 "4-proof.jpg": ((128,690,1180,1170), [
   ("It shows its work: every point traced to the exact item and bonus type, against the ceiling it could reach.", (140,850), (600,820), 300)]),
 # #499 retired the Alternatives tab; the Upgrades search replaced it
 "5-upgrades.jpg": ((128,80,1180,385), [
   ("You set what a suggestion may cost — free upgrades only, by default. Your ranking is never traded away behind your back.", (880,110), (400,212), 270)]),
}

for fn,(crop,calls) in CFG.items():
    im = Image.open(os.path.join(RAW, fn)).convert("RGB")
    for text,xy,target,mw in calls: callout(im, xy, text, target, mw)
    im = im.crop(crop)
    outp = os.path.join(OUT, fn.replace(".jpg",".png"))
    im.save(outp)
    print("wrote", os.path.basename(outp), im.size)
