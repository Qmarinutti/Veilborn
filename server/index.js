// Serveur principal : API REST + service des fichiers statiques.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { get, all, run, insert, initDb, usingTurso, dbUrl, hasToken } from './db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  userFromRequest, requireAuth, tokenFromRequest, genRecoveryCode, canonRecovery,
} from './auth.js';
import {
  BALANCE, STARTER_IDS, SPECIES, SPECIES_COUNT, wildCreature, breed,
  incubationSeconds, nextSlotCost, creatureValue, evolutionOf, evolveLevelOf,
  levelFromXp, xpForLevel, prairieSlotCost, ELEMENTS, SHOP_EGG_PRICE, randomBaseOfType, accelerateCost,
  reproductionSeconds, breedHatchSeconds, breedingCellCost, evolveCost, evolveResourceCost, shinyPityBonus, tierOf,
  BIOMES, BIOME_LIST, BIOME_OF_TYPE, biomeBuyCost, TYPE_EGG_COST, randomBase, RESOURCES,
  EXPLORE_ZONE_BY_ID, EXPLORE_TIER_BY_ID, EXPLORE_ITEMS, eventMul, guildTarget, guildFarmBonus,
  BREED_RECIPES, BREED_CHART,
} from './game.js';
import { getPlayerState, publicCreature, reloadUser, parseResources, parseBiomes, parseExpeditions, parseItems, exploringIds } from './state.js';
import { withLock } from './lock.js';
import { hasArt } from './art.js';
import { startSession, playTurn } from './battle.js';
import { moveButtons } from './moves.js';
import {
  ACHIEVEMENTS, DEX_MILESTONES, SHINY_DEX_MILESTONES, PVP_MILESTONES, DAILY_POOL, parseAchSet, unlockAch,
  getDaily, progressDaily, dailyView, todayStr, dexClaimedCount,
  TITLES, availableTitles, titleName, titleNameById,
} from './progress.js';
import { chatReject } from './moderation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // Render est derriere un proxy -> req.ip = vraie IP cliente
app.use(express.json({ limit: '64kb' })); // body raisonnable (evite l'abus memoire)

// En-tetes de securite basiques sur toutes les reponses.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Anti-brute-force simple (en prod uniquement, pour ne pas gener les tests locaux) :
// limite les tentatives login/register par IP sur une fenetre glissante.
const authHits = new Map();
function authThrottle(req, res, next) {
  if (!usingTurso) return next();
  const ip = req.ip || 'unknown';
  const now = Date.now(), windowMs = 60000, max = 12;
  const arr = (authHits.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now);
  authHits.set(ip, arr);
  if (authHits.size > 5000) authHits.clear(); // garde-fou memoire
  if (arr.length > max) return res.status(429).json({ error: 'Trop de tentatives. Reessaie dans une minute.' });
  next();
}

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
  const secure = usingTurso ? ' Secure;' : ''; // HTTPS en prod (Render) ; pas en local http
  res.setHeader('Set-Cookie',
    `sid=${token}; HttpOnly;${secure} Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
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

// Depense atomique d'essence : echoue (renvoie false) si solde insuffisant.
// Empeche l'essence negative meme avec des requetes simultanees (anti race-condition).
async function spend(userId, amount) {
  const r = await run(
    'UPDATE users SET essence = essence - ? WHERE id = ? AND essence >= ?',
    [amount, userId, amount]);
  return (r.rowsAffected ?? r.changes ?? 0) > 0;
}

// ---------- Auth ----------
// Pseudo affiche chez les AUTRES joueurs (classement, marche, amis, PvP) -> on whiteliste les
// caracteres pour fermer le XSS stocke a la source (defense serveur, en plus de l'echappement client).
const USERNAME_RE = /^[\p{L}\p{N} _.\-]{3,20}$/u;
// Nettoie un texte libre (surnom) : retire les caracteres dangereux pour du HTML (garde espaces/tirets).
// L'echappement client reste la 2e ligne de defense.
function cleanFreeText(s, max = 20) {
  return String(s || '').replace(/[<>&"'`]/g, '').slice(0, max).trim();
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
app.post('/api/register', authThrottle, h(async (req, res) => {
  const { password, starter } = req.body || {};
  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim().slice(0, 120);
  if (!username || !password || username.length < 3 || username.length > 20 || password.length < 4 || password.length > 100) {
    return res.status(400).json({ error: 'Pseudo (3-20 caracteres) et mot de passe (4-100) requis.' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Pseudo : lettres, chiffres, espace, tiret, point et _ uniquement.' });
  }
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }
  if (!STARTER_IDS.includes(starter)) {
    return res.status(400).json({ error: 'Choisis ton Glump de depart.' });
  }
  const exists = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) return res.status(409).json({ error: 'Ce pseudo est deja pris.' });

  const { hash, salt } = await hashPassword(password);
  // Code de recuperation (montre une fois au joueur) : seul son hash est stocke.
  const recoveryCode = genRecoveryCode();
  const rec = await hashPassword(canonRecovery(recoveryCode));
  const now = Date.now();
  const userId = await insert(
    'INSERT INTO users (username, email, pass_hash, pass_salt, recovery_hash, recovery_salt, essence, incubator_slots, friend_code, last_tick, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [username, email || null, hash, salt, rec.hash, rec.salt, BALANCE.startEssence, BALANCE.startSlots, genFriendCode(), now, now]);

  // Le joueur commence avec le starter choisi (adulte), place dans la Plaine pour farmer.
  await insertCreature(userId, wildCreature(starter, { adult: true }));
  await run("UPDATE creatures SET in_prairie = 1, biome = 'plaine' WHERE owner_id = ?", [userId]);
  // Pack de depart : 2 oeufs bonus (especes de base aleatoires) deja en incubation -> de quoi
  // jouer et progresser des la 1re minute (l'onboarding etait trop maigre avec 1 seul Glump).
  for (let i = 0; i < 2; i++) {
    const sp = randomBase();
    await insertCreature(userId, { ...wildCreature(sp, { adult: false }), stage: 'egg' },
      { hatch_at: now + incubationSeconds(sp) * 1000, from_breeding: 0 });
  }

  const token = await createSession(userId);
  setCookie(res, token);
  res.json({ ok: true, recoveryCode }); // le client le montre UNE fois
}));

app.post('/api/login', authThrottle, h(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await get('SELECT * FROM users WHERE username = ?', [username || '']);
  if (!user || !(await verifyPassword(password || '', user.pass_salt, user.pass_hash))) {
    return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });
  }
  const token = await createSession(user.id);
  setCookie(res, token);
  res.json({ ok: true });
}));

// Reinitialiser le mot de passe avec le CODE DE RECUPERATION (aucun email serveur necessaire).
app.post('/api/reset-password', authThrottle, h(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const { recoveryCode, newPassword } = req.body || {};
  if (!username || !recoveryCode || !newPassword || newPassword.length < 4 || newPassword.length > 100) {
    return res.status(400).json({ error: 'Pseudo, code de recuperation et nouveau mot de passe (4-100) requis.' });
  }
  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  // Reponse generique : ne pas reveler si le compte existe.
  if (!user || !user.recovery_hash || !(await verifyPassword(canonRecovery(recoveryCode), user.recovery_salt, user.recovery_hash))) {
    return res.status(401).json({ error: 'Pseudo ou code de recuperation incorrect.' });
  }
  const { hash, salt } = await hashPassword(newPassword);
  // Nouveau code (l'ancien ne marche plus) + deconnexion de toutes les sessions.
  const newCode = genRecoveryCode();
  const rec = await hashPassword(canonRecovery(newCode));
  await run('UPDATE users SET pass_hash = ?, pass_salt = ?, recovery_hash = ?, recovery_salt = ? WHERE id = ?',
    [hash, salt, rec.hash, rec.salt, user.id]);
  await run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
  res.json({ ok: true, recoveryCode: newCode });
}));

