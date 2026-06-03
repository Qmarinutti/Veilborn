// =====================================================================
//  Generateur de species.json a partir de tools/glumps.txt
//  Usage :  npm run gen
// =====================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT = join(__dirname, 'glumps.txt');
const OUTPUT = join(__dirname, '..', 'server', 'species.json');

// Couleur de base par type (utilisee pour le sprite SVG de secours).
const TYPE_COLOR = {
  Feu: '#ff7a45', Eau: '#46b0ef', Plante: '#5fc463', Foudre: '#f2c037',
  Roche: '#9b7a55', Glace: '#7ed4e6', Ombre: '#6a5acd', Lumiere: '#ffd966',
  Mystique: '#e75da8', Acier: '#9fb0c9', Poison: '#a96bd6', Vent: '#8fe3c2',
};
const DEFAULT_COLOR = '#8aa0c0';
// Rarete auto par stade si non precisee.
const RARITY_RAMP = [1, 2, 4, 5, 5];

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function shade(hex, p) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  const t = p < 0 ? 0 : 255, a = Math.abs(p);
  return '#' + c.map(v => Math.round(v + (t - v) * a).toString(16).padStart(2, '0')).join('');
}
// Forme (silhouette SVG) auto selon type + stade.
function shapeFor(type, i) {
  if (type === 'Eau') return i === 0 ? 'blob' : 'serpent';
  if (type === 'Plante') return i === 0 ? 'sprout' : i === 1 ? 'beast' : 'dino';
  return i === 0 ? 'beast' : i === 1 ? 'beast' : 'dino';
}

const lines = readFileSync(INPUT, 'utf8').split(/\r?\n/);
const species = {};
let chains = 0, count = 0;

for (const raw of lines) {
  let line = raw.trim();
  if (!line || line.startsWith('#')) continue;

  let starter = false;
  if (line.startsWith('*')) { starter = true; line = line.slice(1).trim(); }

  const bar = line.indexOf('|');
  if (bar === -1) { console.warn(`! Ligne ignoree (pas de "|") : ${raw}`); continue; }
  const type = line.slice(0, bar).trim();
  const members = line.slice(bar + 1).split('>').map(m => m.trim()).filter(Boolean);
  if (!members.length) continue;

  chains++;
  const ids = members.map(m => slug(m.split(':')[0]));
  const lineId = ids[0];

  members.forEach((m, i) => {
    const [namePart, rarPart] = m.split(':');
    const name = namePart.trim();
    const id = ids[i];
    const rarity = rarPart ? Math.max(1, Math.min(5, parseInt(rarPart, 10))) : (RARITY_RAMP[i] ?? 5);
    if (species[id]) console.warn(`! Id en double "${id}" (${name}) - ecrase le precedent.`);
    species[id] = {
      name,
      type,
      rarity,
      color: shade(TYPE_COLOR[type] || DEFAULT_COLOR, -0.12 * i),
      shape: shapeFor(type, i),
      line: lineId,
      stage: i + 1,
      evolvesTo: ids[i + 1] || null,
    };
    if (starter && i === 0) species[id].starter = true;
    count++;
  });
}

writeFileSync(OUTPUT, JSON.stringify(species, null, 2) + '\n', 'utf8');
console.log(`\n  OK : ${count} Glumps (${chains} lignees) -> ${OUTPUT}\n`);
