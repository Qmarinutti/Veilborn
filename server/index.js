// Serveur principal : API REST + service des fichiers statiques.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { get, all, run, insert, initDb, usingTurso, dbUrl, hasToken } from './db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  userFromRequest, requireAuth, tokenFromRequest,
} from './auth.js';
import {
  BALANCE, STARTER_IDS, SPECIES, SPECIES_COUNT, wildCreature, breed,
  incubationSeconds, nextSlotCost, creatureValue, evolutionOf, evolveLevelOf,
  levelFromXp, prairieSlotCost, ELEMENTS, SHOP_EGG_PRICE, randomBaseOfType, accelerateCost,
  breedingSeconds, reproductionSeconds, breedHatchSeconds, breedingCellCost, evolveCost, shinyPityBonus, tierOf,
  BIOMES, BIOME_LIST, BIOME_OF_TYPE, biomeBuyCost, TYPE_EGG_COST, randomBase, RESOURCES,
  EXPLORE_ZONE_BY_ID, EXPLORE_TIER_BY_ID, EXPLORE_ITEMS,
} from './game.js';
import { getPlayerState, publicCreature, reloadUser, parseResources, parseBiomes, parseExpeditions, parseItems, exploringIds } from './state.js';
import { hasArt } from './art.js';
import { simulateBattle, startSession, playTurn } from './battle.js';
import { moveButtons } from './moves.js';
import {
  ACHIEVEMENTS, DEX_MILESTONES, DAILY_POOL, parseAchSet, unlockAch,
  getDaily, progressDaily, dailyView, todayStr,
} from './progress.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Enrobe un handler async pour router les erreurs vers express.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Helpers ----------
async function insertCreature(ownerId, c, extra = {}) {
  const now = Date.now();
  return insert(`
    INSERT INTO creatures
      (owner_id, species, stage, gene_force, gene_vita, gene_speed, variant, nature, nickname, in_prairie, from_breeding, parent_a, parent_b, hatch_at, mature_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ownerId, c.species, c.stage ?? 'adult',
     c.gene_force, c.gene_vita, c.gene_speed, c.variant ?? 0, c.nature ?? 'Equilibre',
     extra.nickname ?? null, extra.in_prairie ?? 0, extra.from_breeding ?? 0,
     extra.parent_a ?? null, extra.parent_b ?? null,
     extra.hatch_at ?? null, extra.mature_at ?? null, now]);
}

function setCookie(res, token) {
  res.setHeader('Set-Cookie',
    `sid=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
}

// Code ami (8 caracteres, alphabet sans I/O/0/1 pour eviter les confusions).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genFriendCode() {
  const b = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return s;
}
async function ensureFriendCode(user) {
  if (user.friend_code) return user.friend_code;
  const code = genFriendCode();
  await run('UPDATE users SET friend_code = ? WHERE id = ?', [code, user.id]);
  return code;
}

// Verrou par utilisateur : serialise les operations sensibles (reclamations de
// recompenses) pour eviter les doubles-credits via requetes simultanees.
const userLocks = new Map();
async function withLock(userId, fn) {
  while (userLocks.get(userId)) { try { await userLocks.get(userId); } catch {} }
  let release;
  const p = new Promise(r => (release = r));
  userLocks.set(userId, p);
  try { return await fn(); }
  finally { userLocks.delete(userId); release(); }
}

// Depense atomique d'essence : echoue (renvoie false) si solde insuffisant.
// Empeche l'essence negative meme avec des requetes simultanees (anti race-condition).
async function spend(userId, amount) {
  const r = await run(
    'UPDATE users SET essence = essence - ? WHERE id = ? AND essence >= ?',
    [amount, userId, amount]);
  return (r.rowsAffected ?? r.changes ?? 0) > 0;
}

// ---------- Auth ----------
app.post('/api/register', h(async (req, res) => {
  const { username, password, starter } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Pseudo (>=3) et mot de passe (>=4) requis.' });
  }
  if (!STARTER_IDS.includes(starter)) {
    return res.status(400).json({ error: 'Choisis ton Glump de depart.' });
  }
  const exists = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) return res.status(409).json({ error: 'Ce pseudo est deja pris.' });

  const { hash, salt } = hashPassword(password);
  const now = Date.now();
  const userId = await insert(
    'INSERT INTO users (username, pass_hash, pass_salt, essence, incubator_slots, friend_code, last_tick, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [username, hash, salt, BALANCE.startEssence, BALANCE.startSlots, genFriendCode(), now, now]);

  // Le joueur commence avec le starter choisi (adulte), place dans la Plaine pour farmer.
  await insertCreature(userId, wildCreature(starter, { adult: true }));
  await run("UPDATE creatures SET in_prairie = 1, biome = 'plaine' WHERE owner_id = ?", [userId]);

  const token = await createSession(userId);
  setCookie(res, token);
  res.json({ ok: true });
}));

app.post('/api/login', h(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await get('SELECT * FROM users WHERE username = ?', [username || '']);
  if (!user || !verifyPassword(password || '', user.pass_salt, user.pass_hash)) {
    return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });
  }
  const token = await createSession(user.id);
  setCookie(res, token);
  res.json({ ok: true });
}));

app.post('/api/logout', h(async (req, res) => {
  await destroySession(tokenFromRequest(req));
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
}));

app.get('/api/me', h(async (req, res) => {
  const user = await userFromRequest(req);
  res.json({ loggedIn: !!user, username: user?.username ?? null });
}));

// ---------- Etat du jeu ----------
app.get('/api/state', requireAuth, h(async (req, res) => {
  res.json(await getPlayerState(req.user));
}));

