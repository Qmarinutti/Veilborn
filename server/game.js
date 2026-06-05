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
  startEssence: 300, // de quoi acheter un 1er oeuf sans soft-lock au demarrage
  startSlots: 2,
  maxSlots: 8,
  slotCostBase: 250, // cout du prochain slot = base * (slots possedes ^ 1.6)
  // Duree d'incubation d'un oeuf (secondes), multipliee par la rarete.
  incubationBaseSec: 120,
  // Reproduction en 2 PHASES (chaque phase x rarete d'acquisition) :
  //  1) accouplement : les 2 parents sont occupes (ne farment pas) -> pond un oeuf
  //  2) eclosion : l'oeuf eclot en bebe.
  breedingBaseSec: 300,        // (total indicatif, conserve pour compat)
  reproductionBaseSec: 120,    // phase 1 : accouplement
  breedHatchBaseSec: 180,      // phase 2 : eclosion de l'oeuf pondu
  breedingStartCells: 1,
  breedingMaxCells: 5,
  // Cout pour debloquer la cellule 2, 3, 4, 5 (tres cher exprès).
  breedingCellCosts: [25000, 50000, 250000, 1000000],
  // Duree de maturation bebe -> adulte (secondes), multipliee par la rarete.
  maturationBaseSec: 180,
  // Revenu idle d'essence par seconde et par adulte EN PRAIRIE = rarete * ce facteur.
  essencePerRarityPerSec: 0.04, // double : early-game moins lent
  // XP gagnee par seconde par un Glump en prairie (sert a monter de niveau).
  xpPerSec: 1,
  // Super Bonbon (boutique) : donne de l'XP a un Glump contre de l'essence.
  candyCost: 60,
  candyXp: 120,
  // Soins (boutique) : Potion = PV au max ; Rappel = ranime un Glump KO a la moitie.
  potionCost: 80,
  reviveCost: 150,
  // Prairie : emplacements de farm (Glumps qui produisent de l'essence).
  prairieStartSlots: 4,
  prairieMaxSlots: 12,
  prairieSlotCostBase: 350, // cout du prochain emplacement
  // On ne crediter au max que X heures d'idle hors-ligne.
  offlineCapHours: 12,
  shinyChance: 0.002, // 0.2% (~1/500) : chromatique tres tres rare
  shinyChanceWithShinyParent: 0.02, // repro avec un parent shiny : 2%
  // Shiny hunting : chaque eclosion non-shiny augmente un peu le taux (pitie),
  // remis a zero quand un shiny apparait. Recompense la perseverance.
  shinyPityStep: 0.0004, // +0.04% par eclosion non-shiny
  shinyPityMax: 0.05,    // plafond du bonus de pitie (5%)
  // PvP / Arene
  pvpStartTrophies: 1000,
  pvpWinTrophies: 25,
  pvpLoseTrophies: 15,
  pvpWinEssence: 200,
  pvpTeamSize: 3,
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
export const SPECIES_COUNT = SPECIES_IDS.length;

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

