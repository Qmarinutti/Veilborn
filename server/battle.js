// =====================================================================
//  Moteur de combat PvP : table d'efficacite des types + simulation auto.
// =====================================================================

// Chaque type est "fort" (x1.6) contre ceux listes. L'inverse donne une
// resistance (x0.7). Sinon x1.
// Table reequilibree : chaque type a 2-3 forces (avant : Feu/Roche en avaient 4, Dragon 1).
// Plus aucune paire mutuellement super-efficace (avant Ombre<->Lumiere s'annulaient).
// Dragon et Mystique ne sont plus des types-poubelles ; Lumiere a desormais une faiblesse (Vent).
export const STRONG = {
  Feu:      ['Plante', 'Glace', 'Acier'],
  Eau:      ['Feu', 'Roche'],
  Plante:   ['Eau', 'Roche'],
  Foudre:   ['Eau', 'Vent'],
  Roche:    ['Feu', 'Insecte', 'Vent'],
  Glace:    ['Plante', 'Dragon', 'Vent'],
  Ombre:    ['Mystique', 'Poison'],
  Lumiere:  ['Ombre', 'Insecte'],
  Mystique: ['Poison', 'Foudre'],
  Acier:    ['Roche', 'Glace'],
  Poison:   ['Eau', 'Insecte'],
  Vent:     ['Insecte', 'Lumiere'],
  Insecte:  ['Plante', 'Mystique'],
  Dragon:   ['Dragon', 'Mystique'],
};

export function typeMult(att, def) {
  if (STRONG[att]?.includes(def)) return 1.6;
  if (STRONG[def]?.includes(att)) return 0.7;
  return 1;
}

// ============================================================
//  Moteur TOUR-PAR-TOUR interactif (attaques au choix + statuts).
// ============================================================
import { movesFor } from './moves.js';

function mkFighter(c) {
  const s = c.stats;
  const max = c.maxHp ?? (s.vita * 4 + 30);
  const hp = Math.max(0, Math.min(max, c.hp ?? max));
  return {
    id: c.id, name: c.name, species: c.species, type: c.type, variant: c.variant,
    color: c.color, shape: c.shape, hasArt: c.hasArt, line: c.line, rarity: c.rarity, level: c.level,
    atk: s.force, spd: s.speed, maxHp: max, hp,
    status: null, statusTurns: 0, guard: false,
    moves: movesFor(c.type),
  };
}

// Cree une session de combat (etat complet en memoire).
export function startSession(rawA, rawB) {
  return { A: rawA.map(mkFighter), B: rawB.map(mkFighter), turn: 0, over: false, winner: null };
}

const aliveIdx = (team) => team.findIndex(f => f.hp > 0);
const MAX_TURNS = 60; // plafond de tours du combat interactif (anti non-terminaison)

// IA adverse : choisit une attaque selon la situation.
function aiPick(self, foe) {
  const r = Math.random();
  // Si l'ennemi est bas, tente la grosse attaque.
  if (foe.hp <= foe.maxHp * 0.35 && r < 0.6) return self.moves.find(m => m.id === 'burst') || self.moves[1];
  // Sinon : statut/soin parfois, frappe le plus souvent.
  if (r < 0.18) return self.moves[3];
  if (r < 0.40) return self.moves.find(m => m.id === 'burst') || self.moves[1];
  if (r < 0.85) return self.moves.find(m => m.id === 'strike') || self.moves[1];
  return self.moves[0];
}