// ---------- Reproduction ----------
app.post('/api/breed', requireAuth, h(async (req, res) => {
  const { parentA, parentB } = req.body || {};
  if (!parentA || !parentB || parentA === parentB) {
    return res.status(400).json({ error: 'Choisis deux parents differents.' });
  }
  const a = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [parentA, req.user.id]);
  const b = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [parentB, req.user.id]);
  if (!a || !b) return res.status(404).json({ error: 'Parent introuvable.' });
  if (a.stage !== 'adult' || b.stage !== 'adult') {
    return res.status(400).json({ error: 'Seuls les adultes peuvent se reproduire.' });
  }
  // Un parent deja en accouplement est occupe.
  const busy = await get(
    "SELECT 1 AS x FROM creatures WHERE owner_id = ? AND from_breeding = 1 AND stage = 'mating' AND (parent_a IN (?, ?) OR parent_b IN (?, ?)) LIMIT 1",
    [req.user.id, a.id, b.id, a.id, b.id]);
  if (busy) return res.status(400).json({ error: 'Un de ces Glumps est deja en accouplement.' });
  const exploringB = exploringIds(await reloadUser(req.user.id));
  if (exploringB.has(Number(a.id)) || exploringB.has(Number(b.id))) return res.status(400).json({ error: 'Un de ces Glumps est en exploration (occupe).' });

  // Cellule libre ? (accouplement OU oeuf en cours occupent une cellule)
  const cellRow = await get(
    "SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND from_breeding = 1 AND stage IN ('mating', 'egg')", [req.user.id]);
  if (cellRow.n >= req.user.breeding_cells) {
    return res.status(400).json({ error: 'Toutes tes cellules de reproduction sont occupees.' });
  }

  const user = await reloadUser(req.user.id);
  const child = breed(a, b, { pityBonus: shinyPityBonus(user.shiny_pity) }); // forme de BASE
  // Phase 1 : accouplement. L'oeuf "en cours de reproduction" attend reproductionSeconds.
  const readyAt = Date.now() + reproductionSeconds(child.species) * 1000;
  const id = await insertCreature(req.user.id, { ...child, stage: 'mating' }, { hatch_at: readyAt, from_breeding: 1, parent_a: a.id, parent_b: b.id });
  // Les 2 parents quittent le farm (ils sont occupes a s'accoupler).
  await run("UPDATE creatures SET biome = NULL, in_prairie = 0 WHERE id IN (?, ?)", [a.id, b.id]);
  // Pity shiny + compteur de reproductions (succes "eleveur" a 10).
  await run('UPDATE users SET shiny_pity = ? WHERE id = ?', [child.variant === 1 ? 0 : (user.shiny_pity || 0) + 1, req.user.id]);
  await progressDaily(req.user.id, 'breed1', 1);
  const newAch = [];
  if (child.variant === 1) { const a2 = await unlockAch(req.user.id, 'shiny'); if (a2) newAch.push(a2); }
  const bred = (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND from_breeding = 1", [req.user.id])).n;
  if (bred >= 10) { const a3 = await unlockAch(req.user.id, 'breeder'); if (a3) newAch.push(a3); }
  const row = await get('SELECT * FROM creatures WHERE id = ?', [id]);
  res.json({ ok: true, egg: publicCreature(row), newAch });
}));

// ---------- Acheter une cellule de reproduction (tres cher) ----------
app.post('/api/breeding/buy-cell', requireAuth, h(async (req, res) => {
  const user = await reloadUser(req.user.id);
  if (user.breeding_cells >= BALANCE.breedingMaxCells) {
    return res.status(400).json({ error: 'Nombre maximum de cellules atteint.' });
  }
  const cost = breedingCellCost(user.breeding_cells);
  if (!(await spend(user.id, cost))) {
    return res.status(400).json({ error: `Pas assez d'essence (besoin de ${cost}).` });
  }
  await run('UPDATE users SET breeding_cells = breeding_cells + 1 WHERE id = ?', [user.id]);
  res.json({ ok: true, cost });
}));

// ---------- Acheter un incubateur ----------
app.post('/api/incubator/buy', requireAuth, h(async (req, res) => {
  const user = await reloadUser(req.user.id);
  if (user.incubator_slots >= BALANCE.maxSlots) {
    return res.status(400).json({ error: 'Nombre maximum d\'incubateurs atteint.' });
  }
  const cost = nextSlotCost(user.incubator_slots);
  if (!(await spend(user.id, cost))) {
    return res.status(400).json({ error: `Pas assez d'essence (besoin de ${cost}).` });
  }
  await run('UPDATE users SET incubator_slots = incubator_slots + 1 WHERE id = ?', [user.id]);
  res.json({ ok: true, cost });
}));

// ---------- Relacher une creature ----------
app.post('/api/creature/release', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  if (c.stage === 'egg') return res.status(400).json({ error: 'On ne relache pas un oeuf.' });
  if (c.favorite === 1) return res.status(400).json({ error: 'Ce Glump est en favori (verrouille). Retire le coeur d\'abord.' });

  const refund = Math.round(creatureValue(c) * 0.5);
  await run('DELETE FROM creatures WHERE id = ?', [id]);
  await run('UPDATE users SET essence = essence + ? WHERE id = ?', [refund, req.user.id]);
  res.json({ ok: true, refund });
}));

// ---------- Boutique : oeufs (basique=essence / type=ressource), objets, terrains ----------
app.get('/api/shop', (req, res) => res.json({
  elements: ELEMENTS,
  eggPrice: SHOP_EGG_PRICE,          // oeuf basique (type aleatoire) en essence
  typeEggCost: TYPE_EGG_COST,        // oeuf typé, en ressource du biome
  biomeOfType: BIOME_OF_TYPE,        // element -> biome (donc -> ressource)
  biomes: BIOME_LIST.map(b => ({ id: b.id, name: b.name, emoji: b.emoji, types: b.types, resource: b.resource, resName: b.resName, resEmoji: b.resEmoji, cost: b.cost })),
  candy: { cost: BALANCE.candyCost, xp: BALANCE.candyXp },
  potion: { cost: BALANCE.potionCost },
  revive: { cost: BALANCE.reviveCost },
}));

