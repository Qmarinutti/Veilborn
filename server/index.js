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
  BALANCE, STARTER_IDS, SPECIES, wildCreature, breed,
  incubationSeconds, nextSlotCost, creatureValue, evolutionOf, evolveLevelOf,
  levelFromXp, prairieSlotCost, ELEMENTS, SHOP_EGG_PRICE, randomBaseOfType, accelerateCost,
  breedingSeconds, breedingCellCost,
} from './game.js';
import { getPlayerState, publicCreature, reloadUser } from './state.js';
import { hasArt } from './art.js';

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

  // Le joueur commence avec le starter choisi (adulte), place en prairie pour farmer.
  await insertCreature(userId, wildCreature(starter, { adult: true }));
  await run('UPDATE creatures SET in_prairie = 1 WHERE owner_id = ?', [userId]);

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

  // Verifie qu'une cellule de reproduction est libre.
  const cellRow = await get(
    "SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND stage = 'egg' AND from_breeding = 1", [req.user.id]);
  if (cellRow.n >= req.user.breeding_cells) {
    return res.status(400).json({ error: 'Toutes tes cellules de reproduction sont occupees.' });
  }

  const child = breed(a, b); // toujours une forme de BASE (bebe), rarete d'acquisition tiree
  const hatchAt = Date.now() + breedingSeconds(child.species) * 1000;
  const id = await insertCreature(req.user.id, { ...child, stage: 'egg' }, { hatch_at: hatchAt, from_breeding: 1, parent_a: a.id, parent_b: b.id });
  const row = await get('SELECT * FROM creatures WHERE id = ?', [id]);
  res.json({ ok: true, egg: publicCreature(row) });
}));

// ---------- Acheter une cellule de reproduction (tres cher) ----------
app.post('/api/breeding/buy-cell', requireAuth, h(async (req, res) => {
  const user = await reloadUser(req.user.id);
  if (user.breeding_cells >= BALANCE.breedingMaxCells) {
    return res.status(400).json({ error: 'Nombre maximum de cellules atteint.' });
  }
  const cost = breedingCellCost(user.breeding_cells);
  if (user.essence < cost) {
    return res.status(400).json({ error: `Pas assez d'essence (besoin de ${cost}).` });
  }
  await run('UPDATE users SET essence = essence - ?, breeding_cells = breeding_cells + 1 WHERE id = ?', [cost, user.id]);
  res.json({ ok: true, cost });
}));

// ---------- Acheter un incubateur ----------
app.post('/api/incubator/buy', requireAuth, h(async (req, res) => {
  const user = await reloadUser(req.user.id);
  if (user.incubator_slots >= BALANCE.maxSlots) {
    return res.status(400).json({ error: 'Nombre maximum d\'incubateurs atteint.' });
  }
  const cost = nextSlotCost(user.incubator_slots);
  if (user.essence < cost) {
    return res.status(400).json({ error: `Pas assez d'essence (besoin de ${cost}).` });
  }
  await run('UPDATE users SET essence = essence - ?, incubator_slots = incubator_slots + 1 WHERE id = ?',
    [cost, user.id]);
  res.json({ ok: true, cost });
}));

// ---------- Relacher une creature ----------
app.post('/api/creature/release', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  if (c.stage === 'egg') return res.status(400).json({ error: 'On ne relache pas un oeuf.' });

  const refund = Math.round(creatureValue(c) * 0.5);
  await run('DELETE FROM creatures WHERE id = ?', [id]);
  await run('UPDATE users SET essence = essence + ? WHERE id = ?', [refund, req.user.id]);
  res.json({ ok: true, refund });
}));

// ---------- Boutique : oeufs par element / objets / bonus ----------
app.get('/api/shop', (req, res) => res.json({
  elements: ELEMENTS,
  eggPrice: SHOP_EGG_PRICE,
  candy: { cost: BALANCE.candyCost, xp: BALANCE.candyXp },
}));

