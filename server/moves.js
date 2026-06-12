// ============================================================
//  Attaques & statuts pour le PvP tour-par-tour.
//  Chaque Glump dispose de 4 attaques derivees de son TYPE :
//   - Charge   : neutre, fiable (100%).
//   - Frappe   : elementaire, bon ratio (95%).
//   - Deflagration : elementaire, gros degats mais risque de rater (78%).
//   - 4e move  : selon le type -> inflige un statut, OU soigne, OU garde.
// ============================================================

// Statut naturel par type (sinon move utilitaire : soin ou garde).
export const STATUS_BY_TYPE = {
  Feu: 'burn', Poison: 'poison', Plante: 'poison', Insecte: 'poison',
  Foudre: 'para', Mystique: 'para', Glace: 'freeze', Ombre: 'weaken',
};
// Types qui soignent au lieu d'un statut.
const HEAL_TYPES = new Set(['Eau', 'Lumiere']);

export const STATUS_INFO = {
  burn:   { name: 'Brûlure', icon: '🔥', desc: 'Perd des PV chaque tour, attaque réduite.' },
  poison: { name: 'Poison',  icon: '🟣', desc: 'Perd des PV chaque tour.' },
  para:   { name: 'Paralysie', icon: '⚡', desc: 'Risque de ne pas agir, vitesse réduite.' },
  freeze: { name: 'Gel',     icon: '❄️', desc: 'Gelé : ne peut pas agir (peut dégeler).' },
  weaken: { name: 'Affaibli', icon: '💀', desc: 'Attaque fortement réduite.' },
  guard:  { name: 'Garde',   icon: '🛡️', desc: 'Réduit les dégâts subis ce tour.' },
};

const STATUS_MOVE_NAME = { burn: 'Brasier', poison: 'Venin', para: 'Décharge', freeze: 'Blizzard', weaken: 'Malédiction' };

// Renvoie les 4 attaques d'un Glump a partir de son type.
export function movesFor(type) {
  const status = STATUS_BY_TYPE[type];
  const fourth = status
    ? { id: 'hex', name: STATUS_MOVE_NAME[status], type, power: 0.65, acc: 0.95, kind: 'status', status, chance: 0.7 }
    : HEAL_TYPES.has(type)
      ? { id: 'heal', name: 'Récupération', type, power: 0, acc: 1, kind: 'heal', heal: 0.3 }
      : { id: 'guard', name: 'Garde', type, power: 0, acc: 1, kind: 'guard' };
  return [
    { id: 'charge', name: 'Charge', type: 'Neutre', power: 1.0, acc: 1.0, kind: 'attack' },
    { id: 'strike', name: `Frappe ${type}`, type, power: 1.35, acc: 0.95, kind: 'attack' },
    // Deflagration = pari : gros coup, esperance ~= Frappe (1.55*0.82=1.27 vs 1.28) mais variance
    // plus haute (rate 18% du temps). Vrai choix risque/recompense, ni piege ni dominant.
    { id: 'burst', name: `Déflagration ${type}`, type, power: 1.55, acc: 0.82, kind: 'attack' },
    fourth,
  ];
}

// Vue "publique" des attaques (pour le client : boutons).
export function moveButtons(type) {
  return movesFor(type).map(m => ({
    id: m.id, name: m.name, type: m.type, kind: m.kind,
    power: m.power, acc: m.acc,
    status: m.status || null, heal: m.heal || null,
  }));
}
