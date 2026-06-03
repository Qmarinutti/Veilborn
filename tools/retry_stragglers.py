# Repere les sprites dont le fond n'a pas ete enleve (peu de pixels transparents)
# et les repasse avec un modele plus puissant (isnet-general-use).
import os
from rembg import remove, new_session
from PIL import Image

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'sprites')
files = sorted(f for f in os.listdir(DIR) if f.endswith('.png'))

strag = []
for f in files:
    p = os.path.join(DIR, f)
    im = Image.open(p).convert('RGBA')
    transparent = im.getchannel('A').histogram()[0]  # pixels alpha==0
    if transparent / (im.width * im.height) < 0.12:
        strag.append(f)

print(len(strag), 'recalcitrants :', strag, flush=True)
if strag:
    sess = new_session('isnet-general-use')
    for f in strag:
        p = os.path.join(DIR, f)
        try:
            out = remove(Image.open(p).convert('RGBA'), session=sess,
                         alpha_matting=True, alpha_matting_foreground_threshold=240,
                         alpha_matting_background_threshold=10)
            out.save(p)
            t = out.getchannel('A').histogram()[0] / (out.width * out.height)
            print(f'  {f} -> {t*100:.0f}% transparent', flush=True)
        except Exception as e:
            print('  ERR', f, e, flush=True)
print('done', flush=True)
