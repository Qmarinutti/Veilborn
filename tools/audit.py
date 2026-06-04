import os, json
from PIL import Image
import numpy as np
SRC="public/sprites"
files=sorted(f for f in os.listdir(SRC) if f.lower().endswith(".png"))
def components(mask):
    # simple flood-fill labeling of significant opaque blobs
    h,w=mask.shape; seen=np.zeros_like(mask,bool); blobs=[]
    from collections import deque
    for i in range(0,h,2):
        for j in range(0,w,2):
            if mask[i,j] and not seen[i,j]:
                q=deque([(i,j)]); seen[i,j]=True; cnt=0
                while q:
                    y,x=q.popleft(); cnt+=1
                    for dy,dx in((2,0),(-2,0),(0,2),(0,-2)):
                        ny,nx=y+dy,x+dx
                        if 0<=ny<h and 0<=nx<w and mask[ny,nx] and not seen[ny,nx]:
                            seen[ny,nx]=True; q.append((ny,nx))
                blobs.append(cnt*4)
    return sorted(blobs,reverse=True)
rep=[]
for fn in files:
    im=Image.open(os.path.join(SRC,fn)).convert("RGBA")
    a=np.array(im)[:,:,3]
    h,w=a.shape; tot=h*w
    op=a>40
    cov=op.sum()/tot
    # near-fully-opaque => background box not removed
    opaque_strong=(a>200).sum()/tot
    # connected blobs (downsampled)
    blobs=components(op)
    big=[b for b in blobs if b> (tot*0.01)]  # blobs > 1% area
    rep.append({"f":fn.replace(".png",""),"cov":round(cov,3),"solid":round(opaque_strong,3),"blobs":len(big),"top2":big[:2]})
# Classify
empty=[r for r in rep if r["cov"]<0.06]
boxbg=[r for r in rep if r["solid"]>0.55]
multi=[r for r in rep if r["blobs"]>=3]
print("=== EMPTY / over-erased (cov<6%) ===")
for r in sorted(empty,key=lambda x:x["cov"]): print(f'  {r["f"]:16} cov={r["cov"]}')
print("=== BACKGROUND BOX (solid>55%) ===")
for r in sorted(boxbg,key=lambda x:-x["solid"]): print(f'  {r["f"]:16} solid={r["solid"]}')
print("=== MULTIPLE BLOBS (>=3 big) ===")
for r in sorted(multi,key=lambda x:-x["blobs"]): print(f'  {r["f"]:16} blobs={r["blobs"]} sizes={r["top2"]}')
json.dump(rep,open("tools/audit.json","w"))
print(f"\nTOTAL {len(files)} | empty {len(empty)} | boxbg {len(boxbg)} | multi {len(multi)}")
