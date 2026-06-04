import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname=dirname(fileURLToPath(import.meta.url));
const SPECIES=JSON.parse(readFileSync(join(__dirname,'..','server','species.json'),'utf8'));
const LIST=JSON.parse(readFileSync(join(__dirname, process.argv[2]||'stillbad.json'),'utf8'));
const ACCOUNT=process.env.CF_ACCOUNT_ID,TOKEN=process.env.CF_API_TOKEN;
const EN={Feu:['fire','orange red flames'],Eau:['water','blue teal fins'],Plante:['grass','green leaves'],Foudre:['electric','yellow lightning'],Roche:['rock','brown rocky'],Glace:['ice','pale blue frost'],Ombre:['dark','dark purple shadow'],Lumiere:['light','gold white glow'],Mystique:['psychic','pink purple aura'],Acier:['steel','silver metal'],Poison:['poison','toxic green'],Vent:['wind','white cyan wings'],Insecte:['bug','green carapace'],Dragon:['dragon','purple scales']};
function prompt(sp){const[t,look]=EN[sp.type]||['creature','']; const st=(sp.stage||1)>=3?'large powerful':(sp.stage||1)===2?'fierce':'small cute';
 return `one single ${st} ${t}-type creature monster named ${sp.name}, ${look}, ONE character only, solo, centered, full body portrait, big and filling the frame, cute but cool video game monster mascot, cel shaded, thick black outlines, vibrant colors, isolated on plain solid white background, no text, no words, NOT a sprite sheet, no grid, no multiple poses`;}
async function gen(id,sp){
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/black-forest-labs/flux-1-schnell`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({prompt:prompt(sp),steps:8})});
  const j=await r.json();
  if(j?.result?.image){writeFileSync(join(__dirname,'..','public','sprites',`${id}.png`),Buffer.from(j.result.image,'base64'));return true;}
  console.log('echec',id,JSON.stringify(j.errors||'').slice(0,100));return false;
}
for(const id of LIST){ process.stdout.write('  '+id+' '); console.log(await gen(id,SPECIES[id])?'OK':'X'); await new Promise(r=>setTimeout(r,500)); }
