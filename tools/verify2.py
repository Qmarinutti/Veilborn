import os, json, math
from PIL import Image, ImageDraw, ImageFont
SRC="public/sprites"; OUT="tools/verify"
rep={r["f"]:r for r in json.load(open("tools/audit.json"))}
empty=[f for f,r in rep.items() if r["cov"]<0.06]
multi=[f for f,r in rep.items() if r["blobs"]>=3]
solid=[f for f,r in rep.items() if r["solid"]>0.58]
cand=sorted(set(empty+multi+solid))
cell=300; cols=3; pad=8; lbl=26
def checker(w,h,s=16):
    img=Image.new("RGB",(w,h),(205,205,210)); d=ImageDraw.Draw(img)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if (x//s+y//s)%2: d.rectangle([x,y,x+s,y+s],fill=(160,160,168))
    return img
try: font=ImageFont.truetype("arialbd.ttf",18)
except: font=ImageFont.load_default()
def build(chunk,name):
    rows=math.ceil(len(chunk)/cols)
    W=cols*(cell+pad)+pad; H=rows*(cell+lbl+pad)+pad
    sheet=checker(W,H); d=ImageDraw.Draw(sheet)
    for i,fn in enumerate(chunk):
        r,c=divmod(i,cols); x=pad+c*(cell+pad); y=pad+r*(cell+lbl+pad)
        im=Image.open(os.path.join(SRC,fn+".png")).convert("RGBA"); im.thumbnail((cell,cell))
        sheet.paste(im,(x+(cell-im.width)//2,y+(cell-im.height)//2),im)
        d.rectangle([x,y,x+cell,y+cell],outline=(70,70,80),width=2)
        d.text((x+4,y+cell+3),f'{fn} | cov{int(rep[fn]["cov"]*100)}% solid{int(rep[fn]["solid"]*100)}% blob{rep[fn]["blobs"]}',fill=(0,0,0),font=font)
    sheet.save(f"{OUT}/{name}.png"); print(name,len(chunk),sheet.size)
half=math.ceil(len(cand)/2)
build(cand[:half],"v_a"); build(cand[half:],"v_b")