// Achat d'oeuf : type 'basic' -> essence (type aleatoire) ; type element -> ressource du biome.
app.post('/api/shop/buy-egg', requireAuth, h(async (req, res) => {
  const type = String((req.body || {}).type || '');
  const isBasic = type === 'basic';
  if (!isBasic && !ELEMENTS.includes(type)) return res.status(400).json({ error: 'Type d\'oeuf inconnu.' });

  const eggCount = (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND stage = 'egg' AND from_breeding = 0", [req.user.id])).n;
  if (eggCount >= req.user.incubator_slots) {
    return res.status(400).json({ error: 'Tous tes incubateurs sont occupes.' });
  }

  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    let payInfo;
    if (isBasic) {
      if (!(await spend(req.user.id, SHOP_EGG_PRICE))) return { status: 400, error: `Pas assez d'essence (besoin de ${SHOP_EGG_PRICE}).` };
      payInfo = { cost: SHOP_EGG_PRICE, resource: 'essence' };
    } else {
      const biomeId = BIOME_OF_TYPE[type];
      const b = biomeId && BIOMES[biomeId];
      if (!b) return { status: 400, error: 'Aucun biome pour ce type.' };
      const res2 = parseResources(user);
      if ((res2[b.resource] || 0) < TYPE_EGG_COST) {
        return { status: 400, error: `Pas assez de ${b.resName} ${b.resEmoji} (besoin de ${TYPE_EGG_COST}). Farme dans le ${b.name} ${b.emoji}.` };
      }
      res2[b.resource] -= TYPE_EGG_COST;
      await run('UPDATE users SET resources_json = ? WHERE id = ?', [JSON.stringify(res2), req.user.id]);
      payInfo = { cost: TYPE_EGG_COST, resource: b.resource };
    }
    const species = isBasic ? randomBase() : randomBaseOfType(type);
    const child = wildCreature(species, { adult: false, pityBonus: shinyPityBonus(user.shiny_pity) });
    const hatchAt = Date.now() + incubationSeconds(species) * 1000;
    const eggId = await insertCreature(req.user.id, { ...child, stage: 'egg' }, { hatch_at: hatchAt, from_breeding: 0 });
    await run('UPDATE users SET shiny_pity = ? WHERE id = ?', [child.variant === 1 ? 0 : (user.shiny_pity || 0) + 1, req.user.id]);
    const newAch = [];
    if (child.variant === 1) { const a = await unlockAch(req.user.id, 'shiny'); if (a) newAch.push(a); }
    await progressDaily(req.user.id, 'buyegg2', 1);
    const row = await get('SELECT * FROM creatures WHERE id = ?', [eggId]);
    return { ok: true, egg: publicCreature(row), ...payInfo, newAch };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

// Accelerer (terminer instantanement) un oeuf en cours (incubateur OU cellule).
app.post('/api/egg/accelerate', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Oeuf introuvable.' });
  if (c.stage !== 'egg') return res.status(400).json({ error: "Ce n'est pas un oeuf en cours." });
  const remaining = Math.max(0, (c.hatch_at || 0) - Date.now());
  const cost = accelerateCost(remaining);
  if (!(await spend(req.user.id, cost))) return res.status(400).json({ error: `Pas assez d'essence (besoin de ${cost}).` });
  await run('UPDATE creatures SET hatch_at = ? WHERE id = ?', [Date.now(), id]);
  res.json({ ok: true, cost });
}));

// ---------- Biomes : 1 biome ACTIF, tes farmeurs y produisent sa ressource ----------
// Choisir le biome actif (parmi ceux possedes) : tous les Glumps qui farment basculent dessus.
app.post('/api/biome/active', requireAuth, h(async (req, res) => {
  const { biome } = req.body || {};
  if (!BIOMES[biome]) return res.status(400).json({ error: 'Biome inconnu.' });
  const user = await reloadUser(req.user.id);
  if (!parseBiomes(user).includes(biome)) return res.status(400).json({ error: 'Tu ne possedes pas ce terrain (achete-le).' });
  await run('UPDATE users SET active_biome = ? WHERE id = ?', [biome, req.user.id]);
  // Tous les farmeurs basculent vers le biome actif.
  await run("UPDATE creatures SET biome = ? WHERE owner_id = ? AND biome IS NOT NULL", [biome, req.user.id]);
  res.json({ ok: true, biome });
}));

// Mettre un Glump a farmer (dans le biome ACTIF), dans la limite des emplacements.
app.post('/api/biome/assign', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const user = await reloadUser(req.user.id);
  const active = user.active_biome || 'plaine';
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  if (c.stage !== 'adult') return res.status(400).json({ error: 'Seuls les adultes peuvent farmer.' });
  if (c.biome) return res.json({ ok: true });
  // Occupe par un accouplement ou une exploration ?
  const mating = await get("SELECT 1 AS x FROM creatures WHERE owner_id = ? AND from_breeding = 1 AND stage = 'mating' AND (parent_a = ? OR parent_b = ?) LIMIT 1", [req.user.id, id, id]);
  if (mating) return res.status(400).json({ error: 'Ce Glump est en accouplement (occupe).' });
  if (exploringIds(user).has(Number(id))) return res.status(400).json({ error: 'Ce Glump est en exploration (occupe).' });
  const used = (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND biome IS NOT NULL", [req.user.id])).n;
  if (used >= user.prairie_slots) return res.status(400).json({ error: 'Plus d\'emplacement libre — achete-en un.' });
  await run("UPDATE creatures SET biome = ?, in_prairie = 1 WHERE id = ?", [active, id]);
  res.json({ ok: true });
}));

app.post('/api/biome/remove', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT id FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  await run("UPDATE creatures SET biome = NULL, in_prairie = 0 WHERE id = ?", [id]);
  res.json({ ok: true });
}));

// Acheter un terrain (biome) avec de l'essence.
app.post('/api/biome/buy', requireAuth, h(async (req, res) => {
  const { biome } = req.body || {};
  const b = BIOMES[biome];
  if (!b || b.id === 'plaine') return res.status(400).json({ error: 'Terrain non achetable.' });
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    const owned = parseBiomes(user);
    if (owned.includes(biome)) return { status: 400, error: 'Tu possedes deja ce terrain.' };
    if (!(await spend(req.user.id, b.cost))) return { status: 400, error: `Pas assez d'essence (besoin de ${b.cost}).` };
    owned.push(biome);
    await run('UPDATE users SET biomes_json = ? WHERE id = ?', [JSON.stringify(owned), req.user.id]);
    return { ok: true, cost: b.cost, biome: b.id };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

// Compat : ancienne route prairie/assign -> assigne a la Plaine.
app.post('/api/prairie/assign', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const user = await reloadUser(req.user.id);
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  if (c.stage !== 'adult') return res.status(400).json({ error: 'Seuls les adultes peuvent farmer.' });
  if (c.biome === 'plaine') return res.json({ ok: true });
  const used = (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND biome = 'plaine'", [req.user.id])).n;
  if (used >= user.prairie_slots) return res.status(400).json({ error: 'Plaine pleine — achete un emplacement.' });
  await run("UPDATE creatures SET biome = 'plaine', in_prairie = 1 WHERE id = ?", [id]);
  res.json({ ok: true });
}));
app.post('/api/prairie/remove', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT id FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  await run("UPDATE creatures SET biome = NULL, in_prairie = 0 WHERE id = ?", [id]);
  res.json({ ok: true });
}));

