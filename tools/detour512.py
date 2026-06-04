import sys
from rembg import remove, new_session
from PIL import Image
sess=new_session('isnet-general-use')
for sid in sys.argv[1:]:
    p="public/sprites/"+sid+".png"
    with Image.open(p) as im:
        out=remove(im.convert("RGBA"),session=sess)
    # crop to content bbox + pad + resize 512
    bbox=out.getbbox()
    if bbox: out=out.crop(bbox)
    side=max(out.width,out.height); canvas=int(side*1.12)
    sq=Image.new("RGBA",(canvas,canvas),(0,0,0,0))
    sq.paste(out,((canvas-out.width)//2,(canvas-out.height)//2),out)
    sq=sq.resize((512,512),Image.LANCZOS)
    sq.save(p)
    print(sid,"detoure+512")
