// Calcul de l'etat idle d'un joueur : revenu d'essence + eclosions + maturations.
// Tout est calcule "au moment de la lecture" a partir des timestamps :
// le serveur peut dormir sans perdre la progression.
import { get, all, run } from './db.js';
import {
  BALANCE, SPECIES, effectiveStats, power, creatureValue, rarityOf,
} from './game.js';

const HOUR_MS = 3600 * 1000;

// Met a jour l'essence idle d'un joueur en fonction de ses adultes.
async function tickEssence(user) {
  const now = Date.now();
  let elapsed = now - user.last_tick;
  if (elapsed <= 0) return;

  const cap = BALANCE.offlineCapHours * HOUR_MS;
  if (elapsed > cap) elapsed = cap;

  const adults = await all(
    "SELECT species FROM creatures WHERE owner_id = ? AND stage = 'adult'", [user.id]);

  let ratePerSec = 0;
  for (const c of adults) ratePerSec += rarityOf(c.species) * BALANCE.essencePerRarityPerSec;

  const gained = ratePerSec * (elapsed / 1000);
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
}

function maturationMsFor(speciesId) {
  return BALANCE.maturationBaseSec * rarityOf(speciesId) * 1000;
}

export async function reloadUser(userId) {
  return get('SELECT * FROM users WHERE id = ?', [userId]);
}

// Applique tout le idle puis renvoie l'etat complet pour le client.
export async function getPlayerState(user) {
  await tickCreatures(user.id);
  await tickEssence(user);
  const fresh = await reloadUser(user.id);

  const rows = await all(
    'SELECT * FROM creatures WHERE owner_id = ? ORDER BY created_at ASC', [user.id]);

  const now = Date.now();
  const creatures = rows.map(c => publicCreature(c, now));

  let ratePerSec = 0;
  for (const c of rows) {
    if (c.stage === 'adult') ratePerSec += rarityOf(c.species) * BALANCE.essencePerRarityPerSec;
  }

  return {
    user: {
      id: fresh.id,
      username: fresh.username,
      essence: Math.floor(fresh.essence),
      incubatorSlots: fresh.incubator_slots,
    },
    essencePerSec: Number(ratePerSec.toFixed(3)),
    creatures,
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
    rarity: rarityOf(c.species),
    stage: c.stage,
    variant: c.variant,
    nickname: c.nickname,
    genes: { force: c.gene_force, vita: c.gene_vita, speed: c.gene_speed },
    stats: effectiveStats(c),
    power: power(c),
    value: creatureValue(c),
  };
  if (c.stage === 'egg') out.readyAt = c.hatch_at;
  if (c.stage === 'baby') out.readyAt = c.mature_at;
  if (out.readyAt) out.remainingMs = Math.max(0, out.readyAt - now);
  return out;
}