// Genes garantis d'un Glump CHROMATIQUE : 2 stats parfaites (31) + 1 stat >= 15.
// -> donne des shiny puissants (ex : 31/31/19 ou 31/31/31).
export function shinyGenes() {
  const keys = ['gene_force', 'gene_vita', 'gene_speed'];
  for (let i = keys.length - 1; i > 0; i--) { const j = rand(i + 1); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  const g = {};
  g[keys[0]] = BALANCE.maxGene;
  g[keys[1]] = BALANCE.maxGene;
  g[keys[2]] = 15 + rand(BALANCE.maxGene - 15 + 1); // 15..31
  return g;
}

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

// PV max d'un Glump (doit matcher makeFighter dans battle.js).
export function maxHpOf(creature) {
  return effectiveStats(creature).vita * 4 + 30;
}

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

// --- Rarete d'ACQUISITION (taux de drop) par lignee/famille ---
// 1=Commun, 2=Rare, 3=Epique, 4=Legendaire. Attribue de façon deterministe
// par hash de la lignee (ajustable plus tard). Tous les membres d'une famille
// partagent la rarete d'acquisition de la famille.
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
export function lineOf(speciesId) { return SPECIES[speciesId]?.line || speciesId; }
export function tierOf(speciesId) {
  const r = hashStr(lineOf(speciesId)) % 100;
  if (r < 3) return 4;    // Legendaire 3%
  if (r < 15) return 3;   // Epique 12%
  if (r < 40) return 2;   // Rare 25%
  return 1;               // Commun 60%
}
export const TIER_NAMES = { 1: 'Commun', 2: 'Rare', 3: 'Epique', 4: 'Legendaire' };

// Formes de BASE (stade 1) regroupees par rarete d'acquisition.
const BASE_BY_TIER = { 1: [], 2: [], 3: [], 4: [] };
for (const id of SPECIES_IDS) {
  if ((SPECIES[id].stage || 1) === 1) BASE_BY_TIER[tierOf(id)].push(id);
}
// Tirage pondere d'une rarete a la reproduction.
function rollTier() {
  const r = Math.random() * 100;
  if (r < 1 && BASE_BY_TIER[4].length) return 4;   // Legendaire 1%
  if (r < 7 && BASE_BY_TIER[3].length) return 3;    // Epique 6%
  if (r < 28 && BASE_BY_TIER[2].length) return 2;   // Rare 21%
  return 1;                                         // Commun 72%
}

// --- Reproduction : deux adultes -> un oeuf qui donnera un BEBE (forme de base).
// On ne donne JAMAIS une forme evoluee : juste un stade 1, dont la rarete
// d'acquisition est tiree au sort (le joueur le fait evoluer ensuite).
export function breed(parentA, parentB, { pityBonus = 0 } = {}) {
  const tier = rollTier();
  const pool = BASE_BY_TIER[tier].length ? BASE_BY_TIER[tier] : BASE_BY_TIER[1];
  const species = pick(pool);

  const inherit = (a, b) => {
    const avg = (a + b) / 2;
    const mut = rand(BALANCE.mutationRange * 2 + 1) - BALANCE.mutationRange;
    return Math.max(0, Math.min(BALANCE.maxGene, Math.round(avg + mut)));
  };

  const parentShiny = parentA.variant === 1 || parentB.variant === 1;
  const base = parentShiny ? BALANCE.shinyChanceWithShinyParent : BALANCE.shinyChance;
  const variant = Math.random() < (base + pityBonus) ? 1 : 0;

  // Chromatique = genes garantis (2x31 + 1>=15), sinon heritage des parents.
  const genes = variant === 1 ? shinyGenes() : {
    gene_force: inherit(parentA.gene_force, parentB.gene_force),
    gene_vita:  inherit(parentA.gene_vita,  parentB.gene_vita),
    gene_speed: inherit(parentA.gene_speed, parentB.gene_speed),
  };
  return { species, ...genes, variant, nature: randomNature() };
}

// Cree une creature "sauvage" aleatoire (starters, recompenses...).
export function wildCreature(speciesId, { adult = false, pityBonus = 0 } = {}) {
  const variant = Math.random() < (BALANCE.shinyChance + pityBonus) ? 1 : 0;
  const genes = variant === 1 ? shinyGenes() : {
    gene_force: randomGene(), gene_vita: randomGene(), gene_speed: randomGene(),
  };
  return {
    species: speciesId,
    ...genes,
    variant,
    nature: randomNature(),
    stage: adult ? 'adult' : 'baby',
  };
}

export function incubationSeconds(speciesId) {
  return Math.round(BALANCE.incubationBaseSec * rarityOf(speciesId));
}
// Temps d'un oeuf de reproduction : depend de la rarete d'ACQUISITION (famille).
export function breedingSeconds(speciesId) {
  return Math.round(BALANCE.breedingBaseSec * tierOf(speciesId));
}
// Phase 1 (accouplement) puis phase 2 (eclosion de l'oeuf pondu), chacune x tier.
export function reproductionSeconds(speciesId) {
  return Math.round(BALANCE.reproductionBaseSec * tierOf(speciesId));
}
export function breedHatchSeconds(speciesId) {
  return Math.round(BALANCE.breedHatchBaseSec * tierOf(speciesId));
}
// Cout de la prochaine cellule de reproduction (cellule 2,3,4,5).
export function breedingCellCost(currentCells) {
  return BALANCE.breedingCellCosts[currentCells - 1] ?? null;
}
export function maturationSeconds(speciesId) {
  return Math.round(BALANCE.maturationBaseSec * rarityOf(speciesId));
}

export function nextSlotCost(currentSlots) {
  return Math.round(BALANCE.slotCostBase * Math.pow(currentSlots, 1.6));
}

// --- Boutique : oeufs par ELEMENT (pure chance, pas de rarete affichee) ---
// On achete un oeuf d'un element -> bebe (forme de base) aleatoire de cet element.
export const ELEMENTS = ['Feu', 'Eau', 'Plante', 'Foudre', 'Roche', 'Glace', 'Ombre', 'Lumiere', 'Mystique', 'Acier', 'Poison', 'Vent', 'Insecte', 'Dragon'];
export const SHOP_EGG_PRICE = 250; // oeuf BASIQUE (type aleatoire), paye en essence

export function randomBaseOfType(type) {
  const pool = SPECIES_IDS.filter(id => (SPECIES[id].stage || 1) === 1 && SPECIES[id].type === type);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : SPECIES_IDS[0];
}
// Bebe de base totalement aleatoire (oeuf basique).
export function randomBase() {
  const pool = SPECIES_IDS.filter(id => (SPECIES[id].stage || 1) === 1);
  return pool[Math.floor(Math.random() * pool.length)] || SPECIES_IDS[0];
}

// =====================================================================
//  BIOMES : zones de farm. Chaque biome produit UNE ressource ; on y
//  assigne des Glumps. Un Glump dont le TYPE correspond au biome gagne
//  un bonus de synergie. La Plaine (depart) produit l'essence (monnaie).
// =====================================================================
export const SYNERGY_BONUS = 0.25; // +25% si le type du Glump correspond au biome
export const BIOMES = {
  plaine:     { id: 'plaine',     name: 'Plaine',     emoji: '🌳', types: [],                            resource: 'essence', resName: 'Essence',  resEmoji: '✨', cost: 0 },
  volcan:     { id: 'volcan',     name: 'Volcan',     emoji: '🌋', types: ['Feu', 'Acier'],              resource: 'magma',   resName: 'Magma',    resEmoji: '🌋', cost: 5000 },
  ocean:      { id: 'ocean',      name: 'Océan',      emoji: '🌊', types: ['Eau', 'Glace'],              resource: 'ecume',   resName: 'Écume',    resEmoji: '🌊', cost: 5000 },
  foret:      { id: 'foret',      name: 'Forêt',      emoji: '🌲', types: ['Plante', 'Insecte'],         resource: 'spores',  resName: 'Spores',   resEmoji: '🍃', cost: 5000 },
  desert:     { id: 'desert',     name: 'Désert',     emoji: '🏜️', types: ['Roche', 'Poison'],           resource: 'sable',   resName: 'Sable',    resEmoji: '🏜️', cost: 5000 },
  cieux:      { id: 'cieux',      name: 'Cieux',      emoji: '⛈️', types: ['Foudre', 'Vent', 'Dragon'],  resource: 'orage',   resName: 'Orage',    resEmoji: '⚡', cost: 8000 },
  sanctuaire: { id: 'sanctuaire', name: 'Sanctuaire', emoji: '🔮', types: ['Ombre', 'Lumiere', 'Mystique'], resource: 'eclat', resName: 'Éclat',  resEmoji: '🔮', cost: 8000 },
};
export const BIOME_LIST = Object.values(BIOMES);
export const BIOME_IDS = Object.keys(BIOMES);
export const RESOURCES = [...new Set(BIOME_LIST.map(b => b.resource))]; // essence, magma, ecume...
// Type -> biome correspondant (pour la synergie + le cout des oeufs typés).
export const BIOME_OF_TYPE = {};
for (const b of BIOME_LIST) for (const t of b.types) BIOME_OF_TYPE[t] = b.id;

export const TYPE_EGG_COST = 200; // cout d'un oeuf typé, dans la ressource du biome
export function biomeOf(id) { return BIOMES[id] || null; }

// =====================================================================
//  EXPLORATION : on envoie des Glumps explorer une zone liee a un biome.
//  Chaque zone a 5 difficultes, debloquees selon les MONSTRES qu'on possede
//  (X monstres du type de la zone au niveau Y). Recompenses selon la difficulte.
// =====================================================================
// Recompenses equilibrees : la ressource (~1000-1900/heure selon la difficulte) + des
// objets et des oeufs typés (la vraie valeur, introuvable au farm). Les oeufs ne sont
// crees que si des incubateurs sont libres.
export const EXPLORE_TIERS = [
  { id: 'facile',     name: 'Facile',     count: 3, level: 10,  durationSec: 10 * 60,   res: 200,   items: 1, eggs: 1, eggChance: 0.6 },
  { id: 'normal',     name: 'Normal',     count: 4, level: 25,  durationSec: 45 * 60,   res: 800,   items: 2, eggs: 1, eggChance: 1 },
  { id: 'difficile',  name: 'Difficile',  count: 4, level: 50,  durationSec: 2 * 3600,  res: 2800,  items: 3, eggs: 2, eggChance: 1 },
  { id: 'hard',       name: 'Hard',       count: 2, level: 80,  durationSec: 5 * 3600,  res: 8000,  items: 4, eggs: 2, eggChance: 1 },
  { id: 'impossible', name: 'Impossible', count: 3, level: 100, durationSec: 12 * 3600, res: 22000, items: 6, eggs: 3, eggChance: 1 },
];
export const EXPLORE_TIER_BY_ID = Object.fromEntries(EXPLORE_TIERS.map(t => [t.id, t]));
export const EXPLORE_ITEMS = ['candy', 'candy', 'potion', 'revive']; // pondere : un peu plus de bonbons

// Zones d'exploration : une par biome special (hors Plaine).
// Les types ACCEPTES sont tous ceux du biome (ex. Foret = Plante OU Insecte) ; le compte
// requis est le TOTAL parmi ces types (3 Glumps Plante/Insecte au total, pas 3 d'un seul).
export const EXPLORE_ZONES = BIOME_LIST.filter(b => b.id !== 'plaine').map(b => ({
  id: b.id, name: b.name, emoji: b.emoji,
  types: b.types, typesLabel: b.types.join('/'),
  resource: b.resource, resName: b.resName, resEmoji: b.resEmoji,
}));
export const EXPLORE_ZONE_BY_ID = Object.fromEntries(EXPLORE_ZONES.map(z => [z.id, z]));
export function biomeBuyCost(id) { return BIOMES[id] ? BIOMES[id].cost : null; }
// Le Glump de type t gagne-t-il le bonus dans ce biome ?
export function isSynergy(biomeId, type) { return !!BIOMES[biomeId]?.types.includes(type); }

// Cout pour accelerer (terminer) un oeuf : ~1 essence par seconde restante.
export function accelerateCost(remainingMs) {
  return Math.max(40, Math.ceil(Math.max(0, remainingMs) / 1000));
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

// Bonus de pitie shiny accumule (plafonne) a partir du compteur d'eclosions non-shiny.
export function shinyPityBonus(pity) {
  return Math.min(BALANCE.shinyPityMax, (pity || 0) * BALANCE.shinyPityStep);
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
