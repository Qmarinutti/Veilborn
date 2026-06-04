import json
rep={r["f"]:r for r in json.load(open("tools/audit.json"))}
empty=sorted([f for f,r in rep.items() if r["cov"]<0.06])
collage=sorted([f for f,r in rep.items() if r["blobs"]>=3])
# Backgrounds confirmes visuellement (box/cercle derriere le perso)
bg=sorted(["eclipsjaw","ionpaw","leviaqua","saurbud","sagethron","shiverbud",
 "rivetling","vespithron","stalagy","wavo","zapthron","zapkhan","zapfian",
 "noctkit","ryukit1","permafthron","sproutlet","stalagdrake","fulgurcrest",
 "hydrothron","clariclaw"])
bg=[b for b in bg if b in rep]
allbroken=sorted(set(empty+collage+bg))
print("EMPTY (%d): "%len(empty)+", ".join(empty))
print()
print("COLLAGE (%d): "%len(collage)+", ".join(collage))
print()
print("FOND NON DETOURE (%d): "%len(bg)+", ".join(bg))
print()
print("=> TOTAL A REGENERER: %d sprites"%len(allbroken))
json.dump(allbroken,open("tools/broken.json","w"))