app.post('/api/shop/buy-egg', requireAuth, h(async (req, res) => {
  const type = String((req.body || {}).type || '');
  if (!ELEMENTS.includes(type)) return res.status(400).json({ error: 'Element inconnu.' });

  const eggCount = (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND stage = 'egg' AND from_breeding = 0", [req.user.id])).n;
  if (eggCount >= req.user.incubator_slots) {
    return res.status(400).json({ error: 'Tous tes incubateurs sont occupes.' });
  }
  const user = await reloadUser(req.user.id);
  if (user.essence < SHOP_EGG_PRICE) {
    return res.status(400).json({ error: `Pas assez d'essence (besoin de ${SHOP_EGG_PRICE}).` });
  }

  const species = randomBaseOfType(type); // bebe aleatoire de cet element (luck)
  const child = wildCreature(species, { adult: false });
  const hatchAt = Date.now() + incubationSeconds(species) * 1000;
  await run('UPDATE users SET essence = essence - ? WHERE id = ?', [SHOP_EGG_PRICE, req.user.id]);
  const eggId = await insertCreature(req.user.id, { ...child, stage: 'egg' }, { hatch_at: hatchAt, from_breeding: 0 });
  const row = await get('SELECT * FROM creatures WHERE id = ?', [eggId]);
  res.json({ ok: true, egg: publicCreature(row), cost: SHOP_EGG_PRICE });
}));

// Accelerer (terminer instantanement) un oeuf en cours (incubateur OU cellule).
app.post('/api/egg/accelerate', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Oeuf introuvable.' });
  if (c.stage !== 'egg') return res.status(400).json({ error: "Ce n'est pas un oeuf en cours." });
  const remaining = Math.max(0, (c.hatch_at || 0) - Date.now());
  const cost = accelerateCost(remaining);
  const user = await reloadUser(req.user.id);
  if (user.essence < cost) return res.status(400).json({ error: `Pas assez d'essence (besoin de ${cost}).` });
  await run('UPDATE users SET essence = essence - ? WHERE id = ?', [cost, req.user.id]);
  await run('UPDATE creatures SET hatch_at = ? WHERE id = ?', [Date.now(), id]);
  res.json({ ok: true, cost });
}));

// ---------- Prairie : assigner / retirer / acheter un emplacement ----------
app.post('/api/prairie/assign', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  if (c.stage !== 'adult') return res.status(400).json({ error: 'Seuls les adultes peuvent farmer en prairie.' });
  if (c.in_prairie === 1) return res.json({ ok: true });
  const used = (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND in_prairie = 1", [req.user.id])).n;
  const user = await reloadUser(req.user.id);
  if (used >= user.prairie_slots) return res.status(400).json({ error: 'Prairie pleine — achete un emplacement.' });
  await run('UPDATE creatures SET in_prairie = 1 WHERE id = ?', [id]);
  res.json({ ok: true });
}));

app.post('/api/prairie/remove', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT id FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  await run('UPDATE creatures SET in_prairie = 0 WHERE id = ?', [id]);
  res.json({ ok: true });
}));

app.post('/api/prairie/buy', requireAuth, h(async (req, res) => {
  const user = await reloadUser(req.user.id);
  if (user.prairie_slots >= BALANCE.prairieMaxSlots) {
    return res.status(400).json({ error: 'Nombre maximum d\'emplacements atteint.' });
  }
  const cost = prairieSlotCost(user.prairie_slots);
  if (user.essence < cost) {
    return res.status(400).json({ error: `Pas assez d'essence (besoin de ${cost}).` });
  }
  await run('UPDATE users SET essence = essence - ?, prairie_slots = prairie_slots + 1 WHERE id = ?', [cost, user.id]);
  res.json({ ok: true, cost });
}));

// ---------- Super Bonbon : donne de l'XP a un Glump (paye en essence) ----------
app.post('/api/creature/candy', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  if (c.stage === 'egg') return res.status(400).json({ error: 'Un oeuf ne peut pas gagner d\'XP.' });
  const user = await reloadUser(req.user.id);
  if (user.essence < BALANCE.candyCost) {
    return res.status(400).json({ error: `Pas assez d'essence (besoin de ${BALANCE.candyCost}).` });
  }
  await run('UPDATE users SET essence = essence - ? WHERE id = ?', [BALANCE.candyCost, req.user.id]);
  await run('UPDATE creatures SET xp = xp + ? WHERE id = ?', [BALANCE.candyXp, id]);
  const row = await get('SELECT * FROM creatures WHERE id = ?', [id]);
  res.json({ ok: true, creature: publicCreature(row), cost: BALANCE.candyCost, xp: BALANCE.candyXp });
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

  await run('UPDATE creatures SET species = ? WHERE id = ?', [target, id]);
  const row = await get('SELECT * FROM creatures WHERE id = ?', [id]);
  res.json({ ok: true, creature: publicCreature(row), fromName: SPECIES[c.species].name });
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

// ---------- Classement (multijoueur) ----------
app.get('/api/leaderboard', h(async (req, res) => {
  const users = await all('SELECT id, username FROM users');
  const board = [];
  for (const u of users) {
    const cs = await all('SELECT * FROM creatures WHERE owner_id = ?', [u.id]);
    let value = 0, best = 0;
    for (const c of cs) {
      if (c.stage === 'egg') continue;
      const v = creatureValue(c);
      value += v;
      if (v > best) best = v;
    }
    board.push({ id: u.id, username: u.username, collection: value, best, count: cs.length });
  }
  board.sort((a, b) => b.collection - a.collection);
  res.json({ board: board.slice(0, 50) });
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

// ---------- Donnees statiques de jeu ----------
app.get('/api/species', (req, res) => {
  const out = {};
  for (const [id, sp] of Object.entries(SPECIES)) out[id] = { ...sp, hasArt: hasArt(id) };
  res.json({ species: out });
});

// ---------- Fichiers statiques ----------
app.use(express.static(join(__dirname, '..', 'public')));

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
