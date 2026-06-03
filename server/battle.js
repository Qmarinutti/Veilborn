// =====================================================================
//  Moteur de combat PvP : table d'efficacite des types + simulation auto.
// =====================================================================

// Chaque type est "fort" (x1.6) contre ceux listes. L'inverse donne une
// resistance (x0.7). Sinon x1.
export const STRONG = {
  Feu:      ['Plante', 'Glace', 'Insecte', 'Acier'],
  Eau:      ['Feu', 'Roche'],
  Plante:   ['Eau', 'Roche'],
  Foudre:   ['Eau', 'Vent'],
  Roche:    ['Feu', 'Glace', 'Insecte', 'Vent'],
  Glace:    ['Plante', 'Vent', 'Dragon'],
  Ombre:    ['Mystique', 'Lumiere'],
  Lumiere:  ['Ombre', 'Mystique'],
  Mystique: ['Poison', 'Insecte'],
  Acier:    ['Roche', 'Glace', 'Insecte'],
  Poison:   ['Plante', 'Eau'],
  Vent:     ['Plante', 'Insecte'],
  Insecte:  ['Plante', 'Mystique', 'Ombre'],
  Dragon:   ['Dragon'],
};

export function typeMult(att, def) {
  if (STRONG[att]?.includes(def)) return 1.6;
  if (STRONG[def]?.includes(att)) return 0.7;
  return 1;
}

// Construit un combattant a partir d'une "fiche" (publicCreature + stats).
// Attendu : { name, species, type, variant, color, shape, hasArt, rarity, level, stats:{force,vita,speed} }
export function makeFighter(c) {
  const s = c.stats;
  const hp = s.vita * 4 + 30;
  return {
    name: c.name, species: c.species, type: c.type, variant: c.variant,
    color: c.color, shape: c.shape, hasArt: c.hasArt, rarity: c.rarity, level: c.level,
    atk: s.force, spd: s.speed, maxHp: hp, hp,
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
