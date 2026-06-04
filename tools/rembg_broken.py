# Detoure UNIQUEMENT les sprites regeneres (tools/broken.json) avec isnet.
# Ne touche pas aux 299 autres deja corrects.
# Usage : python tools/rembg_broken.py
import os, json
from rembg import remove, new_session
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(ROOT, '..', 'public', 'sprites')
broken = json.load(open(os.path.join(ROOT, 'broken.json')))
session = new_session('isnet-general-use')  # meilleur detourage que u2net
print(len(broken), 'sprites a detourer (isnet)', flush=True)
ok = 0
for i, name in enumerate(broken, 1):
    p = os.path.join(DIR, name + '.png')
    if not os.path.exists(p):
        print('  manquant', name, flush=True); continue
    try:
        with Image.open(p) as im:
            out = remove(im.convert('RGBA'), session=session,
                         alpha_matting=True, alpha_matting_foreground_threshold=240,
                         alpha_matting_background_threshold=15)
        out.save(p)
        ok += 1
        print(f'  [{i}/{len(broken)}] {name} OK', flush=True)
    except Exception as e:
        print('  ERR', name, e, flush=True)
print(f'Termine : {ok}/{len(broken)} detoures', flush=True)
