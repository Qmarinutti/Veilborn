// ============================================================
//  Donnees & logique de jeu (especes, genetique, idle, valeur)
//  Tout est "original" pour rester non-commercial (pas de marque).
// ============================================================

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
// shape = silhouette dessinee cote client (voir public/js/sprites.js)
export const SPECIES = {
  flammkit:   { name: 'Flammkit',   type: 'Feu',     rarity: 1, base: { force: 10, vita: 8,  speed: 9  }, color: '#e8623a', shape: 'beast' },
  aquolet:    { name: 'Aquolet',    type: 'Eau',     rarity: 1, base: { force: 8,  vita: 11, speed: 8  }, color: '#3a9be8', shape: 'blob' },
  sprouty:    { name: 'Sprouty',    type: 'Plante',  rarity: 1, base: { force: 7,  vita: 12, speed: 7  }, color: '#4caf50', shape: 'sprout' },
  zappup:     { name: 'Zappup',     type: 'Foudre',  rarity: 2, base: { force: 11, vita: 7,  speed: 13 }, color: '#f2c037', shape: 'beast' },
  rockling:   { name: 'Rockling',   type: 'Roche',   rarity: 2, base: { force: 13, vita: 14, speed: 4  }, color: '#9b7a55', shape: 'rock' },
  frostnip:   { name: 'Frostnip',   type: 'Glace',   rarity: 3, base: { force: 12, vita: 11, speed: 10 }, color: '#7ed4e6', shape: 'blob' },
  shadepaw:   { name: 'Shadepaw',   type: 'Ombre',   rarity: 3, base: { force: 14, vita: 10, speed: 12 }, color: '#6a5acd', shape: 'ghost' },
  gleamwing:  { name: 'Gleamwing',  type: 'Lumiere', rarity: 4, base: { force: 13, vita: 13, speed: 15 }, color: '#ffd966', shape: 'bird' },
  terradon:   { name: 'Terradon',   type: 'Roche',   rarity: 4, base: { force: 18, vita: 17, speed: 6  }, color: '#b5651d', shape: 'dino' },
  mythira:    { name: 'Mythira',    type: 'Mystique',rarity: 5, base: { force: 20, vita: 18, speed: 16 }, color: '#e75da8', shape: 'fairy' },
};

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
  const shiny = creature.variant === 1 ? 1.1 : 1;
  return {
    force: Math.round((sp.base.force + creature.gene_force) * shiny),
    vita:  Math.round((sp.base.vita  + creature.gene_vita)  * shiny),
    speed: Math.round((sp.base.speed + creature.gene_speed) * shiny),
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
