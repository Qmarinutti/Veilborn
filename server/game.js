// ============================================================
//  Donnees & logique de jeu (especes, genetique, idle, valeur)
//  Tout est "original" pour rester non-commercial (pas de marque).
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- Reglages d'equilibrage (modifiables facilement) ---
// Temps volontairement courts pour un prototype testable.
export const BALANCE = {
  startEssence: 100,
  startSlots: 2,
  maxSlots: 8,
  slotCostBase: 250, // cout du prochain slot = base * (slots possedes ^ 1.6)
  // Duree d'incubation d'un oeuf (secondes), multipliee par la rarete.
  incubationBaseSec: 120,
  // Duree de maturation bebe -> adulte (secondes), multipliee par la rarete.
  maturationBaseSec: 180,
  // Revenu idle d'essence par seconde et par adulte EN PRAIRIE = rarete * ce facteur.
  essencePerRarityPerSec: 0.02,
  // XP gagnee par seconde par un Glump en prairie (sert a monter de niveau).
  xpPerSec: 1,
  // Super Bonbon (boutique) : donne de l'XP a un Glump contre de l'essence.
  candyCost: 60,
  candyXp: 120,
  // Prairie : emplacements de farm (Glumps qui produisent de l'essence).
  prairieStartSlots: 4,
  prairieMaxSlots: 12,
  prairieSlotCostBase: 350, // cout du prochain emplacement
  // On ne crediter au max que X heures d'idle hors-ligne.
  offlineCapHours: 12,
  shinyChance: 0.002, // 0.2% (~1/500) : chromatique tres tres rare
  shinyChanceWithShinyParent: 0.02, // repro avec un parent shiny : 2%
  mutationRange: 4, // +/- sur les genes herites
  maxGene: 31,
};

// --- Especes (creatures originales) ---
// rarity 1..5 : 1 commun -> 5 legendaire
// base : stats de base de l'espece. types : pour les combats plus tard.
// Les especes sont definies dans server/species.json (facile a etendre a 200-300).
// Une entree peut ne donner que name/type/rarity : le reste a des valeurs par defaut.
const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_SPECIES = JSON.parse(readFileSync(join(__dirname, 'species.json'), 'utf8'));

// Stats de base par defaut, deduites de la rarete (si "base" non fourni).
function defaultBase(rarity) {
  return { force: 6 + rarity * 3, vita: 6 + rarity * 3, speed: 6 + rarity * 2 };
}

export const SPECIES = {};
for (const [id, sp] of Object.entries(RAW_SPECIES)) {
  const rarity = sp.rarity ?? 1;
  SPECIES[id] = {
    name: sp.name ?? id,
    type: sp.type ?? '?',
    rarity,
    base: sp.base ?? defaultBase(rarity),
    color: sp.color ?? '#8aa0c0',
    shape: sp.shape ?? 'blob',
    line: sp.line ?? null,
    stage: sp.stage ?? 1,
    evolvesTo: sp.evolvesTo ?? null,
  };
}

export const SPECIES_IDS = Object.keys(SPECIES);

// Especes de depart que recoit un nouveau joueur :
//  1) celles marquees "starter": true dans species.json ;
//  2) sinon flammkit/aquolet/sprouty si elles existent ;
//  3) sinon les 3 premieres especes definies.
let starters = Object.keys(RAW_SPECIES).filter(id => RAW_SPECIES[id]?.starter === true && SPECIES[id]);
if (!starters.length) starters = ['flammkit', 'aquolet', 'sprouty'].filter(id => SPECIES[id]);
if (!starters.length) starters = SPECIES_IDS.slice(0, 3);
export const STARTER_IDS = starters;

// --- Petit PRNG deterministe optionnel; ici on utilise Math.random ---
function rand(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }
export function randomGene() { return rand(BALANCE.maxGene + 1); }

export function rarityOf(speciesId) {
  return SPECIES[speciesId]?.rarity ?? 1;
}

// Stats effectives = base de l'espece + genes (+ bonus shiny).
// Niveau a partir de l'XP totale (paliers : 0, 100, 300, 600, 1000... = 50*L*(L-1)).
export function levelFromXp(xp) {
  return Math.min(100, Math.floor((1 + Math.sqrt(1 + (4 * (xp || 0)) / 50)) / 2));
}
// XP totale requise pour atteindre le niveau L.
export function xpForLevel(L) {
  return 50 * L * (L - 1);
}

// --- Natures : +10% sur une stat, -10% sur une autre (comme Pokemon) ---
export const NATURES = [
  { name: 'Equilibre', up: null,    down: null },
  { name: 'Costaud',   up: 'force', down: 'vita' },
  { name: 'Brutal',    up: 'force', down: 'speed' },
  { name: 'Robuste',   up: 'vita',  down: 'force' },
  { name: 'Tenace',    up: 'vita',  down: 'speed' },
  { name: 'Vif',       up: 'speed', down: 'force' },
  { name: 'Agile',     up: 'speed', down: 'vita' },
];
export function randomNature() { return NATURES[Math.floor(Math.random() * NATURES.length)].name; }
export function natureByName(name) { return NATURES.find(n => n.name === name) || NATURES[0]; }

