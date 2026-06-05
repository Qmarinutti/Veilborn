# Genere des planches-contact de tous les sprites pour revue visuelle (reperer collages/tetes/vides).
import os, glob
from PIL import Image, ImageDraw, ImageFont

SPRITES = "public/sprites"
COLS, ROWS = 10, 10            # 100 sprites par planche
CELL = 116                     # taille cellule
IMG = 96                       # taille sprite dans la cellule
BG = (40, 44, 52)              # fond sombre -> un sprite vide/blanc se voit direct
GRID = (70, 76, 86)
try:
    font = ImageFont.truetype("arial.ttf", 12)
except Exception:
    font = ImageFont.load_default()

ids = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(SPRITES + "/*.png"))
print(f"{len(ids)} sprites")
per = COLS * ROWS
sheets = (len(ids) + per - 1) // per
for s in range(sheets):
    chunk = ids[s*per:(s+1)*per]
    W, H = COLS*CELL, ROWS*CELL
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    for i, sid in enumerate(chunk):
        cx, cy = (i % COLS)*CELL, (i // COLS)*CELL
        d.rectangle([cx, cy, cx+CELL-1, cy+CELL-1], outline=GRID)
        try:
            im = Image.open(f"{SPRITES}/{sid}.png").convert("RGBA")
            im.thumbnail((IMG, IMG), Image.LANCZOS)
            sheet.paste(im, (cx + (CELL-im.width)//2, cy + 4), im)
        except Exception as e:
            d.text((cx+6, cy+6), "ERR", fill=(255,80,80), font=font)
        d.text((cx+4, cy+CELL-15), sid[:16], fill=(200,205,215), font=font)
    out = f"tools/sheet_{s+1}.png"
    sheet.save(out)
    print("ecrit", out, f"({len(chunk)} sprites)")
