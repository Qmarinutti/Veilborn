// Calcul de l'etat idle d'un joueur : revenu d'essence + eclosions + maturations.
// Tout est calcule "au moment de la lecture" a partir des timestamps :
// le serveur peut dormir sans perdre la progression.
import { get, all, run } from './db.js';
import {
  BALANCE, SPECIES, effectiveStats, power, creatureValue, rarityOf,
  evolutionOf, evolveLevelOf, levelFromXp, xpForLevel, natureByName,
  tierOf, TIER_NAMES, breedingCellCost, maxHpOf, evolveCost,
  incubationSeconds, breedingSeconds, maturationSeconds,
  reproductionSeconds, breedHatchSeconds,
  BIOMES, BIOME_LIST, RESOURCES, SYNERGY_BONUS, isSynergy,
  EXPLORE_ZONES, EXPLORE_TIERS,
} from './game.js';
import { progressDaily, todayStr, ACHIEVEMENTS, parseAchSet } from './progress.js';
const ACH_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

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
// Expeditions d'exploration en cours (tableau) et sac d'objets.
export function parseExpeditions(user) {
  try { const e = JSON.parse(user.expeditions_json || '[]'); return Array.isArray(e) ? e : []; } catch { return []; }
}
export function parseItems(user) {
  let it; try { it = JSON.parse(user.items_json || '{}'); } catch { it = {}; }
  return { candy: Number(it.candy || 0), potion: Number(it.potion || 0), revive: Number(it.revive || 0) };
}
// Ids des Glumps actuellement en exploration (occupes).
export function exploringIds(user) {
  const set = new Set();
  for (const ex of parseExpeditions(user)) for (const id of (ex.team || [])) set.add(id);
  return set;
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

// Fait avancer la repro (accouplement -> oeuf), les eclosions, et les maturations.
async function tickCreatures(userId) {
  const now = Date.now();
  // Phase 1 -> 2 : accouplement termine -> l'oeuf est pondu et commence son eclosion.
  const mated = await all(
    "SELECT * FROM creatures WHERE owner_id = ? AND stage = 'mating' AND hatch_at <= ?", [userId, now]);
  for (const egg of mated) {
    await run("UPDATE creatures SET stage = 'egg', hatch_at = ? WHERE id = ?",
      [now + breedHatchSeconds(egg.species) * 1000, egg.id]);
  }
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

  // Decouvertes : on lit d'abord ce qui est deja connu, et on n'ECRIT que les
  // NOUVELLES paires (en regime stable -> 0 ecriture, au lieu d'1 par espece a chaque fois).
  const discRows = await all('SELECT species, variant FROM discoveries WHERE user_id = ?', [user.id]);
  const discSet = new Set(discRows.map(d => d.species + ':' + d.variant));
  const ownedPairs = [...new Set(rows.map(r => r.species + ':' + (r.variant || 0)))];
  const newPairs = ownedPairs.filter(p => !discSet.has(p));
  for (const pair of newPairs) {
    const i = pair.lastIndexOf(':');
    await run('INSERT OR IGNORE INTO discoveries (user_id, species, variant) VALUES (?, ?, ?)',
      [user.id, pair.slice(0, i), Number(pair.slice(i + 1))]);
    discSet.add(pair);
  }
  const discovered = [...discSet].filter(p => p.endsWith(':0')).map(p => p.slice(0, -2));
  const discoveredShiny = [...discSet].filter(p => p.endsWith(':1')).map(p => p.slice(0, -2));

  // Succes : on lit l'ensemble UNE fois (depuis fresh) et on ecrit UNE fois si du nouveau.
  const achSet = parseAchSet(fresh);
  const achBefore = achSet.size;
  const newAchievements = [];
  const tryAch = (id, cond) => { if (cond && !achSet.has(id)) { achSet.add(id); if (ACH_BY_ID[id]) newAchievements.push(ACH_BY_ID[id]); } };
  const maxLevel = rows.filter(r => r.stage !== 'egg').reduce((m, r) => Math.max(m, levelFromXp(r.xp || 0)), 0);
  tryAch('first_hatch', hatched > 0);
  tryAch('collector50', discovered.length >= 50);
  tryAch('collector150', discovered.length >= 150);
  tryAch('shiny', discoveredShiny.length >= 1);
  tryAch('level50', maxLevel >= 50);
  tryAch('rich', fresh.essence >= 50000);
  if (achSet.size !== achBefore) await run('UPDATE users SET ach_json = ? WHERE id = ?', [JSON.stringify([...achSet]), user.id]);
  if (hatched > 0) await progressDaily(user.id, 'hatch2', hatched);

  // --- Exploration : marque les Glumps en explo, etat des zones, sac ---
  const exploring = exploringIds(fresh);
  for (const pc of creatures) pc.exploring = exploring.has(pc.id);
  const items = parseItems(fresh);
  const expeditions = parseExpeditions(fresh).map(ex => ({
    ...ex, remainingMs: Math.max(0, (ex.readyAt || 0) - now), ready: (ex.readyAt || 0) <= now,
  }));
  // Pour chaque zone, statut de chaque difficulte (debloquee selon les monstres possedes).
  const adultsByType = {};
  for (const c of rows) if (c.stage === 'adult') {
    const t = SPECIES[c.species]?.type, lvl = levelFromXp(c.xp || 0);
    (adultsByType[t] = adultsByType[t] || []).push({ id: c.id, lvl, busy: exploring.has(c.id) || c.stage === 'mating' });
  }
  const activeZones = new Set(expeditions.map(e => e.biome));
  const exploreZones = EXPLORE_ZONES.map(z => ({
    ...z,
    active: activeZones.has(z.id),
    tiers: EXPLORE_TIERS.map(t => {
      const pool = (adultsByType[z.type] || []);
      const owned = pool.filter(c => c.lvl >= t.level).length;        // assez de monstres pour debloquer ?
      const available = pool.filter(c => c.lvl >= t.level && !c.busy).length; // dispos a envoyer
      return { id: t.id, name: t.name, count: t.count, level: t.level, durationSec: t.durationSec,
        unlocked: owned >= t.count, canStart: available >= t.count, owned, need: t.count };
    }),
  }));

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
  const breedingUsed = rows.filter(c => c.from_breeding === 1 && (c.stage === 'egg' || c.stage === 'mating')).length;
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
      items, // sac : { candy, potion, revive }
    },
    essencePerSec: Number(ratePerRes.essence.toFixed(3)),
    resourcePerSec: Object.fromEntries(RESOURCES.filter(r => r !== 'essence').map(r => [r, Number(ratePerRes[r].toFixed(3))])),
    biomes,
    exploreZones,
    expeditions,
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
  if (c.stage === 'mating') { // phase 1 : accouplement en cours
    out.readyAt = c.hatch_at;
    out.totalMs = reproductionSeconds(c.species) * 1000;
    out.mating = true;
  }
  if (c.stage === 'egg') {
    out.readyAt = c.hatch_at;
    out.totalMs = (c.from_breeding === 1 ? breedHatchSeconds(c.species) : incubationSeconds(c.species)) * 1000;
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
