import os, math
from PIL import Image, ImageDraw, ImageFont
SRC="public/sprites"
cands="sagethron stratowing titanlord verdmancer aerobud thorndrake cyclonrex dragngoth luxette aetherback umbrpaw wavback virubud shiverrex zappaw aethertitan".split()
cands=[c for c in cands if os.path.exists(os.path.join(SRC,c+".png"))]
cell=250; cols=4; pad=6; lbl=22
def checker(W,H,s=14):
    img=Image.new("RGB",(W,H),(205,205,210)); d=ImageDraw.Draw(img)
    for y in range(0,H,s):
        for x in range(0,W,s):
            if (x//s+y//s)%2: d.rectangle([x,y,x+s,y+s],fill=(160,160,168))
    return img
try: font=ImageFont.truetype("arialbd.ttf",17)
except: font=ImageFont.load_default()
rows=math.ceil(len(cands)/cols)
W=cols*(cell+pad)+pad; H=rows*(cell+lbl+pad)+pad
sh=checker(W,H); d=ImageDraw.Draw(sh)
for i,n in enumerate(cands):
    r,c=divmod(i,cols); x=pad+c*(cell+pad); y=pad+r*(cell+lbl+pad)
    im=Image.open(os.path.join(SRC,n+".png")).convert("RGBA"); im.thumbnail((cell,cell))
    sh.paste(im,(x+(cell-im.width)//2,y+(cell-im.height)//2),im)
    d.rectangle([x,y,x+cell,y+cell],outline=(70,70,80),width=2)
    d.text((x+4,y+cell+3),n,fill=(0,0,0),font=font)
sh.save("tools/zoom2.png"); print("ok",len(cands))
