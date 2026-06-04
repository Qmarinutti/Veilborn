// Regenere les sprites de tools/broken2.json en BEST-OF-N :
// pour chaque sprite, genere (fond blanc, prompt anti-collage/cadre/texte),
// detoure+valide via measure2.py, et garde la 1ere version VALIDE (perso unique,
// sans fond, sans collage). Sinon garde la moins mauvaise apres N essais.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPRITES = join(__dirname, '..', 'public', 'sprites');
const SPECIES = JSON.parse(readFileSync(join(__dirname, '..', 'server', 'species.json'), 'utf8'));
const LIST = JSON.parse(readFileSync(join(__dirname, 'broken2.json'), 'utf8'));
const ACCOUNT = process.env.CF_ACCOUNT_ID, TOKEN = process.env.CF_API_TOKEN;
const MODEL = '@cf/bytedance/stable-diffusion-xl-lightning';
const TRIES = Number(process.env.TRIES || 6);
if (!ACCOUNT || !TOKEN) { console.error('Definis CF_ACCOUNT_ID et CF_API_TOKEN.'); process.exit(1); }

const EN = { Feu:['fire','orange red flames'],Eau:['water','blue teal fins'],Plante:['grass','green leaves'],
  Foudre:['electric','yellow lightning'],Roche:['rock','brown grey rocky'],Glace:['ice','pale blue frost'],
  Ombre:['dark','dark purple shadow'],Lumiere:['light','gold white glow'],Mystique:['psychic','pink purple aura'],
  Acier:['steel','silver metal'],Poison:['poison','purple toxic green'],Vent:['wind','white cyan wings'],
  Insecte:['bug','green carapace'],Dragon:['dragon','purple scales horns'] };
const STYLE = 'single solo creature, exactly ONE character alone in the center, one monster only, NOT a sprite sheet, no duplicate, no second character, no badge no emblem no circle no ring no halo no frame no border behind it, original cute-but-cool monster, cel-shaded, bold black outlines, vibrant colors, full body, facing forward, isolated on a plain solid pure white background, no text no letters no words';
const NEG = 'sprite sheet, multiple creatures, two characters, three characters, four, group, collage, grid, multiple poses, duplicate, reference sheet, turnaround, badge, emblem, medallion, coin, circle, ring, halo, frame, border, panel, vignette, scenery, landscape, background scene, text, letters, words, caption, watermark, signature, blurry, deformed, cropped, empty, blank';

function prompt(sp){ const [t,look]=EN[sp.type]||['creature','']; const stage=(sp.stage||1)>=3?'large powerful badass':(sp.stage||1)===2?'agile fierce':'small cute';
  return `${sp.name}, a ${stage} ${t}-type creature, ${look}, ${STYLE}`; }

async function gen(id, sp){
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`,{method:'POST',
    headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify({prompt:prompt(sp),negative_prompt:NEG,num_steps:8,width:512,height:512})});
  if((r.headers.get('content-type')||'').startsWith('image/')){ writeFileSync(join(SPRITES,`${id}.png`),Buffer.from(await r.arrayBuffer())); return true; }
  const t=await r.text(); try{const j=JSON.parse(t); if(j?.result?.image){writeFileSync(join(SPRITES,`${id}.png`),Buffer.from(j.result.image,'base64'));return true;}}catch{}
  console.log('  gen echec:', t.slice(0,120)); return false;
}
function measure(id){ try{ return JSON.parse(execSync(`python tools/measure2.py ${id}`,{cwd:join(__dirname,'..')}).toString().trim().split('\n').pop()); }catch(e){ return {ok:false,err:String(e).slice(0,80)}; } }
function badness(m){ // plus c'est haut, pire c'est
  let b=0; if(m.cov<0.16)b+=(0.16-m.cov)*10; if(m.cov>0.74)b+=(m.cov-0.74)*5;
  b+=Math.max(0,m.ratio2-0.16)*8; b+=Math.max(0,m.fill-0.82)*6; b+=m.corners*2; return b; }

const onlyArg=process.argv.slice(2);
const targets=onlyArg.length?LIST.filter(x=>onlyArg.includes(x)):LIST;
console.log(`\n  Best-of-${TRIES} sur ${targets.length} sprites\n`);
let fixed=0, kept=0;
for(const id of targets){
  if(!SPECIES[id]){ console.log(`  ?? ${id} absent species.json`); continue; }
  process.stdout.write(`  ${id} `);
  let best=null, bestB=1e9, accepted=false;
  for(let t=1;t<=TRIES;t++){
    if(!await gen(id,SPECIES[id])){ process.stdout.write('x'); await new Promise(r=>setTimeout(r,500)); continue; }
    const m=measure(id);
    if(m.ok){ console.log(` -> OK essai ${t} (cov${m.cov} r2${m.ratio2} fill${m.fill})`); accepted=true; fixed++; break; }
    const b=badness(m);
    if(b<bestB){ bestB=b; best=Buffer.from(readFileSync(join(SPRITES,`${id}.png`))); }
    process.stdout.write('.');
    await new Promise(r=>setTimeout(r,500));
  }
  if(!accepted){ if(best) writeFileSync(join(SPRITES,`${id}.png`),best); console.log(` -> garde le moins mauvais (b=${bestB.toFixed(1)})`); kept++; }
}
console.log(`\n  Termine : ${fixed} valides, ${kept} approximatifs.\n`);
