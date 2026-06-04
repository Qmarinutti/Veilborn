import sys, json, numpy as np
from PIL import Image
from scipy import ndimage
ids=json.load(open('tools/broken2.json'))
cleaned=0
for sid in ids:
    p="public/sprites/"+sid+".png"
    im=Image.open(p).convert("RGBA"); a=np.array(im); al=a[:,:,3]
    mask=al>30
    lbl,n=ndimage.label(mask)
    if n<=1: continue
    sizes=ndimage.sum(mask,lbl,range(1,n+1))
    biggest=sizes.max()
    keep=set(i+1 for i,s in enumerate(sizes) if s>=biggest*0.08)
    if len(keep)==n: continue
    newmask=np.isin(lbl,list(keep))
    a[:,:,3]=np.where(newmask,al,0)
    out=Image.fromarray(a)
    bbox=out.getbbox()
    if bbox: out=out.crop(bbox)
    side=max(out.width,out.height); canvas=int(side*1.12)
    sq=Image.new("RGBA",(canvas,canvas),(0,0,0,0))
    sq.paste(out,((canvas-out.width)//2,(canvas-out.height)//2),out)
    sq.resize((512,512),Image.LANCZOS).save(p)
    print("nettoye",sid,"(",n,"->",len(keep),"blobs)")
    cleaned+=1
print("total nettoyes:",cleaned)
