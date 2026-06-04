import os, numpy as np
from PIL import Image
from collections import deque
SRC="public/sprites"
files=sorted(f for f in os.listdir(SRC) if f.endswith(".png"))
def blob_info(mask):
    h,w=mask.shape; seen=np.zeros_like(mask,bool); blobs=[]
    for i in range(0,h,2):
        for j in range(0,w,2):
            if mask[i,j] and not seen[i,j]:
                q=deque([(i,j)]); seen[i,j]=True; px=0; y0=y1=i; x0=x1=j
                while q:
                    y,x=q.popleft(); px+=1
                    y0=min(y0,y);y1=max(y1,y);x0=min(x0,x);x1=max(x1,x)
                    for dy,dx in((2,0),(-2,0),(0,2),(0,-2)):
                        ny,nx=y+dy,x+dx
                        if 0<=ny<h and 0<=nx<w and mask[ny,nx] and not seen[ny,nx]:
                            seen[ny,nx]=True;q.append((ny,nx))
                blobs.append((px*4,(y0,y1,x0,x1)))
    return sorted(blobs,key=lambda b:-b[0])
multi=[]; box=[]; sparse=[]
for f in files:
    a=np.array(Image.open(os.path.join(SRC,f)).convert("RGBA"))[:,:,3]
    tot=a.size; mask=a>40; cov=mask.sum()/tot
    bl=blob_info(mask)
    big=[b for b in bl if b[0]>tot*0.004]   # blobs > 0.4% (capte petites figures/artefacts)
    name=f[:-4]
    # collage / artefact detache : 2e blob significatif
    if len(big)>=2 and big[1][0] > big[0][0]*0.18:
        multi.append((name,len(big),round(big[1][0]/big[0][0],2)))
    # fond plein : ratio de remplissage de la bbox du plus gros blob
    if big:
        (y0,y1,x0,x1)=big[0][1]; bw=(x1-x0+1)*2; bh=(y1-y0+1)*2
        barea=bw*bh; fill=big[0][0]/barea if barea else 0
        if barea>tot*0.22 and fill>0.80:
            box.append((name,round(fill,2)))
    if cov<0.13: sparse.append((name,round(cov*100,1)))
print("=== MULTI-BLOB (collage/artefact) ===")
for n,k,r in sorted(multi,key=lambda x:-x[2]): print(f"  {n:14} blobs={k} ratio2e={r}")
print("=== FOND PLEIN (boite/cercle) ===")
for n,fl in sorted(box,key=lambda x:-x[1]): print(f"  {n:14} fill={fl}")
print("=== SPARSE (cov<13%) ===")
for n,c in sorted(sparse,key=lambda x:x[1]): print(f"  {n:14} cov={c}%")