export function effectiveStats(creature) {
  const sp = SPECIES[creature.species];
  const base = sp ? sp.base : { force: 8, vita: 8, speed: 8 };
  const shiny = creature.variant === 1 ? 1.1 : 1;
  const lvlMul = 1 + 0.03 * (levelFromXp(creature.xp || 0) - 1); // +3% par niveau
  const nat = natureByName(creature.nature);
  const natMul = (stat) => (nat.up === stat ? 1.1 : nat.down === stat ? 0.9 : 1);
  return {
    force: Math.round((base.force + creature.gene_force) * shiny * lvlMul * natMul('force')),
    vita:  Math.round((base.vita  + creature.gene_vita)  * shiny * lvlMul * natMul('vita')),
    speed: Math.round((base.speed + creature.gene_speed) * shiny * lvlMul * natMul('speed')),
  };
}

// Puissance globale d'une creature (pour combats + classement).
export function power(creature) {
  const s = effectiveStats(creature);
  return s.force + s.vita + s.speed + rarityOf(creature.species) * 10;
}

// Valeur de collection d'une creature (pour le classement / marche).
export function creatureValue(creature) {
  const genes = creature.gene_force + creature.gene_vita + creature.gene_speed;
  const r = rarityOf(creature.species);
  return Math.round((genes + r * 25) * (creature.variant === 1 ? 2 : 1));
}

// --- Reproduction : deux adultes -> un oeuf ---
// Espece de l'enfant : 50/50 entre les parents, avec une petite chance
// de "surclassement" vers une espece plus rare aleatoire.
export function breed(parentA, parentB) {
  let species = pick([parentA.species, parentB.species]);

  // 8% de chance d'obtenir une espece d'une rarete superieure (mutation rare).
  if (Math.random() < 0.08) {
    const targetRarity = Math.min(5, rarityOf(species) + 1);
    const candidates = SPECIES_IDS.filter(id => SPECIES[id].rarity === targetRarity);
    if (candidates.length) species = pick(candidates);
  }

  const inherit = (a, b) => {
    const avg = (a + b) / 2;
    const mut = rand(BALANCE.mutationRange * 2 + 1) - BALANCE.mutationRange;
    return Math.max(0, Math.min(BALANCE.maxGene, Math.round(avg + mut)));
  };

  const parentShiny = parentA.variant === 1 || parentB.variant === 1;
  const shinyChance = parentShiny ? BALANCE.shinyChanceWithShinyParent : BALANCE.shinyChance;
  const variant = Math.random() < shinyChance ? 1 : 0;

  return {
    species,
    gene_force: inherit(parentA.gene_force, parentB.gene_force),
    gene_vita:  inherit(parentA.gene_vita,  parentB.gene_vita),
    gene_speed: inherit(parentA.gene_speed, parentB.gene_speed),
    variant,
    nature: randomNature(),
  };
}

// Cree une creature "sauvage" aleatoire (starters, recompenses...).
export function wildCreature(speciesId, { adult = false } = {}) {
  const variant = Math.random() < BALANCE.shinyChance ? 1 : 0;
  return {
    species: speciesId,
    gene_force: randomGene(),
    gene_vita: randomGene(),
    gene_speed: randomGene(),
    variant,
    nature: randomNature(),
    stage: adult ? 'adult' : 'baby',
  };
}

export function incubationSeconds(speciesId) {
  return Math.round(BALANCE.incubationBaseSec * rarityOf(speciesId));
}
export function maturationSeconds(speciesId) {
  return Math.round(BALANCE.maturationBaseSec * rarityOf(speciesId));
}

export function nextSlotCost(currentSlots) {
  return Math.round(BALANCE.slotCostBase * Math.pow(currentSlots, 1.6));
}

// --- Boutique d'oeufs : achetables avec l'essence ---
// rarities = [min,max] de l'espece tiree au hasard a l'achat.
export const EGG_SHOP = [
  { id: 'common',    name: 'Oeuf commun',     emoji: '🥚', price: 80,   rarities: [1, 2] },
  { id: 'rare',      name: 'Oeuf rare',       emoji: '🥚', price: 320,  rarities: [2, 3] },
  { id: 'epic',      name: 'Oeuf epique',     emoji: '🥚', price: 950,  rarities: [3, 4] },
  { id: 'legendary', name: 'Oeuf legendaire', emoji: '🥚', price: 2800, rarities: [4, 5] },
];

// Tire une espece au hasard dans une plage de rarete.
export function randomSpeciesInRarity(min, max) {
  const pool = SPECIES_IDS.filter(id => { const r = rarityOf(id); return r >= min && r <= max; });
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : SPECIES_IDS[0];
}

// Cout du prochain emplacement de prairie (slots au-dela des 4 de depart).
export function prairieSlotCost(currentSlots) {
  const extra = Math.max(1, currentSlots - BALANCE.prairieStartSlots + 1);
  return Math.round(BALANCE.prairieSlotCostBase * Math.pow(extra, 1.8));
}

// Cout en essence pour faire evoluer vers une espece cible (selon sa rarete).
export function evolveCost(targetSpeciesId) {
  const r = rarityOf(targetSpeciesId);
  return Math.round(80 * Math.pow(r, 1.6));
}

// Espece suivante dans la lignee (ou null si forme finale / inconnue).
export function evolutionOf(speciesId) {
  const evo = SPECIES[speciesId]?.evolvesTo;
  return evo && SPECIES[evo] ? evo : null;
}

// Niveau requis pour evoluer (selon le stade actuel du Glump).
const EVOLVE_LEVEL = { 1: 16, 2: 36 };
export function evolveLevelOf(speciesId) {
  const st = SPECIES[speciesId]?.stage || 1;
  return EVOLVE_LEVEL[st] || 16;
}