app.post('/api/prairie/buy', requireAuth, h(async (req, res) => {
  const user = await reloadUser(req.user.id);
  if (user.prairie_slots >= BALANCE.prairieMaxSlots) {
    return res.status(400).json({ error: 'Nombre maximum d\'emplacements atteint.' });
  }
  const cost = prairieSlotCost(user.prairie_slots);
  if (!(await spend(user.id, cost))) {
    return res.status(400).json({ error: `Pas assez d'essence (besoin de ${cost}).` });
  }
  await run('UPDATE users SET prairie_slots = prairie_slots + 1 WHERE id = ?', [user.id]);
  res.json({ ok: true, cost });
}));

// ---------- Super Bonbon : donne de l'XP a un Glump (paye en essence) ----------
app.post('/api/creature/candy', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  if (c.stage === 'egg') return res.status(400).json({ error: 'Un oeuf ne peut pas gagner d\'XP.' });
  if (!(await spend(req.user.id, BALANCE.candyCost))) {
    return res.status(400).json({ error: `Pas assez d'essence (besoin de ${BALANCE.candyCost}).` });
  }
  await run('UPDATE creatures SET xp = xp + ? WHERE id = ?', [BALANCE.candyXp, id]);
  await progressDaily(req.user.id, 'candy3', 1);
  const row = await get('SELECT * FROM creatures WHERE id = ?', [id]);
  const newAch = [];
  if (levelFromXp(row.xp) >= 50) { const a = await unlockAch(req.user.id, 'level50'); if (a) newAch.push(a); }
  res.json({ ok: true, creature: publicCreature(row), cost: BALANCE.candyCost, xp: BALANCE.candyXp, newAch });
}));

// ---------- Soins : Potion (PV max) / Rappel (ranime un KO) ----------
app.post('/api/heal/potion', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  const pc = publicCreature(c);
  if (pc.fainted) return res.status(400).json({ error: 'Ce Glump est KO : utilise un Rappel d\'abord.' });
  if (pc.hp >= pc.maxHp) return res.status(400).json({ error: 'Ce Glump a deja tous ses PV.' });
  if (!(await spend(req.user.id, BALANCE.potionCost))) return res.status(400).json({ error: `Pas assez d'essence (besoin de ${BALANCE.potionCost}).` });
  await run('UPDATE creatures SET hp = NULL WHERE id = ?', [id]); // pleine vie
  res.json({ ok: true, cost: BALANCE.potionCost });
}));

app.post('/api/heal/revive', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  const pc = publicCreature(c);
  if (!pc.fainted) return res.status(400).json({ error: "Ce Glump n'est pas KO." });
  if (!(await spend(req.user.id, BALANCE.reviveCost))) return res.status(400).json({ error: `Pas assez d'essence (besoin de ${BALANCE.reviveCost}).` });
  await run('UPDATE creatures SET hp = ? WHERE id = ?', [Math.round(pc.maxHp / 2), id]); // ranime a moitie
  res.json({ ok: true, cost: BALANCE.reviveCost });
}));

// ---------- Faire evoluer ----------
app.post('/api/creature/evolve', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  if (c.stage !== 'adult') return res.status(400).json({ error: 'Seuls les adultes peuvent evoluer.' });

  const target = evolutionOf(c.species);
  if (!target) return res.status(400).json({ error: 'Ce Glump est deja a sa forme finale.' });

  const level = levelFromXp(c.xp || 0);
  const reqLevel = evolveLevelOf(c.species);
  if (level < reqLevel) {
    return res.status(400).json({ error: `Niveau ${reqLevel} requis pour evoluer (actuel : ${level}).` });
  }
  const cost = evolveCost(target);
  if (!(await spend(req.user.id, cost))) {
    return res.status(400).json({ error: `Pas assez d'essence pour evoluer (besoin de ${cost}).` });
  }

  await run('UPDATE creatures SET species = ? WHERE id = ?', [target, id]);
  await progressDaily(req.user.id, 'evolve1', 1);
  const newAch = []; { const a = await unlockAch(req.user.id, 'first_evolve'); if (a) newAch.push(a); }
  const row = await get('SELECT * FROM creatures WHERE id = ?', [id]);
  res.json({ ok: true, creature: publicCreature(row), fromName: SPECIES[c.species].name, cost, newAch });
}));

