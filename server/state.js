// Calcul de l'etat idle d'un joueur : revenu d'essence + eclosions + maturations.
// Tout est calcule "au moment de la lecture" a partir des timestamps :
// le serveur peut dormir sans perdre la progression.
import { get, all, run } from './db.js';
import {
  BALANCE, SPECIES, effectiveStats, power, creatureValue, rarityOf,
  evolutionOf, evolveLevelOf, levelFromXp, xpForLevel, natureByName,
  tierOf, TIER_NAMES, breedingCellCost, maxHpOf, evolveCost,
  incubationSeconds, breedingSeconds, maturationSeconds,
  BIOMES, BIOME_LIST, RESOURCES, SYNERGY_BONUS, isSynergy,
} from './game.js';
import { progressDaily, unlockAch, todayStr } from './progress.js';

// Multiplicateur de gain d'essence selon le niveau (+5% par niveau).
function levelIncomeMul(xp) { return 1 + 0.05 * (levelFromXp(xp) - 1); }
import { hasArt } from './art.js';

const HOUR_MS = 3600 * 1000;

// Lit les ressources de biome stockees (JSON) avec 0 par defaut.
export function parseResources(user) {
  let r; try { r = JSON.parse(user.resources_json || '{}'); } catch { r = {}; }
  const out = {};
  for (const res of RESOURCES) if (res !== 'essence') out[res] = Number(r[res] || 0);
  return out;
}
// Lit les biomes possedes (la Plaine est toujours debloquee).
export function parseBiomes(user) {
  let b; try { b = JSON.parse(user.biomes_json || '[]'); } catch { b = []; }
  const set = new Set(b); set.add('plaine');
  return [...set].filter(id => BIOMES[id]);
}
// Production par seconde d'un Glump dans un biome (rarete * facteur * niveau * synergie).
function farmRate(species, xp, biomeId) {
  const sp = SPECIES[species];
  const syn = sp && isSynergy(biomeId, sp.type) ? (1 + SYNERGY_BONUS) : 1;
  return rarityOf(species) * BALANCE.essencePerRarityPerSec * levelIncomeMul(xp) * syn;
}

// Met a jour les ressources idle : chaque Glump assigne a un biome produit
// la ressource de ce biome (essence pour la Plaine), avec bonus de synergie.
async function tickFarming(user) {
  const now = Date.now();
  let elapsed = now - user.last_tick;
  if (elapsed <= 0) return;
  const cap = BALANCE.offlineCapHours * HOUR_MS;
  if (elapsed > cap) elapsed = cap;
  const secs = elapsed / 1000;

  // Un seul biome actif : tous les farmeurs produisent SA ressource.
  const active = user.active_biome || 'plaine';
  await run("UPDATE creatures SET biome = ? WHERE owner_id = ? AND biome IS NOT NULL AND biome != ?", [active, user.id, active]);

  const farmers = await all(
    "SELECT species, xp, biome FROM creatures WHERE owner_id = ? AND stage = 'adult' AND biome IS NOT NULL", [user.id]);

  const res = parseResources(user);
  let essenceGain = 0;
  for (const c of farmers) {
    const b = BIOMES[c.biome]; if (!b) continue;
    const amt = farmRate(c.species, c.xp, c.biome) * secs;
    if (b.resource === 'essence') essenceGain += amt;
    else res[b.resource] = (res[b.resource] || 0) + amt;
  }

  // Les Glumps qui farment gagnent aussi de l'XP.
  const xpGain = Math.round(BALANCE.xpPerSec * secs);
  if (xpGain > 0) {
    await run("UPDATE creatures SET xp = xp + ? WHERE owner_id = ? AND biome IS NOT NULL AND stage = 'adult'",
      [xpGain, user.id]);
  }

  await run('UPDATE users SET essence = ?, resources_json = ?, last_tick = ? WHERE id = ?',
    [user.essence + essenceGain, JSON.stringify(res), now, user.id]);
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
  await tickFarming(user);
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
  const activeBiome = fresh.active_biome || 'plaine';
  const creatures = rows.map(c => publicCreature(c, now, activeBiome));

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

  // --- Biomes : production par ressource + occupation par biome ---
  const ownedBiomes = parseBiomes(fresh);
  const resources = parseResources(fresh);
  const ratePerRes = {}; for (const r of RESOURCES) ratePerRes[r] = 0;
  const biomeUsed = {}; for (const id of Object.keys(BIOMES)) biomeUsed[id] = 0;
  for (const c of rows) {
    if (c.stage === 'adult' && c.biome && BIOMES[c.biome]) {
      biomeUsed[c.biome] = (biomeUsed[c.biome] || 0) + 1;
      ratePerRes[BIOMES[c.biome].resource] += farmRate(c.species, c.xp, c.biome);
    }
  }
  const farmingCount = rows.filter(c => c.biome && BIOMES[c.biome]).length;
  const breedingUsed = rows.filter(c => c.stage === 'egg' && c.from_breeding === 1).length;
  const biomes = BIOME_LIST.map(b => ({
    id: b.id, name: b.name, emoji: b.emoji, types: b.types,
    resource: b.resource, resName: b.resName, resEmoji: b.resEmoji,
    owned: ownedBiomes.includes(b.id), cost: b.cost,
    active: b.id === activeBiome,
    used: biomeUsed[b.id] || 0, slots: fresh.prairie_slots,
    ratePerSec: Number(ratePerRes[b.resource].toFixed(3)),
  }));

  return {
    user: {
      id: fresh.id,
      username: fresh.username,
      essence: Math.floor(fresh.essence),
      resources, // { magma, ecume, spores, sable, orage, eclat }
      activeBiome,
      incubatorSlots: fresh.incubator_slots,
      prairieSlots: fresh.prairie_slots,
      prairieUsed: farmingCount,
      breedingCells: fresh.breeding_cells,
      breedingUsed,
      nextCellCost: fresh.breeding_cells < BALANCE.breedingMaxCells ? breedingCellCost(fresh.breeding_cells) : null,
      pvpTrophies: fresh.pvp_trophies ?? 1000,
      loginStreak: fresh.login_streak || 0,
    },
    essencePerSec: Number(ratePerRes.essence.toFixed(3)),
    resourcePerSec: Object.fromEntries(RESOURCES.filter(r => r !== 'essence').map(r => [r, Number(ratePerRes[r].toFixed(3))])),
    biomes,
    creatures,
    discovered,
    discoveredShiny,
    loginBonus,
    newAchievements,
    serverTime: now,
  };
}

// Projection "publique" d'une creature (ce qu'on envoie au client).
export function publicCreature(c, now = Date.now(), activeBiome = null) {
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
    biome: c.biome || null,
    inPrairie: !!c.biome, // compat
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

  // Production de farm PAR MINUTE dans le biome ACTIF (le seul ou l'on farme).
  const baseSec = rarityOf(c.species) * BALANCE.essencePerRarityPerSec * levelIncomeMul(c.xp || 0);
  const targetBiome = activeBiome || c.biome || 'plaine';
  const b = BIOMES[targetBiome] || BIOMES.plaine;
  const syn = !!isSynergy(b.id, sp?.type);
  out.farming = !!c.biome; // farme actuellement ?
  out.farmPerMin = Math.round(baseSec * (syn ? 1 + SYNERGY_BONUS : 1) * 60 * 100) / 100;
  out.farmResource = b.resource;
  out.farmResEmoji = b.resEmoji;
  out.farmBiomeName = b.name;
  out.farmSynergy = syn;

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
