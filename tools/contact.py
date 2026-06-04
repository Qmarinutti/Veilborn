import os, math
from PIL import Image, ImageDraw, ImageFont
SRC="public/sprites"; OUT="tools/contact"
os.makedirs(OUT, exist_ok=True)
files=sorted(f for f in os.listdir(SRC) if f.lower().endswith(".png"))
cell=180; cols=6; rows=6; per=cols*rows
pad=4; lbl=16
def checker(w,h,s=12):
    img=Image.new("RGB",(w,h),(210,210,214))
    d=ImageDraw.Draw(img)
    for y in range(0,h,s):
        for x in range(0,w,s):
            if (x//s+y//s)%2: d.rectangle([x,y,x+s,y+s],fill=(170,170,176))
    return img
try: font=ImageFont.truetype("arial.ttf",13)
except: font=ImageFont.load_default()
sheets=math.ceil(len(files)/per)
for si in range(sheets):
    chunk=files[si*per:(si+1)*per]
    W=cols*(cell+pad)+pad; H=rows*(cell+lbl+pad)+pad
    sheet=checker(W,H)
    d=ImageDraw.Draw(sheet)
    for i,fn in enumerate(chunk):
        r,c=divmod(i,cols)
        x=pad+c*(cell+pad); y=pad+r*(cell+lbl+pad)
        try:
            im=Image.open(os.path.join(SRC,fn)).convert("RGBA")
            im.thumbnail((cell,cell))
            ox=x+(cell-im.width)//2; oy=y+(cell-im.height)//2
            sheet.paste(im,(ox,oy),im)
        except Exception as e:
            d.text((x+4,y+4),"ERR",fill=(200,0,0),font=font)
        d.rectangle([x,y,x+cell,y+cell],outline=(120,120,130))
        d.text((x+2,y+cell+1),fn.replace(".png",""),fill=(0,0,0),font=font)
    sheet.save(f"{OUT}/sheet_{si:02d}.png")
    print("sheet",si,"->",len(chunk),"sprites")
print("TOTAL", len(files), "in", sheets, "sheets")
