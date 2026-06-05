# Detecte les sprites SUSPECTS objectivement (a confirmer ensuite en zoom) :
#  - collage : plusieurs grosses figures separees dans l'alpha
#  - non detoure : couverture quasi pleine (fond solide non retire)
#  - vide / juste une tete : couverture tres faible / plus grosse figure minuscule
import glob, os, numpy as np
from PIL import Image
from scipy import ndimage

rows = []
for p in sorted(glob.glob("public/sprites/*.png")):
    sid = os.path.splitext(os.path.basename(p))[0]
    im = Image.open(p).convert("RGBA")
    a = np.array(im)[:, :, 3]
    tot = a.size
    opaque = a > 40
    cov = opaque.mean()
    lbl, n = ndimage.label(opaque)
    if n == 0:
        rows.append((sid, "VIDE", cov, 0, 0)); continue
    sizes = ndimage.sum(np.ones_like(lbl), lbl, range(1, n+1))
    big = [s for s in sizes if s > 0.015*tot]          # figures "significatives" (>1.5%)
    largest = max(sizes)/tot
    reason = None
    if cov < 0.02: reason = "VIDE"
    elif cov > 0.88: reason = "NON-DETOURE/plein"
    elif len(big) >= 4: reason = f"COLLAGE? ({len(big)} figures)"
    elif largest < 0.06: reason = "tete/minuscule?"
    if reason:
        rows.append((sid, reason, cov, len(big), largest))

rows.sort(key=lambda r: (-r[3], r[1]))
print(f"{len(rows)} suspects:\n")
for sid, reason, cov, big, largest in rows:
    print(f"  {sid:18} {reason:22} couv={cov*100:4.1f}%  grosses={big}  + grosse={largest*100:4.1f}%")
import json
json.dump([r[0] for r in rows], open("tools/suspects.json", "w"))
