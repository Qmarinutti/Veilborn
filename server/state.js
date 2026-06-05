// Calcul de l'etat idle d'un joueur : revenu d'essence + eclosions + maturations.
// Tout est calcule "au moment de la lecture" a partir des timestamps :
// le serveur peut dormir sans perdre la progression.
import { get, all, run, batch } from './db.js';
import { withLock } from './lock.js';
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

function maturationMsFor(speciesId) {
  return BALANCE.maturationBaseSec * rarityOf(speciesId) * 1000;
}

export async function reloadUser(userId) {
  return get('SELECT * FROM users WHERE id = ?', [userId]);
}

// Applique tout le idle puis renvoie l'etat complet pour le client.
// OPTIMISE : 1 batch de LECTURE (creatures + decouvertes) + 1 batch d'ECRITURE,
// au lieu de ~10 allers-retours Turso. Tout le idle est calcule EN MEMOIRE.
export async function getPlayerState(user) {
  const now = Date.now();
  const W = []; // requetes d'ecriture, executees en UN SEUL aller-retour a la fin

  // --- Lecture unique (1 aller-retour) : creatures + decouvertes ---
  const [cRes, dRes] = await batch([
    { sql: 'SELECT * FROM creatures WHERE owner_id = ? ORDER BY created_at ASC', args: [user.id] },
    { sql: 'SELECT species, variant FROM discoveries WHERE user_id = ?', args: [user.id] },
  ], 'read');
  const rows = cRes.rows;
  const discRows = dRes.rows;

  // --- Tick creatures : transitions de stade (memoire + writes batchees) ---
  // Comme avant, UNE transition par tick par creature (les timers redemarrent a `now`).
  let hatched = 0;
  for (const c of rows) { // accouplement termine -> l'oeuf commence son eclosion
    if (c.stage === 'mating' && c.hatch_at != null && c.hatch_at <= now) {
      c.stage = 'egg'; c.hatch_at = now + breedHatchSeconds(c.species) * 1000;
      W.push({ sql: "UPDATE creatures SET stage='egg', hatch_at=? WHERE id=?", args: [c.hatch_at, c.id] });
    }
  }
  for (const c of rows) { // eclosion : oeuf -> bebe
    if (c.stage === 'egg' && c.hatch_at != null && c.hatch_at <= now) {
      c.stage = 'baby'; c.mature_at = now + maturationMsFor(c.species); c.hatch_at = null;
      W.push({ sql: "UPDATE creatures SET stage='baby', hatch_at=NULL, mature_at=? WHERE id=?", args: [c.mature_at, c.id] });
      hatched++;
    }
  }
  for (const c of rows) { // bebe -> adulte
    if (c.stage === 'baby' && c.mature_at != null && c.mature_at <= now) {
      c.stage = 'adult'; c.mature_at = null;
      W.push({ sql: "UPDATE creatures SET stage='adult', mature_at=NULL WHERE id=?", args: [c.id] });
    }
  }

  // --- Bonus de connexion quotidien (1x/jour) en memoire ---
  let essence = user.essence;
  let loginBonus = 0;
  let loginStreak = user.login_streak || 0;
  const today = todayStr();
  if (user.last_login_day !== today) {
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
    loginStreak = user.last_login_day === yesterday ? (user.login_streak || 0) + 1 : 1;
    loginBonus = Math.min(1000, 50 * loginStreak); // plafond releve (avant 500 = plateau des le jour 10)
    essence += loginBonus; // affichage seulement
    // Credit ATOMIQUE conditionnel : seul le 1er /state du jour credite le bonus
    // (deux /state concurrents passeraient tous deux le test en memoire -> double bonus).
    W.push({ sql: 'UPDATE users SET login_streak=?, last_login_day=?, essence=essence+? WHERE id=? AND (last_login_day IS NULL OR last_login_day <> ?)', args: [loginStreak, today, loginBonus, user.id, today] });
  }

  // --- Tick farming : 1 biome actif, gains de ressource + XP (en memoire) ---
  const activeBiome = user.active_biome || 'plaine';
  const res = parseResources(user);
  const resGain = {}; // gains de ressources NON-essence ce tick (a appliquer en relatif)
  let essenceGain = 0;
  let elapsed = now - user.last_tick;
  let didFarm = false;
  if (elapsed > 0) {
    didFarm = true;
    const capMs = BALANCE.offlineCapHours * HOUR_MS;
    if (elapsed > capMs) elapsed = capMs;
    const secs = elapsed / 1000;
    const xpGain = Math.round(BALANCE.xpPerSec * secs);
    // Migration vers le biome actif (tous les farmeurs produisent SA ressource).
    for (const c of rows) if (c.biome != null && c.biome !== activeBiome) c.biome = activeBiome;
    for (const c of rows) {
      if (c.stage !== 'adult' || c.biome == null) continue;
      const b = BIOMES[c.biome]; if (!b) continue;
      const amt = farmRate(c.species, c.xp, c.biome) * secs;
      if (b.resource === 'essence') essenceGain += amt;
      else { res[b.resource] = (res[b.resource] || 0) + amt; resGain[b.resource] = (resGain[b.resource] || 0) + amt; }
      if (xpGain > 0) c.xp = (c.xp || 0) + xpGain; // l'XP en memoire (pour l'affichage)
    }
    essence += essenceGain;
    W.push({ sql: "UPDATE creatures SET biome=? WHERE owner_id=? AND biome IS NOT NULL AND biome != ?", args: [activeBiome, user.id, activeBiome] });
    if (xpGain > 0) W.push({ sql: "UPDATE creatures SET xp=xp+? WHERE owner_id=? AND biome IS NOT NULL AND stage='adult'", args: [xpGain, user.id] });
  }
  // ESSENCE : ecriture RELATIVE (farming). CRITIQUE : une ecriture absolue
  // "essence = base + gain" effacerait une depense atomique concurrente (bonbon/oeuf) -> achats gratuits.
  // (le bonus de connexion est credite separement, par l'UPDATE conditionnel ci-dessus.)
  const essenceAdd = essenceGain;
  if (didFarm) {
    W.push({ sql: 'UPDATE users SET essence = essence + ?, last_tick = ? WHERE id = ?', args: [essenceAdd, now, user.id] });
  } else if (essenceAdd !== 0) {
    W.push({ sql: 'UPDATE users SET essence = essence + ? WHERE id = ?', args: [essenceAdd, user.id] });
  }
  // Garde `user` a jour en memoire pour le reste du calcul (affichage).
  user.essence = essence; user.login_streak = loginStreak; user.resources_json = JSON.stringify(res);

  const fresh = user; // plus de reloadUser : on travaille sur l'objet deja a jour
  const creatures = rows.map(c => publicCreature(c, now, activeBiome));

  // Decouvertes : on n'ECRIT que les NOUVELLES paires (regime stable -> 0 ecriture).
  const discSet = new Set(discRows.map(d => d.species + ':' + d.variant));
  const ownedPairs = [...new Set(rows.map(r => r.species + ':' + (r.variant || 0)))];
  for (const pair of ownedPairs.filter(p => !discSet.has(p))) {
    const i = pair.lastIndexOf(':');
    W.push({ sql: 'INSERT OR IGNORE INTO discoveries (user_id, species, variant) VALUES (?, ?, ?)', args: [user.id, pair.slice(0, i), Number(pair.slice(i + 1))] });
    discSet.add(pair);
  }
  const discovered = [...discSet].filter(p => p.endsWith(':0')).map(p => p.slice(0, -2));
  const discoveredShiny = [...discSet].filter(p => p.endsWith(':1')).map(p => p.slice(0, -2));

  // Succes : lus une fois (depuis fresh), ecrits une fois si du nouveau.
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
  if (achSet.size !== achBefore) W.push({ sql: 'UPDATE users SET ach_json = ? WHERE id = ?', args: [JSON.stringify([...achSet]), user.id] });

  // --- Ecriture groupee : TOUT le idle en UN SEUL aller-retour ---
  if (W.length) await batch(W, 'write');
  // RESSOURCES (magma, ecume...) : JSON -> pas d'increment SQL possible. On ecrit sous VERROU
  // avec relecture fraiche pour composer avec un achat d'oeuf typé (lui aussi verrouille) sans l'effacer.
  // Seulement si on farme une ressource non-essence (biome special) -> le cas Plaine reste a 2 allers-retours.
  if (didFarm && Object.keys(resGain).length) {
    await withLock(user.id, async () => {
      const u = await reloadUser(user.id);
      const r2 = parseResources(u);
      for (const k in resGain) r2[k] = (r2[k] || 0) + resGain[k];
      await run('UPDATE users SET resources_json = ? WHERE id = ?', [JSON.stringify(r2), user.id]);
    });
  }
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
      // Pool = adultes de TOUS les types acceptes par la zone (ex. Plante + Insecte pour la Foret).
      const pool = z.types.flatMap(ty => adultsByType[ty] || []);
      const owned = pool.filter(c => c.lvl >= t.level).length;        // assez de monstres pour debloquer ?
      const available = pool.filter(c => c.lvl >= t.level && !c.busy).length; // dispos a envoyer
      return { id: t.id, name: t.name, count: t.count, level: t.level, durationSec: t.durationSec,
        unlocked: owned >= t.count, canStart: available >= t.count, owned, need: t.count,
        reward: { res: t.res, items: t.items, eggs: t.eggs } };
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
  const breedingUsed = rows.filter(c => c.from_breeding === 1 && c.stage === 'mating').length; // cellule = accouplement uniquement
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
