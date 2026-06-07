// Cree un dossier "sprites_dex_order" avec les sprites copies + numerotes dans l'ORDRE DU DEX
// (ordre du species.json). Ne touche PAS au dossier de jeu (public/sprites reste en <id>.png).
import { readFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const SP = JSON.parse(readFileSync('server/species.json', 'utf8'));
const ids = Object.keys(SP); // ordre du species.json = ordre du dex
const out = 'sprites_dex_order';
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let ok = 0, miss = 0;
ids.forEach((id, i) => {
  const n = String(i + 1).padStart(3, '0');
  const src = join('public', 'sprites', id + '.png');
  if (existsSync(src)) { copyFileSync(src, join(out, `${n}_${id}.png`)); ok++; } else miss++;
});
console.log('Especes (ordre du dex):', ids.length);
console.log('Copies creees:', ok, '| manquantes:', miss);
console.log('Dossier:', join(process.cwd(), out));
console.log('Exemples:', '001_' + ids[0] + '.png,', '002_' + ids[1] + '.png,', '003_' + ids[2] + '.png ...');
