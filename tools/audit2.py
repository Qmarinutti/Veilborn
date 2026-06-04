import os
from PIL import Image
import numpy as np
SRC="public/sprites"
files=sorted(f for f in os.listdir(SRC) if f.lower().endswith(".png"))
def corners(a):
    h,w=a.shape; m=max(4,h//12)
    c=[a[:m,:m],a[:m,-m:],a[-m:,:m],a[-m:,-m:]]
    return [int((b>180).mean()*100) for b in c]
bg=[]
for fn in files:
    im=Image.open(os.path.join(SRC,fn)).convert("RGBA")
    a=np.array(im)[:,:,3]
    cs=corners(a)
    nfull=sum(1 for v in cs if v>60)   # corners that are mostly opaque
    if nfull>=3:
        bg.append((fn.replace(".png",""),nfull,cs))
print("=== BACKGROUND NOT REMOVED (>=3 opaque corners) ===")
for f,n,cs in sorted(bg,key=lambda x:-x[1]): print(f"  {f:16} corners={cs}")
print("count",len(bg))