function applyMove(attacker, defender, move, events, sideLabel) {
  // Garde : reduit les degats subis au prochain coup de ce tour.
  if (move.kind === 'guard') {
    attacker.guard = true;
    events.push({ t: 'guard', side: sideLabel, name: attacker.name });
    return;
  }
  if (move.kind === 'heal') {
    const amount = Math.round(attacker.maxHp * move.heal);
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + amount);
    events.push({ t: 'heal', side: sideLabel, name: attacker.name, amount, hp: attacker.hp });
    return;
  }
  // Precision
  if (Math.random() > move.acc) {
    events.push({ t: 'miss', side: sideLabel, name: attacker.name, move: move.name });
    return;
  }
  const mult = typeMult(move.type, defender.type);
  const crit = Math.random() < 0.0625 ? 1.5 : 1;
  const variance = 0.85 + Math.random() * 0.3;
  const burnMod = attacker.status === 'burn' ? 0.75 : 1;
  const weakMod = attacker.status === 'weaken' ? 0.6 : 1;
  const guardMod = defender.guard ? 0.5 : 1;
  let dmg = move.power > 0
    ? Math.max(1, Math.round(attacker.atk * move.power * mult * crit * variance * burnMod * weakMod * guardMod))
    : 0;
  if (dmg > 0) defender.hp = Math.max(0, defender.hp - dmg);
  defender.guard = false;
  const ev = { t: 'hit', side: sideLabel, name: attacker.name, move: move.name, dmg, mult, crit: crit > 1, hp: defender.hp, target: defender.name, ko: defender.hp === 0 };
  events.push(ev);
  // Statut inflige (si la cible n'en a pas deja un et survit)
  if (move.kind === 'status' && defender.hp > 0 && !defender.status && Math.random() < move.chance) {
    defender.status = move.status;
    defender.statusTurns = move.status === 'freeze' ? 3 : 4;
    events.push({ t: 'status', side: sideLabel === 'a' ? 'b' : 'a', name: defender.name, status: move.status });
  }
}

// Verifie si un combattant peut agir (gel/paralysie). Renvoie true si bloque.
function isPrevented(f, events, side) {
  if (f.status === 'freeze') {
    if (Math.random() < 0.34) { // degel
      f.status = null; f.statusTurns = 0;
      events.push({ t: 'thaw', side, name: f.name });
      return false;
    }
    events.push({ t: 'frozen', side, name: f.name });
    return true;
  }
  if (f.status === 'para' && Math.random() < 0.25) {
    events.push({ t: 'para', side, name: f.name });
    return true;
  }
  return false;
}

// Degats de fin de tour (brulure / poison).
function tickStatus(f, events, side) {
  if (f.hp <= 0) return;
  if (f.status === 'burn' || f.status === 'poison') {
    const dot = Math.max(1, Math.round(f.maxHp * (f.status === 'poison' ? 0.10 : 0.07)));
    f.hp = Math.max(0, f.hp - dot);
    events.push({ t: 'dot', side, name: f.name, status: f.status, dmg: dot, hp: f.hp, ko: f.hp === 0 });
  }
  // Le gel decremente aussi sa duree (avant : statusTurns inerte pour freeze -> gel infini, seul
  // le RNG de degel 34% le levait = statut le plus oppressant du jeu). Maintenant borne a 3 tours.
  if (f.statusTurns > 0 && --f.statusTurns === 0) {
    events.push({ t: 'cured', side, name: f.name });
    f.status = null;
  }
}

