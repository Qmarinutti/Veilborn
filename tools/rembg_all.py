# Detoure les 300 sprites par IA (rembg / u2net) -> PNG transparents en place.
# Usage : python tools/rembg_all.py
import os
from rembg import remove, new_session
from PIL import Image

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'sprites')
session = new_session('u2net')
files = sorted(f for f in os.listdir(DIR) if f.endswith('.png'))
print(len(files), 'sprites a detourer', flush=True)
ok = 0
for i, f in enumerate(files, 1):
    p = os.path.join(DIR, f)
    try:
        with Image.open(p) as im:
            out = remove(im.convert('RGBA'), session=session)
        out.save(p)
        ok += 1
    except Exception as e:
        print('  ERR', f, e, flush=True)
    if i % 25 == 0:
        print(f'  {i}/{len(files)}', flush=True)
print(f'Termine : {ok}/{len(files)} detoures', flush=True)
