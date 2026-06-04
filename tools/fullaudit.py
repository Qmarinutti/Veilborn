import os, math, json
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from collections import deque
SRC="public/sprites"; OUT="tools/sheets"
os.makedirs(OUT, exist_ok=True)
files=sorted(f for f in os.listdir(SRC) if f.lower().endswith(".png"))

def blobs(mask):
    h,w=mask.shape; seen=np.zeros_like(mask,bool); out=[]
    for i in range(0,h,2):
        for j in range(0,w,2):
            if mask[i,j] and not seen[i,j]:
                q=deque([(i,j)]); seen[i,j]=True; c=0
                while q:
                    y,x=q.popleft(); c+=1
                    for dy,dx in((2,0),(-2,0),(0,2),(0,-2)):
                        ny,nx=y+dy,x+dx
                        if 0<=ny<h and 0<=nx<w and mask[ny,nx] and not seen[ny,nx]:
                            seen[ny,nx]=True; q.append((ny,nx))
                out.append(c*4)
    return sorted(out,reverse=True)

empty=[]; collage=[]; bg=[]; tiny=[]
for f in files:
    im=Image.open(os.path.join(SRC,f)).convert("RGBA"); a=np.array(im)
    al=a[:,:,3]; tot=al.size; cov=(al>40).sum()/tot
    h,w=al.shape; m=max(4,h//12)
    corners=[al[:m,:m],al[:m,-m:],al[-m:,:m],al[-m:,-m:]]
    nfull=sum(1 for c in corners if (c>180).mean()>0.55)
    big=[b for b in blobs(al>40) if b>tot*0.012]
    name=f[:-4]
    if cov<0.06: empty.append((name,round(cov*100,1)))
    elif cov<0.12: tiny.append((name,round(cov*100,1)))
    if len(big)>=3: collage.append((name,len(big)))
    if nfull>=3: bg.append((name,nfull))
print("VIDES   :", empty or "aucun")
print("PETITS  :", tiny or "aucun")
print("COLLAGES:", collage or "aucun")
print("FONDS   :", bg or "aucun")

# Contact sheets sur damier
cell=180; cols=6; rows=6; per=cols*rows; pad=4; lbl=15
def checker(W,H,s=12):
    img=Image.new("RGB",(W,H),(205,205,210)); d=ImageDraw.Draw(img)
    for y in range(0,H,s):
        for x in range(0,W,s):
            if (x//s+y//s)%2: d.rectangle([x,y,x+s,y+s],fill=(165,165,172))
    return img
try: font=ImageFont.truetype("arial.ttf",12)
except: font=ImageFont.load_default()
for si in range(math.ceil(len(files)/per)):
    chunk=files[si*per:(si+1)*per]
    W=cols*(cell+pad)+pad; H=rows*(cell+lbl+pad)+pad
    sh=checker(W,H); d=ImageDraw.Draw(sh)
    for i,fn in enumerate(chunk):
        r,c=divmod(i,cols); x=pad+c*(cell+pad); y=pad+r*(cell+lbl+pad)
        im=Image.open(os.path.join(SRC,fn)).convert("RGBA"); im.thumbnail((cell,cell))
        sh.paste(im,(x+(cell-im.width)//2,y+(cell-im.height)//2),im)
        d.rectangle([x,y,x+cell,y+cell],outline=(110,110,120))
        d.text((x+2,y+cell+1),fn[:-4],fill=(0,0,0),font=font)
    sh.save(f"{OUT}/s{si}.png")
print("sheets:", math.ceil(len(files)/per), "total", len(files))
