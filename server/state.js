// Calcul de l'etat idle d'un joueur : revenu d'essence + eclosions + maturations.
// Tout est calcule "au moment de la lecture" a partir des timestamps :
// le serveur peut dormir sans perdre la progression.
import { get, all, run } from './db.js';
import {
  BALANCE, SPECIES, effectiveStats, power, creatureValue, rarityOf,
  evolutionOf, evolveLevelOf, levelFromXp, xpForLevel, natureByName,
  tierOf, TIER_NAMES, breedingCellCost, maxHpOf, evolveCost,
  incubationSeconds, breedingSeconds, maturationSeconds,
} from './game.js';
import { progressDaily, unlockAch, todayStr } from './progress.js';

// Multiplicateur de gain d'essence selon le niveau (+5% par niveau).
function levelIncomeMul(xp) { return 1 + 0.05 * (levelFromXp(xp) - 1); }
import { hasArt } from './art.js';

const HOUR_MS = 3600 * 1000;

// Met a jour l'essence idle d'un joueur en fonction de ses adultes.
async function tickEssence(user) {
  const now = Date.now();
  let elapsed = now - user.last_tick;
  if (elapsed <= 0) return;

  const cap = BALANCE.offlineCapHours * HOUR_MS;
  if (elapsed > cap) elapsed = cap;

  const adults = await all(
    "SELECT species, xp FROM creatures WHERE owner_id = ? AND stage = 'adult' AND in_prairie = 1", [user.id]);

  // Gain = rarete (stade/evolution) * facteur * bonus de niveau.
  let ratePerSec = 0;
  for (const c of adults) ratePerSec += rarityOf(c.species) * BALANCE.essencePerRarityPerSec * levelIncomeMul(c.xp);

  const gained = ratePerSec * (elapsed / 1000);

  // Les Glumps en prairie gagnent aussi de l'XP (montee de niveau).
  const xpGain = Math.round(BALANCE.xpPerSec * (elapsed / 1000));
  if (xpGain > 0) {
    await run("UPDATE creatures SET xp = xp + ? WHERE owner_id = ? AND in_prairie = 1 AND stage = 'adult'",
      [xpGain, user.id]);
  }

  await run('UPDATE users SET essence = ?, last_tick = ? WHERE id = ?',
    [user.essence + gained, now, user.id]);
}

// Fait avancer les oeufs (eclosion) et les bebes (maturation) dont le temps est passe.
async function tickCreatures(userId) {
  const now = Date.now();
  // Eclosion : chaque oeuf pret devient bebe, avec un mature_at selon l'espece.
  const ready = await all(
    "SELECT * FROM creatures WHERE owner_id = ? AND stage = 'egg' AND hatch_at <= ?",
    [userId, now]);
  for (const egg of ready) {
    const matureMs = now + maturationMsFor(egg.species);
    await run("UPDATE creatures SET stage = 'baby', hatch_at = NULL, mature_at = ? WHERE id = ?",
      [matureMs, egg.id]);
  }
  // Bebes -> adultes.
  await run(
    "UPDATE creatures SET stage = 'adult', mature_at = NULL " +
    "WHERE owner_id = ? AND stage = 'baby' AND mature_at IS NOT NULL AND mature_at <= ?",
    [userId, now]);
  return ready.length; // nb d'oeufs eclos ce tick (pour quetes/succes)
}

function maturationMsFor(speciesId) {
  return BALANCE.maturationBaseSec * rarityOf(speciesId) * 1000;
}

export async function reloadUser(userId) {
  return get('SELECT * FROM users WHERE id = ?', [userId]);
}

