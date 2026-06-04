import os, json
from PIL import Image, ImageDraw, ImageFont
SRC="public/sprites"; OUT="tools/verify"
os.makedirs(OUT,exist_ok=True)
rep={r["f"]:r for r in json.load(open("tools/audit.json"))}
empty=[f for f,r in rep.items() if r["cov"]<0.06]
multi=[f for f,r in rep.items() if r["blobs"]>=3]
solid=[f for f,r in rep.items() if r["solid"]>0.58]
cand=sorted(set(empty+multi+solid))
print("candidates:",len(cand))
cell=240; cols=5; pad=6; lbl=20
def checker(w,h,s=14):
    img=Image.new("RGB",(w,h),(205,205,210)); d=ImageDraw.Draw(img)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if (x//s+y//s)%2: d.rectangle([x,y,x+s,y+s],fill=(165,165,172))
    return img
try: font=ImageFont.truetype("arial.ttf",15)
except: font=ImageFont.load_default()
import math
rows=math.ceil(len(cand)/cols)
W=cols*(cell+pad)+pad; H=rows*(cell+lbl+pad)+pad
sheet=checker(W,H); d=ImageDraw.Draw(sheet)
for i,fn in enumerate(cand):
    r,c=divmod(i,cols)
    x=pad+c*(cell+pad); y=pad+r*(cell+lbl+pad)
    im=Image.open(os.path.join(SRC,fn+".png")).convert("RGBA"); im.thumbnail((cell,cell))
    sheet.paste(im,(x+(cell-im.width)//2,y+(cell-im.height)//2),im)
    d.rectangle([x,y,x+cell,y+cell],outline=(90,90,100))
    tag=f'{fn}  c{int(rep[fn]["cov"]*100)} s{int(rep[fn]["solid"]*100)} b{rep[fn]["blobs"]}'
    d.text((x+3,y+cell+2),tag,fill=(0,0,0),font=font)
sheet.save(f"{OUT}/verify.png")
print("saved", sheet.size, "rows",rows)
