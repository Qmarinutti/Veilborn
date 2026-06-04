# Detoure (isnet) un sprite EN PLACE puis sort des metriques de validation JSON.
import sys, json, numpy as np
from rembg import remove, new_session
from PIL import Image
from collections import deque
sid=sys.argv[1]; p="public/sprites/"+sid+".png"
sess=new_session('isnet-general-use')
with Image.open(p) as im: out=remove(im.convert("RGBA"),session=sess)
out.save(p)
a=np.array(out)[:,:,3]; tot=a.size; mask=a>40; cov=mask.sum()/tot
h,w=a.shape; m=max(4,h//12)
corners=[a[:m,:m],a[:m,-m:],a[-m:,:m],a[-m:,-m:]]
ncorner=sum(1 for c in corners if (c>180).mean()>0.5)
seen=np.zeros_like(mask,bool); blobs=[]
for i in range(0,h,2):
  for j in range(0,w,2):
    if mask[i,j] and not seen[i,j]:
      q=deque([(i,j)]); seen[i,j]=True; px=0;y0=y1=i;x0=x1=j
      while q:
        y,x=q.popleft();px+=1;y0=min(y0,y);y1=max(y1,y);x0=min(x0,x);x1=max(x1,x)
        for dy,dx in((2,0),(-2,0),(0,2),(0,-2)):
          ny,nx=y+dy,x+dx
          if 0<=ny<h and 0<=nx<w and mask[ny,nx] and not seen[ny,nx]: seen[ny,nx]=True;q.append((ny,nx))
      blobs.append((px*4,(y0,y1,x0,x1)))
blobs.sort(key=lambda b:-b[0])
big=[b for b in blobs if b[0]>tot*0.004]
ratio2=(big[1][0]/big[0][0]) if len(big)>=2 else 0
fill=0
if big:
  (y0,y1,x0,x1)=big[0][1]; barea=(x1-x0+1)*2*((y1-y0+1)*2)
  fill=big[0][0]/barea if barea else 0
ok = (0.16<=cov<=0.74) and (len(big)==1 or ratio2<0.16) and fill<0.82 and ncorner<2
print(json.dumps({"cov":round(cov,3),"blobs":len(big),"ratio2":round(ratio2,2),"fill":round(fill,2),"corners":ncorner,"ok":ok}))