// Joue un tour : le joueur a choisi myMoveId ; l'IA repond. Mute la session.
export function playTurn(state, myMoveId) {
  const events = [];
  if (state.over) return { events, over: true, winner: state.winner };
  state.turn++;
  const ai = state.A[aliveIdx(state.A)]; // joueur = A
  const bi = state.B[aliveIdx(state.B)]; // adversaire = B
  if (!ai || !bi) { state.over = true; return { events, over: true, winner: aliveIdx(state.A) === -1 ? 'b' : 'a' }; }

  const myMove = ai.moves.find(m => m.id === myMoveId) || ai.moves[0];
  const oppMove = aiPick(bi, ai);

  // Ordre selon la vitesse (paralysie reduit la vitesse de moitie).
  const spd = (f) => f.spd * (f.status === 'para' ? 0.5 : 1);
  const first = spd(ai) >= spd(bi)
    ? [{ f: ai, m: myMove, foe: bi, side: 'a' }, { f: bi, m: oppMove, foe: ai, side: 'b' }]
    : [{ f: bi, m: oppMove, foe: ai, side: 'b' }, { f: ai, m: myMove, foe: bi, side: 'a' }];

  for (const act of first) {
    if (act.f.hp <= 0 || act.foe.hp <= 0) continue;
    if (isPrevented(act.f, events, act.side)) continue;
    applyMove(act.f, act.foe, act.m, events, act.side);
  }
  // Degats de statut en fin de tour.
  tickStatus(ai, events, 'a');
  tickStatus(bi, events, 'b');

  // Reset des gardes restantes.
  for (const f of [...state.A, ...state.B]) f.guard = false;

  // Fin de combat ?
  const aAlive = state.A.some(f => f.hp > 0);
  const bAlive = state.B.some(f => f.hp > 0);
  if (!aAlive || !bAlive) {
    state.over = true;
    state.winner = !bAlive ? 'a' : 'b';
  } else if (state.turn >= MAX_TURNS) {
    // Garde-fou anti combat non-terminant (ex. 2 Glumps qui se soignent) : on tranche aux PV restants.
    state.over = true;
    const aHp = state.A.reduce((s, f) => s + f.hp, 0);
    const bHp = state.B.reduce((s, f) => s + f.hp, 0);
    state.winner = aHp >= bHp ? 'a' : 'b';
    events.push({ t: 'timeout', winner: state.winner });
  }
  return { events, over: state.over, winner: state.winner };
}

// Construit un combattant a partir d'une "fiche" (publicCreature + stats).
// Attendu : { name, species, type, variant, color, shape, hasArt, rarity, level, stats:{force,vita,speed} }
export function makeFighter(c) {
  const s = c.stats;
  const max = c.maxHp ?? (s.vita * 4 + 30);
  const hp = Math.max(0, Math.min(max, c.hp ?? max)); // demarre aux PV actuels
  return {
    name: c.name, species: c.species, type: c.type, variant: c.variant,
    color: c.color, shape: c.shape, hasArt: c.hasArt, rarity: c.rarity, level: c.level,
    atk: s.force, spd: s.speed, maxHp: max, hp,
  };
}

// Simule un combat entre deux equipes (tableaux de combattants).
// Renvoie { winner:'a'|'b', log:[...], teamA, teamB }.
export function simulateBattle(rawA, rawB) {
  const A = rawA.map(makeFighter);
  const B = rawB.map(makeFighter);
  const log = [];
  let turn = 0;

  const alive = (team) => team.some(f => f.hp > 0);
  while (alive(A) && alive(B) && turn < 80) {
    turn++;
    // Tous les vivants agissent, du plus rapide au plus lent.
    const order = [
      ...A.map((f, i) => ({ f, side: 'a', i })),
      ...B.map((f, i) => ({ f, side: 'b', i })),
    ].filter(x => x.f.hp > 0).sort((x, y) => y.f.spd - x.f.spd);

    for (const { f, side, i } of order) {
      if (f.hp <= 0) continue;
      const foes = (side === 'a' ? B : A);
      const ti = foes.findIndex(e => e.hp > 0);
      if (ti === -1) break;
      const target = foes[ti];
      const mult = typeMult(f.type, target.type);
      const variance = 0.85 + Math.random() * 0.3;
      const dmg = Math.max(1, Math.round(f.atk * mult * variance));
      target.hp = Math.max(0, target.hp - dmg);
      log.push({ turn, side, ai: i, ti, dmg, mult, hp: target.hp, ko: target.hp === 0 });
    }
  }

  const aHp = A.reduce((s, f) => s + f.hp, 0);
  const bHp = B.reduce((s, f) => s + f.hp, 0);
  const aAlive = A.filter(f => f.hp > 0).length;
  const bAlive = B.filter(f => f.hp > 0).length;
  let winner;
  if (aAlive !== bAlive) winner = aAlive > bAlive ? 'a' : 'b';
  else winner = aHp >= bHp ? 'a' : 'b';

  return { winner, log, teamA: A, teamB: B };
}
