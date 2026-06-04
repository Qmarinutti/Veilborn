// =====================================================================
//  Regenere UNIQUEMENT les sprites casses listes dans tools/broken.json
//  (vides, collages multi-perso, fonds non detoures).
//  Prompt durci + FOND BLANC UNI (bien plus fiable a detourer ensuite).
//
//  Usage (PowerShell) :
//    $env:CF_ACCOUNT_ID="6212bae32e6a3ca244588c3805041a23"
//    $env:CF_API_TOKEN="<ton_token_workers_ai>"
//    node tools/regen-broken.mjs            # regenere les 43
//    node tools/regen-broken.mjs floracub   # regenere seulement floracub (test)
//  Ensuite : python tools/rembg_all.py  (ou le detourage cible affiche a la fin)
// =====================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPRITES_DIR = join(__dirname, '..', 'public', 'sprites');
const SPECIES = JSON.parse(readFileSync(join(__dirname, '..', 'server', 'species.json'), 'utf8'));
const BROKEN = JSON.parse(readFileSync(join(__dirname, 'broken.json'), 'utf8'));

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const MODEL = process.env.CF_MODEL || '@cf/bytedance/stable-diffusion-xl-lightning';

if (!ACCOUNT || !TOKEN) {
  console.error('\n  /!\\ Definis CF_ACCOUNT_ID et CF_API_TOKEN avant de lancer.\n');
  process.exit(1);
}

const EN = {
  Feu: ['fire', 'bright orange and red, flames and embers'], Eau: ['water', 'blue and teal, fins and water'],
  Plante: ['grass', 'vivid green, leaves and vines'], Foudre: ['electric', 'yellow, lightning sparks'],
  Roche: ['rock', 'brown and grey, rocky plates'], Glace: ['ice', 'pale blue, ice crystals and frost'],
  Ombre: ['dark', 'dark purple and black, shadowy wisps'], Lumiere: ['light', 'gold and white, glowing halo'],
  Mystique: ['psychic', 'pink and purple, magic runes and aura'], Acier: ['steel', 'silver metal plates'],
  Poison: ['poison', 'purple and toxic green, acid'], Vent: ['wind', 'white and cyan, wings and air swirls'],
  Insecte: ['bug', 'green and brown, carapace and antennae'], Dragon: ['dragon', 'deep purple, scales horns and wings'],
};

// Prompt durci : 1 seul perso, plein cadre, FOND BLANC UNI, pas de cadre/texte.
const STYLE = 'single solo creature, exactly one character, one monster alone, original cute-but-cool monster, game mascot, cel-shaded, bold clean black outlines, vibrant saturated colors, full body, large and centered filling the frame, facing forward, isolated on a plain solid pure white background, studio lighting, high quality, no text';

function promptFor(sp) {
  const [enType, enLook] = EN[sp.type] || ['', ''];
  const stage = (sp.stage || 1) >= 3 ? 'large powerful and badass'
    : (sp.stage || 1) === 2 ? 'agile and fierce' : 'small cute';
  return `${sp.name}, a ${stage} ${enType}-type creature, ${enLook}, ${STYLE}`;
}

const NEG = 'sprite sheet, multiple creatures, two characters, three characters, group, crowd, collage, grid of images, multiple poses, duplicate, panel, frame, border, rounded frame, vignette, padding, empty, blank, scenery background, landscape, text, words, letters, watermark, signature, blurry, low quality, deformed, cropped, cut off';

async function generate(id, sp) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: promptFor(sp), negative_prompt: NEG, num_steps: 8, width: 512, height: 512 }),
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.startsWith('image/')) {
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(SPRITES_DIR, `${id}.png`), buf);
    return { ok: true, bytes: buf.length };
  }
  const txt = await res.text();
  try {
    const j = JSON.parse(txt);
    if (j?.result?.image) { writeFileSync(join(SPRITES_DIR, `${id}.png`), Buffer.from(j.result.image, 'base64')); return { ok: true }; }
    return { ok: false, error: JSON.stringify(j.errors || j) };
  } catch { return { ok: false, error: `${res.status} ${txt.slice(0, 160)}` }; }
}

const only = process.argv.slice(2);
const targets = only.length ? BROKEN.filter(id => only.includes(id)) : BROKEN;
console.log(`\n  Regeneration de ${targets.length} sprites casses (fond blanc, prompt durci)\n`);
let made = 0, failed = 0;
for (const id of targets) {
  if (!SPECIES[id]) { console.log(`  ?? ${id} absent de species.json`); continue; }
  process.stdout.write(`  ${id} ... `);
  try {
    const r = await generate(id, SPECIES[id]);
    if (r.ok) { made++; console.log('OK'); }
    else { failed++; console.log(`ECHEC: ${r.error}`); if (/rate|quota|limit|429|capacity/i.test(r.error)) { console.log('\n  Limite atteinte — relance plus tard.'); break; } }
  } catch (e) { failed++; console.log(`ERREUR: ${e.message}`); }
  await new Promise(r => setTimeout(r, 600));
}
console.log(`\n  Termine : ${made} regeneres, ${failed} echecs.`);
console.log(`  -> Detoure ensuite : python tools/rembg_all.py\n`);
