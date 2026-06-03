// Serveur principal : API REST + service des fichiers statiques.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { get, all, run, insert, initDb, usingTurso, dbUrl, hasToken } from './db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  userFromRequest, requireAuth, tokenFromRequest,
} from './auth.js';
import {
  BALANCE, STARTER_IDS, SPECIES, wildCreature, breed,
  incubationSeconds, nextSlotCost, creatureValue, evolutionOf, evolveCost,
  prairieSlotCost, EGG_SHOP, randomSpeciesInRarity,
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
      (owner_id, species, stage, gene_force, gene_vita, gene_speed, variant, nickname, hatch_at, mature_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ownerId, c.species, c.stage ?? 'adult',
     c.gene_force, c.gene_vita, c.gene_speed, c.variant ?? 0,
     extra.nickname ?? null, extra.hatch_at ?? null, extra.mature_at ?? null, now]);
}

function setCookie(res, token) {
  res.setHeader('Set-Cookie',
    `sid=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
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
    'INSERT INTO users (username, pass_hash, pass_salt, essence, incubator_slots, last_tick, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [username, hash, salt, BALANCE.startEssence, BALANCE.startSlots, now, now]);

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

  const eggRow = await get(
    "SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND stage = 'egg'", [req.user.id]);
  if (eggRow.n >= req.user.incubator_slots) {
    return res.status(400).json({ error: 'Tous tes incubateurs sont occupes.' });
  }

  const child = breed(a, b);
  const hatchAt = Date.now() + incubationSeconds(child.species) * 1000;
  const id = await insertCreature(req.user.id, { ...child, stage: 'egg' }, { hatch_at: hatchAt });
  const row = await get('SELECT * FROM creatures WHERE id = ?', [id]);
  res.json({ ok: true, egg: publicCreature(row) });
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

// ---------- Boutique d'oeufs ----------
app.get('/api/shop', (req, res) => res.json({ eggs: EGG_SHOP }));

app.post('/api/shop/buy-egg', requireAuth, h(async (req, res) => {
  const { tier } = req.body || {};
  const item = EGG_SHOP.find(e => e.id === tier);
  if (!item) return res.status(400).json({ error: 'Oeuf inconnu.' });

  const eggCount = (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND stage = 'egg'", [req.user.id])).n;
  if (eggCount >= req.user.incubator_slots) {
    return res.status(400).json({ error: 'Tous tes incubateurs sont occupes.' });
  }
  const user = await reloadUser(req.user.id);
  if (user.essence < item.price) {
    return res.status(400).json({ error: `Pas assez d'essence (besoin de ${item.price}).` });
  }

  const species = randomSpeciesInRarity(item.rarities[0], item.rarities[1]);
  const child = wildCreature(species, { adult: false });
  const hatchAt = Date.now() + incubationSeconds(species) * 1000;
  await run('UPDATE users SET essence = essence - ? WHERE id = ?', [item.price, req.user.id]);
  const eggId = await insertCreature(req.user.id, { ...child, stage: 'egg' }, { hatch_at: hatchAt });
  const row = await get('SELECT * FROM creatures WHERE id = ?', [eggId]);
  res.json({ ok: true, egg: publicCreature(row), cost: item.price });
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

// ---------- Faire evoluer ----------
app.post('/api/creature/evolve', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  if (c.stage !== 'adult') return res.status(400).json({ error: 'Seuls les adultes peuvent evoluer.' });

  const target = evolutionOf(c.species);
  if (!target) return res.status(400).json({ error: 'Ce Glump est deja a sa forme finale.' });

  const user = await reloadUser(req.user.id);
  const cost = evolveCost(target);
  if (user.essence < cost) {
    return res.status(400).json({ error: `Pas assez d'essence (besoin de ${cost}).` });
  }

  await run('UPDATE users SET essence = essence - ? WHERE id = ?', [cost, req.user.id]);
  await run('UPDATE creatures SET species = ? WHERE id = ?', [target, id]);
  const row = await get('SELECT * FROM creatures WHERE id = ?', [id]);
  res.json({ ok: true, creature: publicCreature(row), cost, fromName: SPECIES[c.species].name });
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
