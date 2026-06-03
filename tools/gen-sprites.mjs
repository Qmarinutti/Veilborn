// =====================================================================
//  Genere les sprites des Glumps via Cloudflare Workers AI (gratuit).
//  Depose les images dans public/sprites/<id>.png (detection auto par le jeu).
//  Reprenable : saute les sprites deja generes.
//
//  Pre-requis : un compte Cloudflare gratuit + un token API "Workers AI".
//  Usage (PowerShell) :
//    $env:CF_ACCOUNT_ID="ton_account_id"
//    $env:CF_API_TOKEN="ton_token"
//    node tools/gen-sprites.mjs           # genere tout (300)
//    node tools/gen-sprites.mjs 9         # genere seulement les 9 premiers (test)
// =====================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPRITES_DIR = join(__dirname, '..', 'public', 'sprites');
const SPECIES = JSON.parse(readFileSync(join(__dirname, '..', 'server', 'species.json'), 'utf8'));

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
// SDXL-lightning : rapide, peu couteux, renvoie un PNG binaire.
const MODEL = process.env.CF_MODEL || '@cf/bytedance/stable-diffusion-xl-lightning';
const LIMIT = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;

if (!ACCOUNT || !TOKEN) {
  console.error('\n  /!\\ Definis CF_ACCOUNT_ID et CF_API_TOKEN avant de lancer.\n' +
    '  PowerShell : $env:CF_ACCOUNT_ID="..."; $env:CF_API_TOKEN="..."; node tools/gen-sprites.mjs\n');
  process.exit(1);
}
if (!existsSync(SPRITES_DIR)) mkdirSync(SPRITES_DIR, { recursive: true });

// Ambiance anglaise par type (pour des prompts coherents).
const EN = {
  Feu:['fire','bright orange and red, flames and embers'], Eau:['water','blue and teal, fins and water'],
  Plante:['grass','vivid green, leaves and vines'], Foudre:['electric','yellow, lightning sparks'],
  Roche:['rock','brown and grey, rocky plates'], Glace:['ice','pale blue, ice crystals and frost'],
  Ombre:['dark','dark purple and black, shadowy wisps'], Lumiere:['light','gold and white, glowing halo'],
  Mystique:['psychic','pink and purple, magic runes and aura'], Acier:['steel','silver metal plates'],
  Poison:['poison','purple and toxic green, acid'], Vent:['wind','white and cyan, wings and air swirls'],
  Insecte:['bug','green and brown, carapace and antennae'], Dragon:['dragon','deep purple, scales horns and wings'],
};
const STYLE = 'a single solo creature, one character only, original creature design, cute but cool monster, game mascot, cel-shaded, bold clean outlines, vibrant saturated colors, full body, centered portrait, simple flat pastel background, high quality, no text, no watermark';

function promptFor(sp) {
  const [enType, enLook] = EN[sp.type] || ['', ''];
  const stage = (sp.stage || 1) >= 3 ? 'large powerful and badass'
    : (sp.stage || 1) === 2 ? 'agile and fierce' : 'small cute';
  return `${sp.name}, a ${stage} ${enType}-type creature, ${enLook}, ${STYLE}`;
}

async function generate(id, sp) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: promptFor(sp),
      negative_prompt: 'multiple creatures, two characters, group, crowd, duplicate, text, words, letters, watermark, blurry, low quality, deformed, ugly',
      num_steps: 8, width: 512, height: 512,
    }),
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.startsWith('image/')) {
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(SPRITES_DIR, `${id}.png`), buf);
    return { ok: true, bytes: buf.length };
  }
  // Modele Flux : renvoie du JSON base64 ; ou erreur.
  const txt = await res.text();
  try {
    const j = JSON.parse(txt);
    if (j?.result?.image) {
      writeFileSync(join(SPRITES_DIR, `${id}.png`), Buffer.from(j.result.image, 'base64'));
      return { ok: true, bytes: j.result.image.length };
    }
    return { ok: false, error: JSON.stringify(j.errors || j) };
  } catch {
    return { ok: false, error: `${res.status} ${txt.slice(0, 160)}` };
  }
}

const ids = Object.keys(SPECIES);
let done = 0, made = 0, skipped = 0, failed = 0;
console.log(`\n  Generation de sprites (modele ${MODEL}) — ${Math.min(LIMIT, ids.length)} cibles\n`);

for (const id of ids) {
  if (made >= LIMIT) break;
  done++;
  if (existsSync(join(SPRITES_DIR, `${id}.png`))) { skipped++; continue; }
  process.stdout.write(`  [${done}/${ids.length}] ${id} ... `);
  try {
    const r = await generate(id, SPECIES[id]);
    if (r.ok) { made++; console.log(`OK (${Math.round(r.bytes / 1024)} Ko)`); }
    else { failed++; console.log(`ECHEC: ${r.error}`); if (/rate|quota|limit|429|capacity/i.test(r.error)) { console.log('\n  Limite atteinte — relance plus tard, le script reprendra ou il s\'est arrete.'); break; } }
  } catch (e) { failed++; console.log(`ERREUR: ${e.message}`); }
  await new Promise(r => setTimeout(r, 600)); // petite pause entre les images
}

console.log(`\n  Termine : ${made} generes, ${skipped} deja presents, ${failed} echecs.\n`);