// ---------- Renommer ----------
app.post('/api/creature/rename', requireAuth, h(async (req, res) => {
  const { id, nickname } = req.body || {};
  const name = String(nickname || '').slice(0, 20);
  const c = await get('SELECT id FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  await run('UPDATE creatures SET nickname = ? WHERE id = ?', [name || null, id]);
  res.json({ ok: true });
}));

// ---------- Classement (multijoueur) — calcule puis cache 30s ----------
let lbCache = { at: 0, board: [] };
async function computeLeaderboard() {
  // 1 seule requete : on agrege en JS (la valeur depend de stats/genes/niveau).
  const rows = await all(
    "SELECT u.id AS uid, u.username AS username, c.* FROM users u " +
    "LEFT JOIN creatures c ON c.owner_id = u.id AND c.stage != 'egg'");
  const byUser = new Map();
  for (const r of rows) {
    let e = byUser.get(r.uid);
    if (!e) { e = { id: r.uid, username: r.username, collection: 0, best: 0, count: 0 }; byUser.set(r.uid, e); }
    if (r.species) { // a une creature
      const v = creatureValue(r);
      e.collection += v; e.count += 1; if (v > e.best) e.best = v;
    }
  }
  return [...byUser.values()].sort((a, b) => b.collection - a.collection).slice(0, 50);
}
app.get('/api/leaderboard', h(async (req, res) => {
  const now = Date.now();
  if (now - lbCache.at > 30000) lbCache = { at: now, board: await computeLeaderboard() };
  res.json({ board: lbCache.board });
}));

// ---------- Visiter l'elevage d'un autre joueur ----------
app.get('/api/farm/:userId', h(async (req, res) => {
  const u = await get('SELECT id, username FROM users WHERE id = ?', [Number(req.params.userId)]);
  if (!u) return res.status(404).json({ error: 'Joueur introuvable.' });
  const rows = await all(
    "SELECT * FROM creatures WHERE owner_id = ? AND stage != 'egg' ORDER BY created_at ASC", [u.id]);
  res.json({ username: u.username, creatures: rows.map(c => publicCreature(c)) });
}));

// ---------- Starters proposes a l'inscription ----------
app.get('/api/starters', (req, res) => {
  const starters = STARTER_IDS.map(id => {
    const sp = SPECIES[id];
    return { id, species: id, name: sp.name, type: sp.type, color: sp.color, shape: sp.shape, rarity: sp.rarity, hasArt: hasArt(id) };
  });
  res.json({ starters });
});

// ---------- Social : amis & code ami ----------
app.get('/api/social', requireAuth, h(async (req, res) => {
  const code = await ensureFriendCode(req.user);
  const friends = await all(
    'SELECT u.id, u.username FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.username',
    [req.user.id]);
  res.json({ code, friends });
}));

app.post('/api/social/add', requireAuth, h(async (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Entre un code ami.' });
  const friend = await get('SELECT id, username FROM users WHERE friend_code = ?', [code]);
  if (!friend) return res.status(404).json({ error: 'Aucun joueur avec ce code.' });
  if (friend.id === req.user.id) return res.status(400).json({ error: "C'est ton propre code !" });
  const now = Date.now();
  await run('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)', [req.user.id, friend.id, now]);
  await run('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)', [friend.id, req.user.id, now]);
  res.json({ ok: true, friend });
}));

app.post('/api/social/remove', requireAuth, h(async (req, res) => {
  const fid = Number((req.body || {}).friendId);
  await run('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
    [req.user.id, fid, fid, req.user.id]);
  res.json({ ok: true });
}));

// ---------- PvP / Arene ----------
function fighterFiche(row, { full = false } = {}) {
  const pc = publicCreature(row);
  return {
    id: row.id, name: pc.nickname || pc.speciesName, species: pc.species, type: pc.type,
    variant: pc.variant, color: pc.color, shape: pc.shape, hasArt: pc.hasArt, line: pc.line,
    rarity: pc.rarity, level: pc.level, stats: pc.stats, power: pc.power,
    hp: full ? pc.maxHp : pc.hp, maxHp: pc.maxHp, fainted: pc.fainted,
  };
}
async function topTeam(userId) {
  // Adversaire : equipe a PV pleins (snapshot), exclut les KO.
  const rows = await all("SELECT * FROM creatures WHERE owner_id = ? AND stage = 'adult'", [userId]);
  return rows.map(r => fighterFiche(r, { full: true }))
    .filter(f => !f.fainted)
    .sort((a, b) => b.power - a.power).slice(0, 3);
}

app.get('/api/pvp/opponent', requireAuth, h(async (req, res) => {
  const candidates = await all(
    "SELECT DISTINCT u.id, u.username, u.pvp_trophies FROM users u JOIN creatures c ON c.owner_id = u.id AND c.stage = 'adult' WHERE u.id != ?",
    [req.user.id]);
  if (!candidates.length) return res.status(404).json({ error: 'Aucun adversaire disponible (invite des amis !).' });
  const opp = candidates[Math.floor(Math.random() * candidates.length)];
  res.json({ id: opp.id, username: opp.username, trophies: opp.pvp_trophies, team: await topTeam(opp.id) });
}));

// --- Combat tour-par-tour interactif (attaques au choix + statuts) ---
const battles = new Map(); // battleId -> { userId, opponentId, oppName, state, mineIds, createdAt }
function pubFighter(f) {
  return { id: f.id, name: f.name, species: f.species, type: f.type, variant: f.variant,
    color: f.color, shape: f.shape, hasArt: f.hasArt, line: f.line, rarity: f.rarity, level: f.level,
    hp: f.hp, maxHp: f.maxHp, status: f.status };
}
function publicBattle(state, id, oppName) {
  const aIdx = state.A.findIndex(f => f.hp > 0);
  const bIdx = state.B.findIndex(f => f.hp > 0);
  return {
    battleId: id, oppName,
    me: state.A.map(pubFighter), opp: state.B.map(pubFighter),
    activeMe: aIdx, activeOpp: bIdx,
    myMoves: aIdx >= 0 ? moveButtons(state.A[aIdx].type) : [],
    over: state.over, winner: state.winner,
  };
}
function purgeBattles() {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, b] of battles) if (b.createdAt < cutoff) battles.delete(id);
}

app.post('/api/pvp/start', requireAuth, h(async (req, res) => {
  purgeBattles();
  const { opponentId, team } = req.body || {};
  if (!Array.isArray(team) || team.length < 1 || team.length > BALANCE.pvpTeamSize) {
    return res.status(400).json({ error: `Choisis 1 a ${BALANCE.pvpTeamSize} Glumps.` });
  }
  const exploring = exploringIds(await reloadUser(req.user.id));
  const mine = [];
  for (const id of team) {
    const c = await get("SELECT * FROM creatures WHERE id = ? AND owner_id = ? AND stage = 'adult'", [id, req.user.id]);
    if (!c) return res.status(400).json({ error: 'Equipe invalide (adultes uniquement).' });
    if (publicCreature(c).fainted) return res.status(400).json({ error: 'Un de tes Glumps est KO — ranime-le (Rappel) avant de combattre.' });
    if (exploring.has(Number(id))) return res.status(400).json({ error: 'Un de tes Glumps est en exploration (occupe).' });
    mine.push(c);
  }
  const opp = await get('SELECT id, username FROM users WHERE id = ?', [opponentId]);
  if (!opp) return res.status(404).json({ error: 'Adversaire introuvable.' });
  const oppFiches = await topTeam(opponentId);
  if (!oppFiches.length) return res.status(400).json({ error: "Cet adversaire n'a pas d'equipe." });

  const state = startSession(mine.map(fighterFiche), oppFiches);
  const id = randomBytes(8).toString('hex');
  battles.set(id, { userId: req.user.id, opponentId, oppName: opp.username, state, mineIds: mine.map(c => c.id), createdAt: Date.now() });
  res.json(publicBattle(state, id, opp.username));
}));