// Changer son mot de passe (connecte) : exige le mot de passe actuel.
app.post('/api/change-password', requireAuth, h(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4 || newPassword.length > 100) {
    return res.status(400).json({ error: 'Nouveau mot de passe (4-100) requis.' });
  }
  const user = await get('SELECT pass_hash, pass_salt FROM users WHERE id = ?', [req.user.id]);
  if (!(await verifyPassword(oldPassword || '', user.pass_salt, user.pass_hash))) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
  }
  const { hash, salt } = await hashPassword(newPassword);
  await run('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?', [hash, salt, req.user.id]);
  res.json({ ok: true });
}));

// (Re)generer un code de recuperation (connecte). Sert aux comptes existants (sans code) et a en
// obtenir un neuf. On ne renvoie le code qu'ici, une fois.
app.post('/api/recovery/regenerate', requireAuth, h(async (req, res) => {
  const code = genRecoveryCode();
  const rec = await hashPassword(canonRecovery(code));
  await run('UPDATE users SET recovery_hash = ?, recovery_salt = ? WHERE id = ?', [rec.hash, rec.salt, req.user.id]);
  res.json({ ok: true, recoveryCode: code });
}));

// Choisir son TITRE (cosmetique) parmi ceux debloques.
app.post('/api/account/title', requireAuth, h(async (req, res) => {
  const { title } = req.body || {};
  const achSet = parseAchSet(req.user);
  const avail = availableTitles(achSet).map(t => t.id);
  if (title && !avail.includes(title)) return res.status(400).json({ error: 'Titre non debloque.' });
  await run('UPDATE users SET title = ? WHERE id = ?', [title || null, req.user.id]);
  res.json({ ok: true });
}));

// Definir/mettre a jour son email (connecte, optionnel).
app.post('/api/account/email', requireAuth, h(async (req, res) => {
  const email = String(req.body?.email || '').trim().slice(0, 120);
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse email invalide.' });
  await run('UPDATE users SET email = ? WHERE id = ?', [email || null, req.user.id]);
  res.json({ ok: true });
}));

// RGPD — portabilite : telecharger toutes ses donnees (JSON).
app.get('/api/account/export', requireAuth, h(async (req, res) => {
  const uid = req.user.id;
  const u = await get('SELECT id, username, email, essence, pvp_trophies, login_streak, created_at, guild_id, title FROM users WHERE id = ?', [uid]);
  const creatures = await all('SELECT * FROM creatures WHERE owner_id = ?', [uid]);
  const discoveries = await all('SELECT species, variant FROM discoveries WHERE user_id = ?', [uid]);
  const friends = await all('SELECT friend_id FROM friends WHERE user_id = ?', [uid]);
  res.json({ exportedAt: Date.now(), account: u, creatures, discoveries, friends });
}));

