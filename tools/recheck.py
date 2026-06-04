import os,json,math
from PIL import Image,ImageDraw,ImageFont
import numpy as np
SRC="public/sprites"
broken=json.load(open("tools/broken.json"))
def components(mask):
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
flags=[]
for n in broken:
    a=np.array(Image.open(os.path.join(SRC,n+".png")).convert("RGBA"))[:,:,3]
    tot=a.size; cov=(a>40).sum()/tot; solid=(a>200).sum()/tot
    big=[b for b in components(a>40) if b>tot*0.01]
    bad=[]
    if cov<0.06: bad.append("VIDE")
    if len(big)>=3: bad.append("MULTI")
    if solid>0.60: bad.append("SOLID?")
    if bad: flags.append((n,cov,solid,len(big),bad))
print("=== Sprites encore suspects apres regen ===")
for n,c,s,b,bad in flags: print(f"  {n:14} cov{int(c*100)}% solid{int(s*100)}% blob{b} -> {bad}")
print(f"{len(flags)}/43 encore a verifier")
# montage des 43
cell=170;cols=6;pad=5;lbl=15
def checker(w,h,s=12):
    img=Image.new("RGB",(w,h),(205,205,210));d=ImageDraw.Draw(img)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if (x//s+y//s)%2:d.rectangle([x,y,x+s,y+s],fill=(162,162,170))
    return img
try:font=ImageFont.truetype("arial.ttf",12)
except:font=ImageFont.load_default()
rows=math.ceil(len(broken)/cols)
W=cols*(cell+pad)+pad;H=rows*(cell+lbl+pad)+pad
sh=checker(W,H);d=ImageDraw.Draw(sh)
for i,n in enumerate(broken):
    r,c=divmod(i,cols);x=pad+c*(cell+pad);y=pad+r*(cell+lbl+pad)
    im=Image.open(os.path.join(SRC,n+".png")).convert("RGBA");im.thumbnail((cell,cell))
    sh.paste(im,(x+(cell-im.width)//2,y+(cell-im.height)//2),im)
    d.rectangle([x,y,x+cell,y+cell],outline=(110,110,120))
    d.text((x+2,y+cell+1),n,fill=(0,0,0),font=font)
sh.save("tools/recheck.png");print("montage -> tools/recheck.png",sh.size)
