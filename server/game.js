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
  // Revenu idle d'essence par seconde et par adulte = rarete * ce facteur.
  essencePerRarityPerSec: 0.02,
  // On ne crediter au max que X heures d'idle hors-ligne.
  offlineCapHours: 12,
  shinyChance: 0.02, // 2% de base
  shinyChanceWithShinyParent: 0.12,
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

// Especes de depart (communes) que recoit un nouveau joueur.
export const STARTER_IDS = ['flammkit', 'aquolet', 'sprouty'];

// --- Petit PRNG deterministe optionnel; ici on utilise Math.random ---
function rand(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }
export function randomGene() { return rand(BALANCE.maxGene + 1); }

export function rarityOf(speciesId) {
  return SPECIES[speciesId]?.rarity ?? 1;
}

// Stats effectives = base de l'espece + genes (+ bonus shiny).
export function effectiveStats(creature) {
  const sp = SPECIES[creature.species];
  const base = sp ? sp.base : { force: 8, vita: 8, speed: 8 };
  const shiny = creature.variant === 1 ? 1.1 : 1;
  return {
    force: Math.round((base.force + creature.gene_force) * shiny),
    vita:  Math.round((base.vita  + creature.gene_vita)  * shiny),
    speed: Math.round((base.speed + creature.gene_speed) * shiny),
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