// RGPD — droit a l'effacement : supprime le compte et TOUTES ses donnees (exige le mot de passe).
app.post('/api/account/delete', requireAuth, h(async (req, res) => {
  const { password } = req.body || {};
  const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user || !(await verifyPassword(password || '', user.pass_salt, user.pass_hash))) {
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  const uid = req.user.id;
  // Guilde : si chef, transferer au plus ancien membre restant, sinon dissoudre.
  if (user.guild_id) {
    const g = await get('SELECT leader_id FROM guilds WHERE id = ?', [user.guild_id]);
    if (g && g.leader_id === uid) {
      const next = await get('SELECT id FROM users WHERE guild_id = ? AND id != ? ORDER BY id LIMIT 1', [user.guild_id, uid]);
      if (next) await run('UPDATE guilds SET leader_id = ? WHERE id = ?', [next.id, user.guild_id]);
      else { await run('DELETE FROM guilds WHERE id = ?', [user.guild_id]); await run('DELETE FROM guild_messages WHERE guild_id = ?', [user.guild_id]); }
    }
  }
  // Effacement explicite (les FK cascade ne sont pas garanties actives).
  for (const sql of [
    'DELETE FROM creatures WHERE owner_id = ?',
    'DELETE FROM discoveries WHERE user_id = ?',
    'DELETE FROM listings WHERE seller_id = ?',
    'DELETE FROM friends WHERE user_id = ? OR friend_id = ?',
    'DELETE FROM trades WHERE from_user = ? OR to_user = ?',
    'DELETE FROM guild_messages WHERE user_id = ?',
    'DELETE FROM guild_msg_reports WHERE user_id = ?',
    'DELETE FROM sessions WHERE user_id = ?',
  ]) {
    const args = sql.includes('OR') ? [uid, uid] : [uid];
    try { await run(sql, args); } catch {}
  }
  await run('DELETE FROM users WHERE id = ?', [uid]);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
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
  if (a.listed === 1 || b.listed === 1) return res.status(400).json({ error: 'Un de ces Glumps est en vente (Hotel des Ventes).' });
  // Un parent deja en accouplement est occupe.
  const busy = await get(
    "SELECT 1 AS x FROM creatures WHERE owner_id = ? AND from_breeding = 1 AND stage = 'mating' AND (parent_a IN (?, ?) OR parent_b IN (?, ?)) LIMIT 1",
    [req.user.id, a.id, b.id, a.id, b.id]);
  if (busy) return res.status(400).json({ error: 'Un de ces Glumps est deja en accouplement.' });
  // Section critique sous VERROU : re-verifie occupation des parents + cellule libre,
  // puis cree l'oeuf -> empeche deux /breed concurrents de depasser la limite de cellules
  // ou d'utiliser le meme parent deux fois.
  const out = await withLock(req.user.id, async () => {
    const stillBusy = await get(
      "SELECT 1 AS x FROM creatures WHERE owner_id = ? AND from_breeding = 1 AND stage = 'mating' AND (parent_a IN (?, ?) OR parent_b IN (?, ?)) LIMIT 1",
      [req.user.id, a.id, b.id, a.id, b.id]);
    if (stillBusy) return { status: 400, error: 'Un de ces Glumps est deja en accouplement.' };
    // La cellule n'est occupee que pendant l'ACCOUPLEMENT. Une fois l'oeuf pondu, il part
    // en eclosion (section incubateurs) et libere la cellule -> on peut relancer une repro.
    const cellRow = await get(
      "SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND from_breeding = 1 AND stage = 'mating'", [req.user.id]);
    const user = await reloadUser(req.user.id);
    if (cellRow.n >= user.breeding_cells) return { status: 400, error: 'Toutes tes cellules de reproduction sont occupees.' };
    const child = breed(a, b, { pityBonus: shinyPityBonus(user.shiny_pity) }); // forme de BASE
    const readyAt = Date.now() + reproductionSeconds(child.species) * 1000;
    const id = await insertCreature(req.user.id, { ...child, stage: 'mating' }, { hatch_at: readyAt, from_breeding: 1, parent_a: a.id, parent_b: b.id });
    await run("UPDATE creatures SET biome = NULL, in_prairie = 0 WHERE id IN (?, ?)", [a.id, b.id]);
    await run('UPDATE users SET shiny_pity = ? WHERE id = ?', [child.variant === 1 ? 0 : (user.shiny_pity || 0) + 1, req.user.id]);
    return { ok: true, id, variant: child.variant };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  // Hors verrou (progressDaily prend lui-meme le verrou).
  await progressDaily(req.user.id, 'breed1', 1);
  const newAch = [];
  if (out.variant === 1) { const a2 = await unlockAch(req.user.id, 'shiny'); if (a2) newAch.push(a2); }
  const bred = (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND from_breeding = 1", [req.user.id])).n;
  if (bred >= 10) { const a3 = await unlockAch(req.user.id, 'breeder'); if (a3) newAch.push(a3); }
  const row = await get('SELECT * FROM creatures WHERE id = ?', [out.id]);
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
  if (c.stage === 'egg' || c.stage === 'mating') return res.status(400).json({ error: 'On ne relache pas un oeuf / accouplement en cours.' });
  if (c.favorite === 1) return res.status(400).json({ error: 'Ce Glump est en favori (verrouille). Retire le coeur d\'abord.' });
  if (c.listed === 1) return res.status(400).json({ error: 'Ce Glump est en vente (annule la vente d\'abord).' });
  if (exploringIds(await reloadUser(req.user.id)).has(Number(id))) return res.status(400).json({ error: 'Ce Glump est en exploration (occupe).' });

  const refund = Math.round(creatureValue(c) * 0.5);
  // Le DELETE conditionnel est le verrou atomique : seule la requete qui supprime
  // reellement la ligne rembourse -> pas de double-credit meme en concurrence (Turso).
  const del = await run('DELETE FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if ((del.rowsAffected ?? del.changes ?? 0) === 0) return res.status(404).json({ error: 'Glump deja relache.' });
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

  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    // Compte des incubateurs occupes DANS le verrou (sinon deux achats concurrents depassent la limite).
    const eggCount = (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND stage = 'egg' AND from_breeding = 0", [req.user.id])).n;
    if (eggCount >= user.incubator_slots) return { status: 400, error: 'Tous tes incubateurs sont occupes.' };
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
    const row = await get('SELECT * FROM creatures WHERE id = ?', [eggId]);
    return { ok: true, egg: publicCreature(row), ...payInfo, newAch };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  await progressDaily(req.user.id, 'buyegg2', 1); // HORS du verrou (progressDaily prend lui-meme le verrou)
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
  if (c.listed === 1) return res.status(400).json({ error: 'Ce Glump est en vente (occupe).' });
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

// Assigner PLUSIEURS Glumps au farm d'un coup (selection multiple), dans la limite des emplacements.
app.post('/api/biome/assign-many', requireAuth, h(async (req, res) => {
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Aucun Glump.' });
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    const active = user.active_biome || 'plaine';
    let used = (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND biome IS NOT NULL", [req.user.id])).n;
    const mating = new Set((await all("SELECT parent_a, parent_b FROM creatures WHERE owner_id = ? AND stage = 'mating'", [req.user.id])).flatMap(m => [m.parent_a, m.parent_b]));
    const exploring = exploringIds(user);
    let assigned = 0;
    for (const id of ids) {
      if (used >= user.prairie_slots) break;
      const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
      if (!c || c.stage !== 'adult' || c.biome || c.listed === 1 || mating.has(id) || exploring.has(id)) continue;
      await run("UPDATE creatures SET biome = ?, in_prairie = 1 WHERE id = ? AND biome IS NULL", [active, id]);
      used++; assigned++;
    }
    return { ok: true, assigned, full: used >= user.prairie_slots };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
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
  if (c.listed === 1) return res.status(400).json({ error: 'Ce Glump est en vente (occupe).' });
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

// ---------- Montee de niveau directe : +1 / +5 / +10 niveaux, payee en essence ----------
const ESSENCE_PER_XP = BALANCE.candyCost / BALANCE.candyXp; // meme taux que le bonbon (0.5)
const MAX_LEVEL = 100;
app.post('/api/creature/levelup', requireAuth, h(async (req, res) => {
  const { id, levels } = req.body || {};
  const n = [1, 5, 10].includes(Number(levels)) ? Number(levels) : 1;
  const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  if (c.stage === 'egg') return res.status(400).json({ error: 'Un oeuf ne peut pas monter de niveau.' });
  const cur = levelFromXp(c.xp || 0);
  if (cur >= MAX_LEVEL) return res.status(400).json({ error: 'Niveau maximum (100) atteint.' });
  const target = Math.min(MAX_LEVEL, cur + n);
  const xpNeeded = xpForLevel(target) - (c.xp || 0);
  const cost = Math.max(1, Math.ceil(xpNeeded * ESSENCE_PER_XP));
  if (!(await spend(req.user.id, cost))) return res.status(400).json({ error: `Pas assez d'essence (besoin de ${cost}).` });
  await run('UPDATE creatures SET xp = ? WHERE id = ?', [xpForLevel(target), id]);
  await progressDaily(req.user.id, 'candy3', 1); // la quete "monter de niveau" reutilise cet id
  const row = await get('SELECT * FROM creatures WHERE id = ?', [id]);
  const newAch = [];
  if (target >= 50) { const a = await unlockAch(req.user.id, 'level50'); if (a) newAch.push(a); }
  res.json({ ok: true, creature: publicCreature(row), cost, gained: target - cur, level: target, newAch });
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
  const resCost = evolveResourceCost(target); // ressource du biome (stade 3 uniquement), sinon null
  // Sous verrou : essence (atomique via spend) + ressource (JSON, relecture fraiche) ensemble.
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    let res2;
    if (resCost) {
      res2 = parseResources(user);
      if ((res2[resCost.resource] || 0) < resCost.amount) {
        return { status: 400, error: `Pas assez de ${resCost.resName} ${resCost.resEmoji} (besoin de ${resCost.amount}). Active le biome correspondant et farme/explore.` };
      }
    }
    if (!(await spend(req.user.id, cost))) {
      return { status: 400, error: `Pas assez d'essence pour evoluer (besoin de ${cost}).` };
    }
    if (resCost) {
      res2[resCost.resource] -= resCost.amount;
      await run('UPDATE users SET resources_json = ? WHERE id = ?', [JSON.stringify(res2), req.user.id]);
    }
    // UPDATE conditionnel sur owner (anti-action sur le Glump d'autrui) + adulte non evolue.
    await run('UPDATE creatures SET species = ? WHERE id = ? AND owner_id = ?', [target, id, req.user.id]);
    return { ok: true };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  await progressDaily(req.user.id, 'evolve1', 1);
  const newAch = []; { const a = await unlockAch(req.user.id, 'first_evolve'); if (a) newAch.push(a); }
  const row = await get('SELECT * FROM creatures WHERE id = ?', [id]);
  res.json({ ok: true, creature: publicCreature(row), fromName: SPECIES[c.species].name, cost, resCost: resCost || null, newAch });
}));

// ---------- Renommer ----------
app.post('/api/creature/rename', requireAuth, h(async (req, res) => {
  const { id, nickname } = req.body || {};
  const name = cleanFreeText(nickname, 20);
  const c = await get('SELECT id FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable.' });
  await run('UPDATE creatures SET nickname = ? WHERE id = ?', [name || null, id]);
  res.json({ ok: true });
}));

// ---------- Classement (multijoueur) — calcule puis cache 30s ----------
let lbCache = { at: 0, board: [] };
async function computeLeaderboard() {
  // 1 seule requete (agregee en JS car la valeur depend des genes/niveau, non calculable en SQL).
  // On ne SELECT que les colonnes utiles a creatureValue -> moins de donnees transferees a l'echelle.
  const rows = await all(
    "SELECT u.id AS uid, u.username AS username, u.title AS title, " +
    "c.species, c.gene_force, c.gene_vita, c.gene_speed, c.xp, c.variant FROM users u " +
    "LEFT JOIN creatures c ON c.owner_id = u.id AND c.stage NOT IN ('egg', 'mating')");
  const byUser = new Map();
  for (const r of rows) {
    let e = byUser.get(r.uid);
    if (!e) { e = { id: r.uid, username: r.username, title: titleNameById(r.title), collection: 0, best: 0, count: 0 }; byUser.set(r.uid, e); }
    if (r.species) { // a une creature
      const v = creatureValue(r);
      e.collection += v; e.count += 1; if (v > e.best) e.best = v;
    }
  }
  return [...byUser.values()].sort((a, b) => b.collection - a.collection).slice(0, 50);
}
// Le classement scanne TOUTES les creatures (cout en O(total)). Il n'a pas besoin d'etre temps reel :
// cache 5 min -> le scan coûteux ne tourne qu'une fois par 5 min quel que soit le nombre de joueurs.
const LB_CACHE_MS = 5 * 60 * 1000;
app.get('/api/leaderboard', h(async (req, res) => {
  const now = Date.now();
  if (now - lbCache.at > LB_CACHE_MS) lbCache = { at: now, board: await computeLeaderboard() };
  res.json({ board: lbCache.board });
}));

// ---------- Visiter l'elevage d'un autre joueur ----------
app.get('/api/farm/:userId', h(async (req, res) => {
  const u = await get('SELECT id, username FROM users WHERE id = ?', [Number(req.params.userId)]);
  if (!u) return res.status(404).json({ error: 'Joueur introuvable.' });
  const rows = await all(
    "SELECT * FROM creatures WHERE owner_id = ? AND stage NOT IN ('egg', 'mating') ORDER BY created_at ASC", [u.id]);
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
  const me = await reloadUser(req.user.id);
  const myTr = me.pvp_trophies ?? 1000;
  const candidates = await all(
    "SELECT DISTINCT u.id, u.username, u.pvp_trophies FROM users u JOIN creatures c ON c.owner_id = u.id AND c.stage = 'adult' WHERE u.id != ?",
    [req.user.id]);
  if (!candidates.length) return res.status(404).json({ error: 'Aucun adversaire disponible (invite des amis !).' });
  // Matchmaking par bande de trophees (evite debutant vs equipe legendaire). On elargit si vide.
  const within = (d) => candidates.filter(c => Math.abs((c.pvp_trophies ?? 1000) - myTr) <= d);
  const pool = within(200).length ? within(200) : within(500).length ? within(500) : candidates;
  const opp = pool[Math.floor(Math.random() * pool.length)];
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
  if (Number(opponentId) === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas te battre contre toi-meme.' });
  // Un seul combat actif par joueur : sinon on lance N combats en parallele contre le meme
  // adversaire (snapshot fige) et on encaisse N fois la recompense -> farm d'essence illimite.
  // On ABANDONNE (sans recompense) un eventuel combat en cours plutot que de bloquer : pas de
  // lockout 15min si l'onglet a ete ferme, et l'exploit reste ferme (jamais 2 combats en vol).
  for (const [bid, bb] of battles) {
    if (bb.userId === req.user.id && !bb.state.over) {
      battles.delete(bid);
      // Anti-fuite : abandonner un combat ENGAGE (>=1 tour joue) coute des trophees (= une defaite).
      if (bb.state.turn > 0 && !bb.settled) {
        await run('UPDATE users SET pvp_trophies = MAX(0, pvp_trophies - ?) WHERE id = ?', [BALANCE.pvpLoseTrophies, req.user.id]);
      }
    }
  }
  // Dedup + normalisation des ids : sinon [5,5,5] engage 3 fois le meme Glump (triche).
  const teamIds = [...new Set((Array.isArray(team) ? team : []).map(Number).filter(Number.isInteger))];
  if (teamIds.length < 1 || teamIds.length > BALANCE.pvpTeamSize) {
    return res.status(400).json({ error: `Choisis 1 a ${BALANCE.pvpTeamSize} Glumps differents.` });
  }
  const exploring = exploringIds(await reloadUser(req.user.id));
  const matingSet = new Set((await all("SELECT parent_a, parent_b FROM creatures WHERE owner_id = ? AND stage = 'mating'", [req.user.id])).flatMap(m => [m.parent_a, m.parent_b]));
  const mine = [];
  for (const id of teamIds) {
    const c = await get("SELECT * FROM creatures WHERE id = ? AND owner_id = ? AND stage = 'adult'", [id, req.user.id]);
    if (!c) return res.status(400).json({ error: 'Equipe invalide (adultes uniquement).' });
    if (c.listed === 1) return res.status(400).json({ error: 'Un de tes Glumps est en vente.' });
    if (publicCreature(c).fainted) return res.status(400).json({ error: 'Un de tes Glumps est KO — ranime-le (Rappel) avant de combattre.' });
    if (exploring.has(Number(id))) return res.status(400).json({ error: 'Un de tes Glumps est en exploration (occupe).' });
    if (matingSet.has(Number(id))) return res.status(400).json({ error: 'Un de tes Glumps est en accouplement (occupe).' });
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
    // Verrou synchrone (avant tout await) : empeche deux coups finaux concurrents de crediter 2x la recompense.
    if (b.settled) return res.status(400).json({ error: 'Combat deja termine.' });
    b.settled = true;
    const iWon = b.state.winner === 'a';
    const xp = iWon ? 60 : 20;
    // Ecriture RELATIVE atomique (jamais en absolu) : pas de lost-update sur les trophees.
    const trophyDelta = iWon ? BALANCE.pvpWinTrophies : -BALANCE.pvpLoseTrophies;
    const essence = iWon ? BALANCE.pvpWinEssence : 0;
    await run('UPDATE users SET pvp_trophies = MAX(0, pvp_trophies + ?), essence = essence + ? WHERE id = ?', [trophyDelta, essence, req.user.id]);
    // Suit le PIC de trophees de la saison (sert a la recompense de fin de saison).
    await run('UPDATE users SET pvp_peak = MAX(COALESCE(pvp_peak, 0), pvp_trophies) WHERE id = ?', [req.user.id]);
    const trophies = (await reloadUser(req.user.id)).pvp_trophies;
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
  const exploringRM = exploringIds(await reloadUser(req.user.id));
  let refund = 0, released = 0;
  for (const id of ids) {
    const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [id, req.user.id]);
    if (!c || c.stage === 'egg' || c.favorite === 1 || c.listed === 1 || exploringRM.has(Number(id))) continue;
    // DELETE conditionnel = verrou atomique : pas de remboursement si la ligne a deja ete supprimee ailleurs.
    const del = await run("DELETE FROM creatures WHERE id = ? AND owner_id = ? AND favorite = 0 AND stage NOT IN ('egg', 'mating')", [id, req.user.id]);
    if ((del.rowsAffected ?? del.changes ?? 0) === 0) continue;
    refund += Math.round(creatureValue(c) * 0.5);
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
  const claimedCount = dexClaimedCount(user); // seuil (COUNT) du dernier palier reclame
  const milestones = DEX_MILESTONES.map((m) => ({
    count: m.count, essence: m.essence, prairie: !!m.prairie, cell: !!m.cell, title: m.title || null,
    reached: discCount >= m.count, claimed: m.count <= claimedCount, claimable: discCount >= m.count && m.count > claimedCount,
  }));
  // Paliers du dex CHROMATIQUE (shiny).
  const shinyCount = (await get('SELECT COUNT(*) AS n FROM discoveries WHERE user_id = ? AND variant = 1', [req.user.id])).n;
  const shinyClaimed = user.shiny_dex_claimed || 0;
  const shinyMilestones = SHINY_DEX_MILESTONES.map((m) => ({
    count: m.count, essence: m.essence, prairie: !!m.prairie, cell: !!m.cell, title: m.title || null,
    reached: shinyCount >= m.count, claimed: m.count <= shinyClaimed, claimable: shinyCount >= m.count && m.count > shinyClaimed,
  }));
  // Paliers de TROPHEES PvP.
  const trophies = user.pvp_trophies || 0;
  const pvpClaimed = user.pvp_claimed || 0;
  const pvpMilestones = PVP_MILESTONES.map((m) => ({
    trophies: m.trophies, essence: m.essence, cell: !!m.cell, prairie: !!m.prairie, title: m.title || null,
    reached: trophies >= m.trophies, claimed: m.trophies <= pvpClaimed, claimable: trophies >= m.trophies && m.trophies > pvpClaimed,
  }));
  const streak = user.login_streak || 0;
  const cal = BALANCE.loginCalendar;
  res.json({
    daily, achievements,
    dex: { discovered: discCount, total: SPECIES_COUNT, milestones },
    shinyDex: { discovered: shinyCount, milestones: shinyMilestones },
    pvp: { trophies, milestones: pvpMilestones },
    streak,
    calendar: {
      rewards: cal,
      day: streak > 0 ? ((streak - 1) % cal.length) + 1 : 0, // jour actuel dans le cycle (0 si jamais connecte)
      gotToday: user.last_login_day === todayStr(),          // bonus du jour deja recu ?
    },
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
    const claimedCount = dexClaimedCount(user); // count-based (robuste a l'ajout de paliers)
    const m = DEX_MILESTONES.find(x => x.count > claimedCount && discCount >= x.count);
    if (!m) {
      const next = DEX_MILESTONES.find(x => x.count > claimedCount);
      return { status: 400, error: next ? `Palier non atteint (${discCount}/${next.count}).` : 'Tous les paliers sont deja reclames.' };
    }
    let extra = '';
    if (m.prairie) { await run('UPDATE users SET prairie_slots = prairie_slots + 1 WHERE id = ?', [req.user.id]); extra = '+1 emplacement de prairie'; }
    if (m.cell) { await run('UPDATE users SET breeding_cells = breeding_cells + 1 WHERE id = ?', [req.user.id]); extra = '+1 cellule de reproduction'; }
    await run('UPDATE users SET dex_claimed = ?, essence = essence + ? WHERE id = ?', [m.count, m.essence, req.user.id]);
    if (m.count >= SPECIES_COUNT) await unlockAch(req.user.id, 'dexmaster');
    return { ok: true, essence: m.essence, extra, title: m.title || null };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

// Reclamer un palier du Dex CHROMATIQUE (shiny) — dans l'ordre, verrouille.
app.post('/api/shiny-dex/claim', requireAuth, h(async (req, res) => {
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    const shinyCount = (await get('SELECT COUNT(*) AS n FROM discoveries WHERE user_id = ? AND variant = 1', [req.user.id])).n;
    const claimed = user.shiny_dex_claimed || 0;
    const m = SHINY_DEX_MILESTONES.find(x => x.count > claimed && shinyCount >= x.count);
    if (!m) {
      const next = SHINY_DEX_MILESTONES.find(x => x.count > claimed);
      return { status: 400, error: next ? `Palier chromatique non atteint (${shinyCount}/${next.count}).` : 'Tous les paliers chromatiques sont reclames.' };
    }
    let extra = '';
    if (m.prairie) { await run('UPDATE users SET prairie_slots = prairie_slots + 1 WHERE id = ?', [req.user.id]); extra = '+1 emplacement de farm'; }
    if (m.cell) { await run('UPDATE users SET breeding_cells = breeding_cells + 1 WHERE id = ?', [req.user.id]); extra = '+1 cellule de reproduction'; }
    await run('UPDATE users SET shiny_dex_claimed = ?, essence = essence + ? WHERE id = ?', [m.count, m.essence, req.user.id]);
    return { ok: true, essence: m.essence, extra, title: m.title || null };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

// Reclamer un palier de TROPHEES PvP — reclamable une fois le seuil ATTEINT, reste acquis.
app.post('/api/pvp/claim', requireAuth, h(async (req, res) => {
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    const trophies = user.pvp_trophies || 0;
    const claimed = user.pvp_claimed || 0;
    const m = PVP_MILESTONES.find(x => x.trophies > claimed && trophies >= x.trophies);
    if (!m) {
      const next = PVP_MILESTONES.find(x => x.trophies > claimed);
      return { status: 400, error: next ? `Palier non atteint (${trophies}/${next.trophies} 🏆).` : 'Tous les paliers de trophees sont reclames.' };
    }
    let extra = '';
    if (m.prairie) { await run('UPDATE users SET prairie_slots = prairie_slots + 1 WHERE id = ?', [req.user.id]); extra = '+1 emplacement de farm'; }
    if (m.cell) { await run('UPDATE users SET breeding_cells = breeding_cells + 1 WHERE id = ?', [req.user.id]); extra = '+1 cellule de reproduction'; }
    await run('UPDATE users SET pvp_claimed = ?, essence = essence + ? WHERE id = ?', [m.trophies, m.essence, req.user.id]);
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
  if (!Number.isInteger(tid)) return res.status(400).json({ error: 'Destinataire invalide.' });
  if (tid === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas echanger avec toi-meme.' });
  if (!(await areFriends(req.user.id, tid))) return res.status(400).json({ error: 'Tu dois etre ami avec ce joueur.' });
  const c = await get("SELECT * FROM creatures WHERE id = ? AND owner_id = ? AND stage NOT IN ('egg', 'mating')", [creatureId, req.user.id]);
  if (!c) return res.status(404).json({ error: 'Glump introuvable (ou oeuf).' });
  if (c.favorite === 1) return res.status(400).json({ error: 'Retire le favori avant d\'echanger ce Glump.' });
  if (c.listed === 1) return res.status(400).json({ error: 'Ce Glump est en vente (Hotel des Ventes).' });
  if (exploringIds(await reloadUser(req.user.id)).has(Number(creatureId))) return res.status(400).json({ error: 'Ce Glump est en exploration (occupe).' });
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
  const out = await withLock(req.user.id, async () => {
    const t = await get("SELECT * FROM trades WHERE id = ? AND to_user = ? AND status = 'pending'", [id, req.user.id]);
    if (!t) return { status: 404, error: 'Echange introuvable.' };
    const theirs = await get("SELECT * FROM creatures WHERE id = ? AND owner_id = ? AND stage NOT IN ('egg', 'mating')", [t.from_creature, t.from_user]);
    const mine = await get("SELECT * FROM creatures WHERE id = ? AND owner_id = ? AND stage NOT IN ('egg', 'mating')", [creatureId, req.user.id]);
    if (!theirs || !mine) { await run("UPDATE trades SET status = 'cancelled' WHERE id = ?", [id]); return { status: 400, error: 'Un des Glumps n\'est plus disponible.' }; }
    if (mine.favorite === 1) return { status: 400, error: 'Retire le favori avant d\'echanger ce Glump.' };
    if (theirs.favorite === 1) { await run("UPDATE trades SET status = 'cancelled' WHERE id = ?", [id]); return { status: 400, error: 'L\'autre joueur a verrouille ce Glump (favori). Echange annule.' }; }
    // Un Glump occupe (exploration) ne peut pas etre echange.
    if (exploringIds(await reloadUser(req.user.id)).has(Number(mine.id))) return { status: 400, error: 'Ton Glump est en exploration (occupe).' };
    if (exploringIds(await reloadUser(t.from_user)).has(Number(theirs.id))) { await run("UPDATE trades SET status = 'cancelled' WHERE id = ?", [id]); return { status: 400, error: 'Le Glump propose est devenu indisponible. Echange annule.' }; }
    // Echange des proprietaires via UPDATE conditionnels (anti-dupe en concurrence sur Turso) :
    // chaque transfert n'aboutit que si le Glump appartient encore a son proprietaire d'origine.
    const tk = await run('UPDATE creatures SET owner_id = ?, in_prairie = 0, biome = NULL WHERE id = ? AND owner_id = ?', [req.user.id, theirs.id, t.from_user]);
    if ((tk.rowsAffected ?? tk.changes ?? 0) === 0) { await run("UPDATE trades SET status = 'cancelled' WHERE id = ?", [id]); return { status: 400, error: 'Le Glump propose n\'est plus disponible. Echange annule.' }; }
    const mk = await run('UPDATE creatures SET owner_id = ?, in_prairie = 0, biome = NULL WHERE id = ? AND owner_id = ?', [t.from_user, mine.id, req.user.id]);
    if ((mk.rowsAffected ?? mk.changes ?? 0) === 0) { await run('UPDATE creatures SET owner_id = ? WHERE id = ?', [t.from_user, theirs.id]); return { status: 400, error: 'Ton Glump n\'est plus disponible.' }; }
    await run("UPDATE trades SET status = 'done' WHERE id = ?", [id]);
    return { ok: true, received: publicCreature(await get('SELECT * FROM creatures WHERE id = ?', [theirs.id])) };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));
// Refuser (destinataire) ou annuler (emetteur) un echange en attente.
app.post('/api/trade/cancel', requireAuth, h(async (req, res) => {
  const { id } = req.body || {};
  await run("UPDATE trades SET status = 'cancelled' WHERE id = ? AND (to_user = ? OR from_user = ?) AND status = 'pending'",
    [id, req.user.id, req.user.id]);
  res.json({ ok: true });
}));

// ---------- Hotel des Ventes (marche entre joueurs, paye en essence) ----------
const MARKET_TAX = 0.05;            // 5% brules a chaque vente (le puits d'essence)
const MARKET_MAX_PRICE = 50_000_000;

// Mettre un Glump en vente.
app.post('/api/market/list', requireAuth, h(async (req, res) => {
  const { creatureId, price } = req.body || {};
  const p = Math.floor(Number(price));
  if (!Number.isInteger(p) || p < 1 || p > MARKET_MAX_PRICE) return res.status(400).json({ error: `Prix invalide (1 a ${MARKET_MAX_PRICE.toLocaleString('fr-FR')} ✨).` });
  const out = await withLock(req.user.id, async () => {
    const c = await get('SELECT * FROM creatures WHERE id = ? AND owner_id = ?', [creatureId, req.user.id]);
    if (!c) return { status: 404, error: 'Glump introuvable.' };
    if (c.stage === 'egg' || c.stage === 'mating') return { status: 400, error: 'Pas vendable (oeuf ou accouplement en cours).' };
    if (c.favorite === 1) return { status: 400, error: 'Retire le favori avant de vendre.' };
    if (c.listed === 1) return { status: 400, error: 'Ce Glump est deja en vente.' };
    if (exploringIds(await reloadUser(req.user.id)).has(Number(creatureId))) return { status: 400, error: 'Ce Glump est en exploration.' };
    const mating = await get("SELECT 1 x FROM creatures WHERE owner_id=? AND stage='mating' AND (parent_a=? OR parent_b=?) LIMIT 1", [req.user.id, creatureId, creatureId]);
    if (mating) return { status: 400, error: 'Ce Glump est en accouplement.' };
    await run('UPDATE creatures SET listed = 1, biome = NULL, in_prairie = 0 WHERE id = ?', [creatureId]);
    await run('INSERT INTO listings (seller_id, creature_id, price, status, created_at) VALUES (?, ?, ?, ?, ?)', [req.user.id, creatureId, p, 'active', Date.now()]);
    return { ok: true, price: p };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

// Annuler ma vente (le Glump redevient utilisable).
app.post('/api/market/cancel', requireAuth, h(async (req, res) => {
  const { listingId } = req.body || {};
  const out = await withLock(req.user.id, async () => {
    const l = await get("SELECT * FROM listings WHERE id = ? AND seller_id = ? AND status = 'active'", [listingId, req.user.id]);
    if (!l) return { status: 404, error: 'Annonce introuvable.' };
    await run("UPDATE listings SET status = 'cancelled' WHERE id = ?", [listingId]);
    await run('UPDATE creatures SET listed = 0 WHERE id = ? AND owner_id = ?', [l.creature_id, req.user.id]);
    return { ok: true };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

// Acheter une annonce (atomique : pas de dupe, pas de creation d'essence, taxe brulee).
app.post('/api/market/buy', requireAuth, h(async (req, res) => {
  const { listingId } = req.body || {};
  const out = await withLock(req.user.id, async () => {
    const l = await get("SELECT * FROM listings WHERE id = ? AND status = 'active'", [listingId]);
    if (!l) return { status: 404, error: 'Annonce introuvable ou deja vendue.' };
    if (l.seller_id === req.user.id) return { status: 400, error: 'Tu ne peux pas acheter ta propre annonce.' };
    // 1) debite l'acheteur (atomique : echoue si pas assez)
    if (!(await spend(req.user.id, l.price))) return { status: 400, error: `Pas assez d'essence (besoin de ${l.price.toLocaleString('fr-FR')} ✨).` };
    // 2) VERROU : marque l'annonce vendue de facon conditionnelle -> un seul acheteur gagne
    const sold = await run("UPDATE listings SET status='sold', buyer_id=?, sold_at=? WHERE id=? AND status='active'", [req.user.id, Date.now(), listingId]);
    if ((sold.rowsAffected ?? sold.changes ?? 0) === 0) {
      await run('UPDATE users SET essence = essence + ? WHERE id = ?', [l.price, req.user.id]); // rembourse
      return { status: 400, error: 'Trop tard, deja vendue.' };
    }
    // 3) transfert du Glump (conditionnel : appartient encore au vendeur et en vente)
    const tr = await run('UPDATE creatures SET owner_id=?, listed=0, biome=NULL, in_prairie=0, favorite=0 WHERE id=? AND owner_id=? AND listed=1', [req.user.id, l.creature_id, l.seller_id]);
    if ((tr.rowsAffected ?? tr.changes ?? 0) === 0) {
      await run('UPDATE users SET essence = essence + ? WHERE id = ?', [l.price, req.user.id]);
      await run("UPDATE listings SET status='cancelled' WHERE id=?", [listingId]);
      return { status: 400, error: 'Glump indisponible. Achat annule.' };
    }
    // 4) credite le vendeur (prix - taxe 5%) ; la taxe n'est creditee a personne = BRULEE
    const tax = Math.floor(l.price * MARKET_TAX);
    await run('UPDATE users SET essence = essence + ? WHERE id = ?', [l.price - tax, l.seller_id]);
    const row = await get('SELECT * FROM creatures WHERE id = ?', [l.creature_id]);
    return { ok: true, creature: publicCreature(row), price: l.price };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

// Parcourir le marche (annonces actives) + savoir lesquelles sont les miennes.
app.get('/api/market', requireAuth, h(async (req, res) => {
  const rows = await all(
    "SELECT l.id AS listing_id, l.price, l.seller_id, u.username AS seller, c.* " +
    "FROM listings l JOIN users u ON u.id = l.seller_id JOIN creatures c ON c.id = l.creature_id " +
    "WHERE l.status = 'active' ORDER BY l.created_at DESC LIMIT 200", []);
  const listings = rows.map(r => ({ id: r.listing_id, price: r.price, seller: r.seller, mine: r.seller_id === req.user.id, creature: publicCreature(r) }));
  res.json({ listings, taxPct: Math.round(MARKET_TAX * 100) });
}));

// ---------- Exploration : envoyer des Glumps explorer une zone ----------
app.post('/api/explore/start', requireAuth, h(async (req, res) => {
  const { biome, tier, team: chosen } = req.body || {};
  const zone = EXPLORE_ZONE_BY_ID[biome];
  const t = EXPLORE_TIER_BY_ID[tier];
  if (!zone || !t) return res.status(400).json({ error: 'Zone ou difficulte inconnue.' });
  if (!Array.isArray(chosen) || chosen.length !== t.count) {
    return res.status(400).json({ error: `Choisis exactement ${t.count} Glumps a envoyer.` });
  }
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    const exps = parseExpeditions(user);
    if (exps.some(e => e.biome === biome)) return { status: 400, error: 'Une exploration est deja en cours dans cette zone.' };
    const exploring = exploringIds(user);
    const mating = new Set((await all("SELECT parent_a, parent_b FROM creatures WHERE owner_id = ? AND stage = 'mating'", [req.user.id])).flatMap(m => [m.parent_a, m.parent_b]));
    // Valide chaque Glump CHOISI : a moi, adulte, bon type, niveau requis, dispo.
    const team = [];
    for (const id of chosen.map(Number)) {
      const c = await get("SELECT * FROM creatures WHERE id = ? AND owner_id = ? AND stage = 'adult'", [id, req.user.id]);
      if (!c) return { status: 400, error: 'Glump invalide.' };
      if (c.listed === 1) return { status: 400, error: 'Un de tes Glumps est en vente.' };
      if (!zone.types.includes(SPECIES[c.species]?.type)) return { status: 400, error: `Il faut des Glumps de type ${zone.typesLabel}.` };
      if (levelFromXp(c.xp || 0) < t.level) return { status: 400, error: `Niveau ${t.level}+ requis.` };
      if (exploring.has(id) || mating.has(id) || team.includes(id)) return { status: 400, error: 'Glump indisponible ou en double.' };
      team.push(id);
    }
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
    // Recompenses : ESSENCE (le materiau de biome se farme dans les biomes, plus en explo)
    //  + objets + oeufs typés (limites par les incubateurs libres).
    const essReward = Math.round(t.res * eventMul('explore')); // essence (x2 pendant l'event Expedition)
    const items = parseItems(user);
    const gotItems = {};
    for (let i = 0; i < t.items; i++) { const it = EXPLORE_ITEMS[Math.floor(Math.random() * EXPLORE_ITEMS.length)]; items[it]++; gotItems[it] = (gotItems[it] || 0) + 1; }
    // Oeufs typés (jusqu'a t.eggs, dans la limite des incubateurs libres).
    const eggsLaid = [];
    if (Math.random() < t.eggChance) {
      let free = user.incubator_slots - (await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND stage = 'egg' AND from_breeding = 0", [req.user.id])).n;
      let pity = user.shiny_pity || 0;
      for (let i = 0; i < t.eggs && free > 0; i++) {
        const eggType = zone.types[Math.floor(Math.random() * zone.types.length)]; // un type au hasard parmi ceux de la zone
        const species = randomBaseOfType(eggType);
        const child = wildCreature(species, { adult: false, pityBonus: shinyPityBonus(pity) });
        await insertCreature(req.user.id, { ...child, stage: 'egg' }, { hatch_at: Date.now() + incubationSeconds(species) * 1000, from_breeding: 0 });
        pity = child.variant === 1 ? 0 : pity + 1;
        eggsLaid.push(SPECIES[species]?.name || species);
        free--;
      }
      await run('UPDATE users SET shiny_pity = ? WHERE id = ?', [pity, req.user.id]);
    }
    const left = exps.filter(e => e.id !== id);
    // Essence en RELATIF (sous verrou) : ne pas effacer une depense concurrente.
    await run('UPDATE users SET expeditions_json = ?, items_json = ?, essence = essence + ? WHERE id = ?',
      [JSON.stringify(left), JSON.stringify(items), essReward, req.user.id]);
    return { ok: true, rewards: { essence: essReward, items: gotItems, eggs: eggsLaid, zoneName: zone.name, zoneEmoji: zone.emoji, tier: t.name } };
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

// ============================================================
//  GUILDES + chat (par polling)
// ============================================================
const GUILD_COST = 5000;   // cout de creation (essence)
const GUILD_MAX = 30;      // membres max
const GUILD_NAME_RE = /^[\p{L}\p{N} _.\-]{3,24}$/u;
const lastChat = new Map(); // userId -> ts (anti-spam chat)

app.post('/api/guild/create', requireAuth, h(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!GUILD_NAME_RE.test(name)) return res.status(400).json({ error: 'Nom : 3-24 caracteres (lettres, chiffres, espace, tiret).' });
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    if (user.guild_id) return { status: 400, error: 'Tu es deja dans une guilde.' };
    if (!(await spend(req.user.id, GUILD_COST))) return { status: 400, error: `Pas assez d'essence (besoin de ${GUILD_COST}).` };
    const gid = await insert('INSERT INTO guilds (name, leader_id, created_at) VALUES (?, ?, ?)', [name, req.user.id, Date.now()]);
    await run('UPDATE users SET guild_id = ?, guild_contrib = 0 WHERE id = ?', [gid, req.user.id]);
    return { ok: true, guildId: gid };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

app.post('/api/guild/join', requireAuth, h(async (req, res) => {
  const gid = Number(req.body?.guildId);
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    if (user.guild_id) return { status: 400, error: 'Tu es deja dans une guilde.' };
    const g = await get('SELECT id FROM guilds WHERE id = ?', [gid]);
    if (!g) return { status: 404, error: 'Guilde introuvable.' };
    const count = (await get('SELECT COUNT(*) AS n FROM users WHERE guild_id = ?', [gid])).n;
    if (count >= GUILD_MAX) return { status: 400, error: 'Cette guilde est pleine.' };
    await run('UPDATE users SET guild_id = ?, guild_contrib = 0 WHERE id = ?', [gid, req.user.id]);
    return { ok: true };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out);
}));

app.post('/api/guild/leave', requireAuth, h(async (req, res) => {
  const user = await reloadUser(req.user.id);
  if (!user.guild_id) return res.status(400).json({ error: "Tu n'es dans aucune guilde." });
  const gid = user.guild_id;
  await run('UPDATE users SET guild_id = NULL, guild_contrib = 0 WHERE id = ?', [req.user.id]);
  const g = await get('SELECT leader_id FROM guilds WHERE id = ?', [gid]);
  if (g && g.leader_id === req.user.id) {
    // Le chef part : on transfere au plus ancien membre restant, sinon on dissout.
    const next = await get('SELECT id FROM users WHERE guild_id = ? ORDER BY id LIMIT 1', [gid]);
    if (next) await run('UPDATE guilds SET leader_id = ? WHERE id = ?', [next.id, gid]);
    else { await run('DELETE FROM guilds WHERE id = ?', [gid]); await run('DELETE FROM guild_messages WHERE guild_id = ?', [gid]); }
  }
  res.json({ ok: true });
}));

app.get('/api/guild', requireAuth, h(async (req, res) => {
  const user = await reloadUser(req.user.id);
  if (!user.guild_id) return res.json({ guild: null });
  const g = await get('SELECT * FROM guilds WHERE id = ?', [user.guild_id]);
  if (!g) { await run('UPDATE users SET guild_id = NULL WHERE id = ?', [req.user.id]); return res.json({ guild: null }); }
  const members = await all('SELECT id, username, title, pvp_trophies, guild_contrib FROM users WHERE guild_id = ? ORDER BY guild_contrib DESC, pvp_trophies DESC', [user.guild_id]);
  res.json({ guild: {
    id: g.id, name: g.name, leaderId: g.leader_id,
    level: g.level || 1, pool: g.pool || 0, target: guildTarget(g.level || 1),
    farmBonus: Math.round((guildFarmBonus(g.level || 1) - 1) * 100), // % de bonus de farm partage
    members: members.map(m => ({ id: m.id, username: m.username, title: titleNameById(m.title),
      trophies: m.pvp_trophies, contrib: m.guild_contrib || 0, isLeader: m.id === g.leader_id })),
  } });
}));

// Contribuer de l'essence a la guilde -> remplit le pool ; au seuil, la guilde monte de niveau
// (bonus de farm permanent pour TOUS les membres).
app.post('/api/guild/contribute', requireAuth, h(async (req, res) => {
  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isInteger(amount) || amount < 100) return res.status(400).json({ error: 'Contribue au moins 100 ✨.' });
  const out = await withLock(req.user.id, async () => {
    const user = await reloadUser(req.user.id);
    if (!user.guild_id) return { status: 400, error: "Tu n'es dans aucune guilde." };
    if (!(await spend(req.user.id, amount))) return { status: 400, error: 'Pas assez d\'essence.' };
    await run('UPDATE users SET guild_contrib = guild_contrib + ? WHERE id = ?', [amount, req.user.id]);
    await run('UPDATE guilds SET pool = pool + ? WHERE id = ?', [amount, user.guild_id]);
    return { ok: true, gid: user.guild_id };
  });
  if (out.error) return res.status(out.status).json({ error: out.error });
  // Montee de niveau (hors verrou joueur ; UPDATE conditionnel atomique sur la guilde).
  let leveled = 0;
  for (let i = 0; i < 20; i++) {
    const g = await get('SELECT level, pool FROM guilds WHERE id = ?', [out.gid]);
    if (!g) break;
    const target = guildTarget(g.level);
    if (g.pool < target) break;
    const r = await run('UPDATE guilds SET level = level + 1, pool = pool - ? WHERE id = ? AND pool >= ?', [target, out.gid, target]);
    if (!(r.rowsAffected > 0)) break;
    leveled++;
  }
  const g2 = await get('SELECT level, pool FROM guilds WHERE id = ?', [out.gid]);
  res.json({ ok: true, leveled, level: g2?.level || 1, pool: g2?.pool || 0, target: guildTarget(g2?.level || 1) });
}));

app.get('/api/guild/list', requireAuth, h(async (req, res) => {
  const rows = await all('SELECT g.id, g.name, g.leader_id, COUNT(u.id) AS members FROM guilds g LEFT JOIN users u ON u.guild_id = g.id GROUP BY g.id ORDER BY members DESC LIMIT 50');
  res.json({ guilds: rows });
}));

app.get('/api/guild/chat', requireAuth, h(async (req, res) => {
  const user = await reloadUser(req.user.id);
  if (!user.guild_id) return res.json({ messages: [], isLeader: false });
  const g = await get('SELECT leader_id FROM guilds WHERE id = ?', [user.guild_id]);
  const isLeader = !!g && g.leader_id === req.user.id;
  // On masque les messages signales/supprimes (hidden = 1).
  const msgs = await all('SELECT id, user_id, username, text, created_at FROM guild_messages WHERE guild_id = ? AND hidden = 0 ORDER BY id DESC LIMIT 40', [user.guild_id]);
  res.json({ messages: msgs.reverse(), isLeader, myId: req.user.id });
}));

const lastMsgText = new Map(); // userId -> dernier texte (anti-flood doublon)
app.post('/api/guild/chat', requireAuth, h(async (req, res) => {
  const user = await reloadUser(req.user.id);
  if (!user.guild_id) return res.status(400).json({ error: "Tu n'es dans aucune guilde." });
  const text = cleanFreeText(req.body?.text, 200); // strip HTML + max 200
  if (!text) return res.status(400).json({ error: 'Message vide.' });
  // MODERATION : insultes / liens.
  const reject = chatReject(text);
  if (reject) return res.status(400).json({ error: reject });
  const now = Date.now();
  if (now - (lastChat.get(req.user.id) || 0) < 1500) return res.status(429).json({ error: 'Doucement !' });
  if (lastMsgText.get(req.user.id) === text) return res.status(429).json({ error: 'Evite de repeter le meme message.' });
  lastChat.set(req.user.id, now);
  lastMsgText.set(req.user.id, text);
  await run('INSERT INTO guild_messages (guild_id, user_id, username, text, created_at) VALUES (?, ?, ?, ?, ?)',
    [user.guild_id, req.user.id, user.username, text, now]);
  // Purge : garde ~100 derniers messages par guilde.
  await run('DELETE FROM guild_messages WHERE guild_id = ? AND id <= (SELECT MAX(id) - 100 FROM guild_messages WHERE guild_id = ?)', [user.guild_id, user.guild_id]);
  res.json({ ok: true });
}));

// Signaler un message : 3 signalements distincts -> masque automatiquement (moderation communautaire).
app.post('/api/guild/chat/report', requireAuth, h(async (req, res) => {
  const msgId = Number(req.body?.msgId);
  const user = await reloadUser(req.user.id);
  const m = await get('SELECT guild_id, user_id FROM guild_messages WHERE id = ?', [msgId]);
  if (!m || m.guild_id !== user.guild_id) return res.status(404).json({ error: 'Message introuvable.' });
  if (m.user_id === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas signaler ton propre message.' });
  await run('INSERT OR IGNORE INTO guild_msg_reports (msg_id, user_id) VALUES (?, ?)', [msgId, req.user.id]);
  const n = (await get('SELECT COUNT(*) AS n FROM guild_msg_reports WHERE msg_id = ?', [msgId])).n;
  if (n >= 3) await run('UPDATE guild_messages SET hidden = 1 WHERE id = ?', [msgId]);
  res.json({ ok: true, reports: n, hidden: n >= 3 });
}));

// Supprimer un message : son auteur OU le chef de guilde.
app.post('/api/guild/chat/delete', requireAuth, h(async (req, res) => {
  const msgId = Number(req.body?.msgId);
  const user = await reloadUser(req.user.id);
  const m = await get('SELECT guild_id, user_id FROM guild_messages WHERE id = ?', [msgId]);
  if (!m || m.guild_id !== user.guild_id) return res.status(404).json({ error: 'Message introuvable.' });
  const g = await get('SELECT leader_id FROM guilds WHERE id = ?', [user.guild_id]);
  const allowed = m.user_id === req.user.id || (g && g.leader_id === req.user.id);
  if (!allowed) return res.status(403).json({ error: 'Action reservee a l\'auteur ou au chef.' });
  await run('UPDATE guild_messages SET hidden = 1 WHERE id = ?', [msgId]);
  res.json({ ok: true });
}));

// Exclure un membre de la guilde (chef uniquement, pas lui-meme).
app.post('/api/guild/kick', requireAuth, h(async (req, res) => {
  const targetId = Number(req.body?.userId);
  const user = await reloadUser(req.user.id);
  if (!user.guild_id) return res.status(400).json({ error: "Tu n'es dans aucune guilde." });
  const g = await get('SELECT leader_id FROM guilds WHERE id = ?', [user.guild_id]);
  if (!g || g.leader_id !== req.user.id) return res.status(403).json({ error: 'Seul le chef peut exclure.' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas t\'exclure toi-meme.' });
  const t = await get('SELECT guild_id FROM users WHERE id = ?', [targetId]);
  if (!t || t.guild_id !== user.guild_id) return res.status(404).json({ error: 'Membre introuvable.' });
  await run('UPDATE users SET guild_id = NULL, guild_contrib = 0 WHERE id = ?', [targetId]);
  res.json({ ok: true });
}));

// ---------- Donnees statiques de jeu ----------
app.get('/api/species', (req, res) => {
  const out = {};
  for (const [id, sp] of Object.entries(SPECIES)) out[id] = { ...sp, hasArt: hasArt(id), tier: tierOf(id) };
  res.json({ species: out, recipes: BREED_RECIPES, breedChart: BREED_CHART });
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