app.post('/api/pvp/move', requireAuth, h(async (req, res) => {
  const { battleId, moveId } = req.body || {};
  const b = battles.get(battleId);
  if (!b || b.userId !== req.user.id) return res.status(404).json({ error: 'Combat introuvable (relance-le).' });
  if (b.state.over) return res.status(400).json({ error: 'Combat deja termine.' });

  const turn = playTurn(b.state, moveId);

  let result = null;
  if (b.state.over) {
    const iWon = b.state.winner === 'a';
    const user = await reloadUser(req.user.id);
    let trophies = user.pvp_trophies, essence = 0;
    const xp = iWon ? 60 : 20;
    if (iWon) { trophies += BALANCE.pvpWinTrophies; essence = BALANCE.pvpWinEssence; }
    else { trophies = Math.max(0, trophies - BALANCE.pvpLoseTrophies); }
    await run('UPDATE users SET pvp_trophies = ?, essence = essence + ? WHERE id = ?', [trophies, essence, req.user.id]);
    // Persistance des PV de mon equipe (PV finaux ; 0 = KO) + XP.
    for (let i = 0; i < b.mineIds.length; i++) {
      await run('UPDATE creatures SET xp = xp + ?, hp = ? WHERE id = ?', [xp, b.state.A[i].hp, b.mineIds[i]]);
    }
    const newAch = [];
    if (iWon) {
      await progressDaily(req.user.id, 'pvp3', 1);
      const a = await unlockAch(req.user.id, 'first_pvp'); if (a) newAch.push(a);
    }
    result = { winner: iWon ? 'me' : 'opp', rewards: { trophies: iWon ? BALANCE.pvpWinTrophies : -BALANCE.pvpLoseTrophies, essence, xp }, trophies, newAch };
    battles.delete(battleId);
  }

  res.json({ events: turn.events, state: publicBattle(b.state, battleId, b.oppName), result });
}));

app.get('/api/pvp/ranking', h(async (req, res) => {
  const ranking = await all('SELECT id, username, pvp_trophies AS trophies FROM users ORDER BY pvp_trophies DESC LIMIT 50');
  res.json({ ranking });
}));

// ---------- Favori (verrou anti-relache) ----------
app.post('/api/creature/favorite', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT favorite FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  const next = c.favorite === 1 ? 0 : 1;
  await run('UPDATE creatures SET favorite = ? WHERE id = ?', [next, id]);
  res.json({ ok: true, favorite: next === 1 });
}));

// ---------- Relacher en masse (ignore oeufs + favoris) ----------
app.post('/api/creature/release-many', requireAuth, h(async (req, res) => {
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Aucun Glump selectionne.' });
  let refund = 0, released = 0;
  for (const id of ids) {
    const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
    if (!c || c.stage === 'egg' || c.favorite === 1) continue;
    refund += Math.round(creatureValue(c) * 0.5);
    await run('DELETE FROM creatures WHERE id = ?', [id]);
    released++;
  }
  if (refund > 0) await run('UPDATE users SET essence = essence + ? WHERE id = ?', [refund, req.user.id]);
  res.json({ ok: true, released, refund });
}));

// ---------- Progression : quetes du jour, succes, paliers dex, streak ----------
app.get('/api/progress', requireAuth, h(async (req, res) => {
  const user = await reloadUser(req.user.id);
  const daily = dailyView(await getDaily(user));
  const unlocked = parseAchSet(user);
  const achievements = ACHIEVEMENTS.map(a => ({ ...a, unlocked: unlocked.has(a.id) }));
  // Paliers du dex : combien decouverts + lesquels reclamables.
  const discCount = (await get('SELECT COUNT(*) AS n FROM discoveries WHERE user_id = ? AND variant = 0', [req.user.id])).n;
  const claimed = user.dex_claimed || 0;
  const milestones = DEX_MILESTONES.map((m, i) => ({
    count: m.count, essence: m.essence, prairie: !!m.prairie, cell: !!m.cell, title: m.title || null,
    reached: discCount >= m.count, claimed: i < claimed, claimable: discCount >= m.count && i >= claimed,
  }));
  res.json({
    daily, achievements,
    dex: { discovered: discCount, total: SPECIES_COUNT, milestones },
    streak: user.login_streak || 0,
  });
}));