// Applique tout le idle puis renvoie l'etat complet pour le client.
export async function getPlayerState(user) {
  const hatched = await tickCreatures(user.id);
  await tickEssence(user);
  let fresh = await reloadUser(user.id);

  // Bonus de connexion quotidien + streak (une fois par jour).
  let loginBonus = 0;
  const today = todayStr();
  if (fresh.last_login_day !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streak = fresh.last_login_day === yesterday ? (fresh.login_streak || 0) + 1 : 1;
    loginBonus = Math.min(500, 50 * streak);
    await run('UPDATE users SET login_streak = ?, last_login_day = ?, essence = essence + ? WHERE id = ?',
      [streak, today, loginBonus, fresh.id]);
    fresh = await reloadUser(user.id);
  }

  const rows = await all(
    'SELECT * FROM creatures WHERE owner_id = ? ORDER BY created_at ASC', [user.id]);

  const now = Date.now();
  const creatures = rows.map(c => publicCreature(c, now));

  // Succes & quetes declenchees par l'etat courant.
  const newAchievements = [];
  const pushAch = (a) => { if (a) newAchievements.push(a); };
  if (hatched > 0) {
    await progressDaily(user.id, 'hatch2', hatched);
    pushAch(await unlockAch(user.id, 'first_hatch'));
  }

  // Decouvertes : on memorise chaque (espece, variant) deja possede (normal ET
  // chromatique separement ; reste debloque meme apres relachement/evolution).
  const ownedPairs = [...new Set(rows.map(r => r.species + ':' + (r.variant || 0)))];
  for (const pair of ownedPairs) {
    const i = pair.lastIndexOf(':');
    await run('INSERT OR IGNORE INTO discoveries (user_id, species, variant) VALUES (?, ?, ?)',
      [user.id, pair.slice(0, i), Number(pair.slice(i + 1))]);
  }
  const discRows = await all('SELECT species, variant FROM discoveries WHERE user_id = ?', [user.id]);
  const discovered = discRows.filter(d => d.variant === 0).map(d => d.species);
  const discoveredShiny = discRows.filter(d => d.variant === 1).map(d => d.species);

  // Succes de collection / niveau / fortune.
  if (discovered.length >= 50) pushAch(await unlockAch(user.id, 'collector50'));
  if (discovered.length >= 150) pushAch(await unlockAch(user.id, 'collector150'));
  if (discoveredShiny.length >= 1) pushAch(await unlockAch(user.id, 'shiny'));
  const maxLevel = rows.filter(r => r.stage !== 'egg').reduce((m, r) => Math.max(m, levelFromXp(r.xp || 0)), 0);
  if (maxLevel >= 50) pushAch(await unlockAch(user.id, 'level50'));
  if (fresh.essence >= 50000) pushAch(await unlockAch(user.id, 'rich'));

  let ratePerSec = 0;
  for (const c of rows) {
    if (c.stage === 'adult' && c.in_prairie === 1) {
      ratePerSec += rarityOf(c.species) * BALANCE.essencePerRarityPerSec * levelIncomeMul(c.xp);
    }
  }
  const inPrairieCount = rows.filter(c => c.in_prairie === 1).length;
  const breedingUsed = rows.filter(c => c.stage === 'egg' && c.from_breeding === 1).length;

  return {
    user: {
      id: fresh.id,
      username: fresh.username,
      essence: Math.floor(fresh.essence),
      incubatorSlots: fresh.incubator_slots,
      prairieSlots: fresh.prairie_slots,
      prairieUsed: inPrairieCount,
      breedingCells: fresh.breeding_cells,
      breedingUsed,
      nextCellCost: fresh.breeding_cells < BALANCE.breedingMaxCells ? breedingCellCost(fresh.breeding_cells) : null,
      pvpTrophies: fresh.pvp_trophies ?? 1000,
      loginStreak: fresh.login_streak || 0,
    },
    essencePerSec: Number(ratePerSec.toFixed(3)),
    creatures,
    discovered,
    discoveredShiny,
    loginBonus,
    newAchievements,
    serverTime: now,
  };
}

// Projection "publique" d'une creature (ce qu'on envoie au client).
export function publicCreature(c, now = Date.now()) {
  const sp = SPECIES[c.species];
  const out = {
    id: c.id,
    species: c.species,
    speciesName: sp?.name ?? c.species,
    type: sp?.type ?? '?',
    color: sp?.color ?? '#888',
    shape: sp?.shape ?? 'blob',
    hasArt: hasArt(c.species),
    rarity: tierOf(c.species),          // rarete d'ACQUISITION (affichage etoiles/couleur)
    tierName: TIER_NAMES[tierOf(c.species)],
    powerRarity: rarityOf(c.species),   // rarete de puissance (stade/evolution)
    line: sp?.line ?? c.species, // lignee (pour une teinte chromatique coherente entre evolutions)
    fromBreeding: c.from_breeding === 1,
    favorite: c.favorite === 1,
    parentA: c.parent_a ?? null,
    parentB: c.parent_b ?? null,
    stage: c.stage,
    variant: c.variant,
    nickname: c.nickname,
    inPrairie: c.in_prairie === 1,
    nature: c.nature || 'Equilibre',
    natureUp: natureByName(c.nature).up,
    natureDown: natureByName(c.nature).down,
    level: levelFromXp(c.xp || 0),
    xp: c.xp || 0,
    xpInto: (c.xp || 0) - xpForLevel(levelFromXp(c.xp || 0)),
    xpNext: Math.max(1, xpForLevel(levelFromXp(c.xp || 0) + 1) - xpForLevel(levelFromXp(c.xp || 0))),
    genes: { force: c.gene_force, vita: c.gene_vita, speed: c.gene_speed },
    stats: effectiveStats(c),
    power: power(c),
    value: creatureValue(c),
  };
  // PV : hp NULL = pleine vie. fainted = KO (hp <= 0).
  const maxHp = maxHpOf(c);
  out.maxHp = maxHp;
  out.hp = c.hp == null ? maxHp : Math.max(0, Math.min(maxHp, c.hp));
  out.fainted = c.hp != null && c.hp <= 0;
  if (c.stage === 'egg') {
    out.readyAt = c.hatch_at;
    out.totalMs = (c.from_breeding === 1 ? breedingSeconds(c.species) : incubationSeconds(c.species)) * 1000;
  }
  if (c.stage === 'baby') {
    out.readyAt = c.mature_at;
    out.totalMs = maturationSeconds(c.species) * 1000;
  }
  if (out.readyAt) out.remainingMs = Math.max(0, out.readyAt - now);

  // Evolution disponible ?
  const evo = evolutionOf(c.species);
  if (evo) {
    out.evolvesTo = evo;
    out.evolvesToName = SPECIES[evo].name;
    out.evolveLevel = evolveLevelOf(c.species);
    out.evolveCost = evolveCost(evo);
    out.canEvolve = out.level >= out.evolveLevel;
  }
  return out;
}