// Reclamer la recompense d'une quete quotidienne terminee (verrouille : anti double-credit).
app.post('/api/daily/claim', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    const data = await getDaily(user);
    const q = data.quests.find(x => x.id === id);
    if (!q) return { status: 404, error: 'Quete introuvable.' };
    const def = DAILY_POOL.find(d => d.id === id);
    if (!def || (q.progress || 0) < def.goal) return { status: 400, error: 'Quete non terminee.' };
    if (q.claimed) return { status: 400, error: 'Recompense deja reclamee.' };
    q.claimed = true;
    await run('UPDATE users SET daily_json = ?, essence = essence + ? WHERE id = ?',
      [JSON.stringify(data), def.reward, req.user.id]);
    return { ok: true, reward: def.reward };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

// Reclamer un palier du Glumpdex (dans l'ordre ; verrouille).
app.post('/api/dex/claim', requireAuth, h(async (req, res) => {
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    const discCount = (await get('SELECT COUNT(*) AS n FROM discoveries WHERE user_id = ? AND variant = 0', [req.user.id])).n;
    const idx = user.dex_claimed || 0;
    const m = DEX_MILESTONES[idx];
    if (!m) return { status: 400, error: 'Tous les paliers sont deja reclames.' };
    if (discCount < m.count) return { status: 400, error: `Palier non atteint (${discCount}/${m.count}).` };
    let extra = '';
    if (m.prairie) { await run('UPDATE users SET prairie_slots = prairie_slots + 1 WHERE id = ?', [req.user.id]); extra = '+1 emplacement de prairie'; }
    if (m.cell) { await run('UPDATE users SET breeding_cells = breeding_cells + 1 WHERE id = ?', [req.user.id]); extra = '+1 cellule de reproduction'; }
    await run('UPDATE users SET dex_claimed = dex_claimed + 1, essence = essence + ? WHERE id = ?', [m.essence, req.user.id]);
    if (m.count >= SPECIES_COUNT) await unlockAch(req.user.id, 'dexmaster');
    return { ok: true, essence: m.essence, extra, title: m.title || null };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

// ---------- Echanges entre amis ----------
async function areFriends(a, b) {
  const r = await get('SELECT 1 AS ok FROM friends WHERE user_id = ? AND friend_id = ?', [a, b]);
  return !!r;
}
// Proposer un de mes Glumps a un ami (il devra offrir un des siens en retour a l'acceptation).
app.post('/api/trade/propose', requireAuth, h(async (req, res) => {
  const { toUser, creatureId } = req.body || {};
  const tid = Number(toUser);
  if (tid === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas echanger avec toi-meme.' });
  if (!(await areFriends(req.user.id, tid))) return res.status(400).json({ error: 'Tu dois etre ami avec ce joueur.' });
  const c = await get("SELECT * FROM creatures WHERE id = ? AND owner_id = ? AND stage != 'egg'", [creatureId, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable (ou oeuf).' });
  if (c.favorite === 1) return res.status(400).json({ error: 'Retire le favori avant d\'echanger ce Glump.' });
  await run('INSERT INTO trades (from_user, to_user, from_creature, status, created_at) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, tid, creatureId, 'pending', Date.now()]);
  res.json({ ok: true });
}));
// Lister mes echanges (recus en attente + envoyes).
app.get('/api/trade/list', requireAuth, h(async (req, res) => {
  const incoming = await all(
    "SELECT t.id, t.from_creature, u.username AS fromName, t.from_user FROM trades t " +
    "JOIN users u ON u.id = t.from_user WHERE t.to_user = ? AND t.status = 'pending' ORDER BY t.created_at DESC",
    [req.user.id]);
  const outgoing = await all(
    "SELECT t.id, t.from_creature, u.username AS toName, t.to_user FROM trades t " +
    "JOIN users u ON u.id = t.to_user WHERE t.from_user = ? AND t.status = 'pending' ORDER BY t.created_at DESC",
    [req.user.id]);
  const fiche = async (cid) => { const c = await get('SELECT * FROM creatures WHERE id = ?', [cid]); return c ? publicCreature(c) : null; };
  for (const t of incoming) t.creature = await fiche(t.from_creature);
  for (const t of outgoing) t.creature = await fiche(t.from_creature);
  res.json({ incoming, outgoing });
}));
// Accepter : j'offre un de mes Glumps en retour ; on echange les proprietaires.
app.post('/api/trade/accept', requireAuth, h(async (req, res) => {
  const { id, creatureId } = req.body || {};
  const t = await get("SELECT * FROM trades WHERE id = ? AND to_user = ? AND status = 'pending'", [id, req.user.id]);
  if (!t) return res.status(404).json({ error: 'Echange introuvable.' });
  const theirs = await get("SELECT * FROM creatures WHERE id = ? AND owner_id = ? AND stage != 'egg'", [t.from_creature, t.from_user]);
  const mine = await get("SELECT * FROM creatures WHERE id = ? AND owner_id = ? AND stage != 'egg'", [creatureId, req.user.id]);
  if (!theirs || !mine) { await run("UPDATE trades SET status = 'cancelled' WHERE id = ?", [id]); return res.status(400).json({ error: 'Un des Glumps n\'est plus disponible.' }); }
  if (mine.favorite === 1) return res.status(400).json({ error: 'Retire le favori avant d\'echanger ce Glump.' });
  if (theirs.favorite === 1) { await run("UPDATE trades SET status = 'cancelled' WHERE id = ?", [id]); return res.status(400).json({ error: 'L\'autre joueur a verrouille ce Glump (favori). Echange annule.' }); }
  // Echange des proprietaires (retire de la prairie pour eviter les incoherences de slots).
  await run('UPDATE creatures SET owner_id = ?, in_prairie = 0 WHERE id = ?', [req.user.id, theirs.id]);
  await run('UPDATE creatures SET owner_id = ?, in_prairie = 0 WHERE id = ?', [t.from_user, mine.id]);
  await run("UPDATE trades SET status = 'done' WHERE id = ?", [id]);
  res.json({ ok: true, received: publicCreature(await get('SELECT * FROM creatures WHERE id = ?', [theirs.id])) });
}));
// Refuser (destinataire) ou annuler (emetteur) un echange en attente.
app.post('/api/trade/cancel', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  await run("UPDATE trades SET status = 'cancelled' WHERE id = ? AND (to_user = ? OR from_user = ?) AND status = 'pending'",
    [id, req.user.id, req.user.id]);
  res.json({ ok: true });
}));

// ---------- Exploration : envoyer des Glumps explorer une zone ----------
app.post('/api/explore/start', requireAuth, h(async (req, res) => {
  const { biome, tier } = req.body || {};
  const zone = EXPLORE_ZONE_BY_ID[biome];
  const t = EXPLORE_TIER_BY_ID[tier];
  if (!zone || !t) return res.status(400).json({ error: 'Zone ou difficulte inconnue.' });
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    const exps = parseExpeditions(user);
    if (exps.some(e => e.biome === biome)) return { status: 400, error: 'Une exploration est deja en cours dans cette zone.' };
    const exploring = exploringIds(user);
    // Monstres qualifiants : adultes du type de la zone, niveau requis, non occupes.
    const rows = await all("SELECT id, species, xp, stage FROM creatures WHERE owner_id = ? AND stage = 'adult'", [req.user.id]);
    const mating = new Set((await all("SELECT parent_a, parent_b FROM creatures WHERE owner_id = ? AND stage = 'mating'", [req.user.id])).flatMap(m => [m.parent_a, m.parent_b]));
    const qualif = rows
      .map(c => ({ id: c.id, lvl: levelFromXp(c.xp || 0), type: SPECIES[c.species]?.type }))
      .filter(c => c.type === zone.type && c.lvl >= t.level && !exploring.has(c.id) && !mating.has(c.id))
      .sort((a, b) => b.lvl - a.lvl);
    if (qualif.length < t.count) {
      return { status: 400, error: `Il faut ${t.count} Glumps ${zone.type} niveau ${t.level}+ disponibles (tu en as ${qualif.length}).` };
    }
    const team = qualif.slice(0, t.count).map(c => c.id);
    const exped = { id: randomBytes(6).toString('hex'), biome, tier, team, startedAt: Date.now(), readyAt: Date.now() + t.durationSec * 1000 };
    exps.push(exped);
    await run('UPDATE users SET expeditions_json = ? WHERE id = ?', [JSON.stringify(exps), req.user.id]);
    // Les explorateurs quittent le farm.
    await run(`UPDATE creatures SET biome = NULL, in_prairie = 0 WHERE id IN (${team.map(() => '?').join(',')})`, team);
    return { ok: true, expedition: exped, zone: zone.name };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

// Recolter une exploration terminee.
app.post('/api/explore/collect', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    const exps = parseExpeditions(user);
    const ex = exps.find(e => e.id === id);
    if (!ex) return { status: 404, error: 'Exploration introuvable.' };
    if ((ex.readyAt || 0) > Date.now()) return { status: 400, error: 'Exploration pas encore terminee.' };
    const zone = EXPLORE_ZONE_BY_ID[ex.biome];
    const t = EXPLORE_TIER_BY_ID[ex.tier];
    // Recompenses : ressource du biome + objets + oeufs typés (limites par les incubateurs libres).
    const res2 = parseResources(user);
    res2[zone.resource] = (res2[zone.resource] || 0) + t.res;
    const items = parseItems(user);
    const gotItems = {};
    for (let i = 0; i < t.items; i++) { const it = EXPLORE_ITEMS[Math.floor(Math.random() * EXPLORE_ITEMS.length)]; items[it]++; gotItems[it] = (gotItems[it] || 0) + 1; }
    // Oeufs typés (jusqu'a t.eggs, dans la limite des incubateurs libres).
    const eggsLaid = [];
    if (Math.random() < t.eggChance) {
      let free = user.incubator_slots - (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND stage = 'egg' AND from_breeding = 0", [req.user.id])).n;
      let pity = user.shiny_pity || 0;
      for (let i = 0; i < t.eggs && free > 0; i++) {
        const species = randomBaseOfType(zone.type);
        const child = wildCreature(species, { adult: false, pityBonus: shinyPityBonus(pity) });
        await insertCreature(req.user.id, { ...child, stage: 'egg' }, { hatch_at: Date.now() + incubationSeconds(species) * 1000, from_breeding: 0 });
        pity = child.variant === 1 ? 0 : pity + 1;
        eggsLaid.push(SPECIES[species]?.name || species);
        free--;
      }
      await run('UPDATE users SET shiny_pity = ? WHERE id = ?', [pity, req.user.id]);
    }
    const left = exps.filter(e => e.id !== id);
    await run('UPDATE users SET expeditions_json = ?, items_json = ?, resources_json = ? WHERE id = ?',
      [JSON.stringify(left), JSON.stringify(items), JSON.stringify(res2), req.user.id]);
    return { ok: true, rewards: { resource: zone.resource, resEmoji: zone.resEmoji, amount: t.res, items: gotItems, eggs: eggsLaid } };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

// ---------- Utiliser un objet du sac (gratuit) ----------
async function useItem(req, res, kind, apply) {
  const { id } = req.body || {};
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    const items = parseItems(user);
    if (items[kind] <= 0) return { status: 400, error: 'Tu n\'as pas cet objet.' };
    const r = await apply(user);
    if (r && r.error) return r;
    items[kind]--;
    await run('UPDATE users SET items_json = ? WHERE id = ?', [JSON.stringify(items), req.user.id]);
    return { ok: true, ...(r || {}) };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}
app.post('/api/item/candy', requireAuth, h((req, res) => useItem(req, res, 'candy', async () => {
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [req.body.id, req.user.id]);
  if (!c || c.stage === 'egg') return { status: 400, error: 'Glump invalide.' };
  await run('UPDATE creatures SET xp = xp + ? WHERE id = ?', [BALANCE.candyXp, req.body.id]);
  return { xp: BALANCE.candyXp };
})));
app.post('/api/item/potion', requireAuth, h((req, res) => useItem(req, res, 'potion', async () => {
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [req.body.id, req.user.id]);
  if (!c) return { status: 404, error: 'Glump introuvable.' };
  const pc = publicCreature(c);
  if (pc.fainted) return { status: 400, error: 'KO : utilise un Rappel.' };
  await run('UPDATE creatures SET hp = NULL WHERE id = ?', [req.body.id]);
})));
app.post('/api/item/revive', requireAuth, h((req, res) => useItem(req, res, 'revive', async () => {
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [req.body.id, req.user.id]);
  if (!c) return { status: 404, error: 'Glump introuvable.' };
  const pc = publicCreature(c);
  if (!pc.fainted) return { status: 400, error: 'Ce Glump n\'est pas KO.' };
  await run('UPDATE creatures SET hp = ? WHERE id = ?', [Math.round(pc.maxHp / 2), req.body.id]);
})));

// Liste des succes (definitions) pour le client.
app.get('/api/achievements', (req, res) => res.json({ achievements: ACHIEVEMENTS }));

// ---------- Donnees statiques de jeu ----------
app.get('/api/species', (req, res) => {
  const out = {};
  for (const [id, sp] of Object.entries(SPECIES)) out[id] = { ...sp, hasArt: hasArt(id), tier: tierOf(id) };
  res.json({ species: out });
});

// ---------- Fichiers statiques ----------
// index.html ne doit jamais etre mis en cache (sinon le navigateur recharge
// d'anciens app.js?v=.. / sprites). Les assets versionnes (?v=) restent caches.
app.use(express.static(join(__dirname, '..', 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// ---------- Gestion d'erreurs ----------
app.use((err, req, res, next) => {
  console.error('Erreur:', err);
  res.status(500).json({ error: 'Erreur serveur interne.' });
});

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  Veilborn en ligne -> http://localhost:${PORT}`);
    if (usingTurso) {
      console.log(`  Base de donnees: TURSO (persistante) -> ${dbUrl}`);
      if (!hasToken) console.log('  /!\\ ATTENTION: TURSO_AUTH_TOKEN manquant -> la connexion va echouer.');
    } else {
      console.log('  Base de donnees: FICHIER LOCAL data.db');
      console.log('  /!\\ NON persistant en ligne : les comptes seront effaces a chaque redemarrage.');
      console.log('      -> definis TURSO_DATABASE_URL et TURSO_AUTH_TOKEN pour persister.');
    }
    console.log('');
  });
}).catch((err) => {
  console.error('Echec init base de donnees:', err);
  process.exit(1);
});
