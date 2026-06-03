// ---------- Client Veilborn ----------
import { creatureSVG, creatureVisual } from './sprites.js?v=8';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let STATE = null;        // dernier etat serveur
let SERVER_SKEW = 0;     // serverTime - Date.now() local, pour des comptes a rebours justes
let pollTimer = null;

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}

// Petite notification ephemere (toast)
function flash(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(flash._t);
  flash._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ============================================================
//  Authentification
// ============================================================
let authMode = 'login';

$$('.tab').forEach(t => t.addEventListener('click', () => {
  authMode = t.dataset.auth;
  $$('.tab').forEach(x => x.classList.toggle('active', x === t));
  $('#auth-submit').textContent = authMode === 'login' ? 'Se connecter' : "S'inscrire";
  $('#auth-error').textContent = '';
}));

let pendingSignup = null;

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#auth-error').textContent = '';
  const username = $('#username').value.trim();
  const password = $('#password').value;
  if (authMode === 'login') {
    try { await api('/login', { method: 'POST', body: { username, password } }); await enterGame(); }
    catch (err) { $('#auth-error').textContent = err.message; }
  } else {
    if (username.length < 3 || password.length < 4) {
      $('#auth-error').textContent = 'Pseudo (>=3) et mot de passe (>=4) requis.'; return;
    }
    pendingSignup = { username, password };
    await showStarterChoice();
  }
});

// Ecran de choix du starter (a l'inscription)
async function showStarterChoice() {
  try {
    const { starters } = await api('/starters');
    $('#starter-choices').innerHTML = starters.map(s => `
      <div class="starter-card" data-starter="${s.id}" data-rarity="${s.rarity}">
        <div class="avatar">${creatureVisual({ ...s, species: s.id }, 110)}</div>
        <div class="name">${s.name}</div>
        <div class="sub">${s.type}</div>
      </div>`).join('');
    $('#starter-error').textContent = '';
    $('#auth-screen').classList.add('hidden');
    $('#starter-screen').classList.remove('hidden');
  } catch (err) { $('#auth-error').textContent = err.message; }
}

$('#starter-choices').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-starter]');
  if (!card || !pendingSignup) return;
  try {
    await api('/register', { method: 'POST', body: { ...pendingSignup, starter: card.dataset.starter } });
    $('#starter-screen').classList.add('hidden');
    pendingSignup = null;
    await enterGame();
  } catch (err) { $('#starter-error').textContent = err.message; }
});
$('#starter-back').addEventListener('click', () => {
  $('#starter-screen').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
});

$('#logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  clearInterval(pollTimer);
  STATE = null;
  $('#game-screen').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
});

// ============================================================
//  Navigation entre vues
// ============================================================
function switchView(view) {
  $$('.navbtn').forEach(x => x.classList.toggle('active', x.dataset.view === view));
  $$('.view').forEach(v => v.classList.add('hidden'));
  const el = $('#view-' + view);
  if (el) el.classList.remove('hidden');
  if (view === 'leaderboard') loadLeaderboard();
  if (view === 'dex') loadDex();
  if (view === 'prairie') startPrairie(); else stopPrairie();
}
$$('.navbtn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));

// ============================================================
//  Glumpdex : lignees d'evolution
// ============================================================
const TYPE_EMOJI = { Feu: '🔥', Eau: '💧', Plante: '🌿', Foudre: '⚡', Roche: '🪨', Glace: '❄️', Ombre: '🌑', Lumiere: '✨', Mystique: '🔮', Acier: '⚙️', Poison: '☠️', Vent: '🌪️', Insecte: '🐛', Dragon: '🐉' };
let dexMode = 'normal'; // 'normal' | 'shiny'
async function loadDex() {
  const { species } = await api('/species');
  const shiny = dexMode === 'shiny';
  const discovered = new Set((shiny ? STATE?.discoveredShiny : STATE?.discovered) || []);
  const entries = Object.entries(species); // ordre du species.json (familles a la suite)
  const total = entries.length;

  let html = `
    <div class="dex-toggle">
      <button class="dextab ${!shiny ? 'active' : ''}" data-dexmode="normal">Normal</button>
      <button class="dextab ${shiny ? 'active' : ''}" data-dexmode="shiny">✨ Chromatique</button>
    </div>
    <p class="hint">${shiny ? 'Chromatiques obtenus' : 'Decouverts'} : <b>${discovered.size}</b> / ${total}</p>
    <div class="dexgrid">`;
  let num = 0;
  for (const [id, sp] of entries) {
    num++;
    const locked = !discovered.has(id);
    const cr = { species: id, speciesName: sp.name, color: sp.color, type: sp.type, rarity: sp.rarity, shape: sp.shape, hasArt: sp.hasArt, variant: shiny ? 1 : 0 };
    html += `<div class="dexmon ${locked ? 'locked' : ''}" data-rarity="${sp.rarity}">
      <div class="dexnum">N°${String(num).padStart(3, '0')}</div>
      <div class="avatar">${creatureVisual(cr, 52)}</div>
      <div class="name">${locked ? '???' : sp.name}</div>
      <div class="sub">${locked ? '—' : sp.type}</div>
    </div>`;
  }
  html += '</div>';
  $('#dex').innerHTML = html;
}
$('#dex').addEventListener('click', (e) => {
  const t = e.target.closest('[data-dexmode]');
  if (t) { dexMode = t.dataset.dexmode; loadDex(); }
});

// ============================================================
//  Entree en jeu + boucle de rafraichissement
// ============================================================
async function enterGame() {
  $('#auth-screen').classList.add('hidden');
  $('#game-screen').classList.remove('hidden');
  await refresh();
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 4000); // resync serveur
  requestAnimationFrame(tickLoop);        // animation des comptes a rebours + essence
  if (!localStorage.getItem('veilborn_tuto')) showTuto(0); // tuto au 1er passage
}

async function refresh() {
  try {
    STATE = await api('/state');
    SERVER_SKEW = STATE.serverTime - Date.now();
    $('#who').textContent = STATE.user.username;
    const sw = $('#settings-who'); if (sw) sw.textContent = STATE.user.username;
    renderAll();
  } catch (err) {
    // session expiree -> retour login
    clearInterval(pollTimer);
    $('#game-screen').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
  }
}

function serverNow() { return Date.now() + SERVER_SKEW; }

// Boucle locale fluide (essence qui monte, comptes a rebours).
let lastEssenceShown = 0;
function tickLoop() {
  if (STATE) {
    // estimation locale de l'essence entre deux refresh
    const est = STATE.user.essence + STATE.essencePerSec * ((serverNow() - STATE.serverTime) / 1000);
    $('#essence').textContent = Math.floor(est).toLocaleString('fr-FR');
    updateCountdowns();
  }
  requestAnimationFrame(tickLoop);
}

// ============================================================
//  Rendu
// ============================================================
function renderAll() {
  $('#rate').textContent = '+' + STATE.essencePerSec.toFixed(2) + '/s';
  renderIncubators();
  renderBreedingCells();
  renderCollection();
  if (prairieActive) { buildMeadow(); renderPrairieSlots(); }
}

const RARITY_DOTS = (r) => '★'.repeat(r) + '☆'.repeat(5 - r);

function avatar(c) {
  return `<div class="avatar">${creatureVisual(c, 74)}</div>`;
}

function eggs() { return STATE.creatures.filter(c => c.stage === 'egg'); }
function shopEggs() { return STATE.creatures.filter(c => c.stage === 'egg' && !c.fromBreeding); }
function bredEggs() { return STATE.creatures.filter(c => c.stage === 'egg' && c.fromBreeding); }

function eggCellHtml(egg, mystery) {
  const ready = egg.remainingMs <= 0;
  const label = mystery && !ready ? '???' : `${egg.speciesName} ${RARITY_DOTS(egg.rarity)}`;
  return `<div class="incubator ${ready ? 'ready' : ''}" data-egg="${egg.id}">
    <div class="egg">${ready ? '🐣' : '🥚'}</div>
    <div class="sub">${label}</div>
    <div class="countdown" data-ready="${egg.readyAt}">${ready ? 'Eclot !' : ''}</div>
  </div>`;
}

function renderIncubators() {
  const slots = STATE.user.incubatorSlots;
  const e = shopEggs();
  let html = '';
  for (let i = 0; i < slots; i++) {
    html += e[i] ? eggCellHtml(e[i], false)
      : `<div class="incubator empty"><div class="egg">⬚</div><div>Libre</div></div>`;
  }
  $('#incubators').innerHTML = html;
  const buyBtn = $('#buy-slot');
  if (slots >= 8) { buyBtn.disabled = true; buyBtn.textContent = 'Max'; }
  else { buyBtn.disabled = false; buyBtn.textContent = '+ Incubateur'; }
}

let breedSelA = null, breedSelB = null; // parents selectionnes dans la cellule "composer"
function renderBreedingCells() {
  const max = STATE.user.breedingCells;
  const eggsList = bredEggs();
  $('#breeding-info').textContent = `${eggsList.length}/${max}`;
  const find = (id) => STATE.creatures.find(c => c.id === id);
  const parentBox = (c, extra = '') => c
    ? `<div class="breed-parent ${extra}"><div class="bp-sprite">${creatureVisual(c, 60)}</div><span>${c.nickname || c.speciesName}</span></div>`
    : `<div class="breed-parent ${extra}"><div class="bp-sprite ghost">?</div></div>`;

  let html = '';
  let composerPlaced = false;
  for (let i = 0; i < max; i++) {
    const egg = eggsList[i];
    if (egg) {
      // cellule occupee : parent gauche | oeuf | parent droite
      html += `<div class="breed-cell">
        ${parentBox(find(egg.parentA))}
        <div class="breed-mid"><div class="breed-egg">🥚</div><div class="countdown" data-ready="${egg.readyAt}"></div></div>
        ${parentBox(find(egg.parentB))}
      </div>`;
    } else if (!composerPlaced) {
      // premiere cellule libre = composer (choix des 2 parents)
      composerPlaced = true;
      const a = breedSelA && find(breedSelA), b = breedSelB && find(breedSelB);
      const slot = (c, side) => c
        ? `<div class="breed-parent slot" data-pick-parent="${side}"><div class="bp-sprite">${creatureVisual(c, 60)}</div><span>${c.nickname || c.speciesName}</span></div>`
        : `<div class="breed-parent slot" data-pick-parent="${side}"><div class="bp-add">+</div><span>Parent</span></div>`;
      const mid = (a && b) ? `<button class="btn primary" id="do-breed">❤ Reproduire</button>` : `<span class="heart">❤</span>`;
      html += `<div class="breed-cell composer">${slot(a, 'a')}<div class="breed-mid">${mid}</div>${slot(b, 'b')}</div>`;
    } else {
      html += `<div class="breed-cell locked-cell"><span>Cellule libre</span></div>`;
    }
  }
  $('#breeding-cells').innerHTML = html;

  const buyBtn = $('#buy-cell');
  if (max >= 5) { buyBtn.disabled = true; buyBtn.textContent = 'Max (5)'; }
  else { buyBtn.disabled = false; buyBtn.textContent = '+ Cellule'; }
}

$('#breeding-cells').addEventListener('click', async (e) => {
  const slot = e.target.closest('[data-pick-parent]');
  const doBreed = e.target.closest('#do-breed');
  if (slot) {
    const side = slot.dataset.pickParent;
    const other = side === 'a' ? breedSelB : breedSelA;
    const adults = STATE.creatures.filter(c => c.stage === 'adult' && c.id !== other);
    openPicker('Choisir le parent', adults, pickCardHtml, (id) => {
      if (side === 'a') breedSelA = id; else breedSelB = id;
      closePicker(); renderBreedingCells();
    });
  } else if (doBreed) {
    const msg = $('#breed-msg'); msg.className = 'msg';
    try {
      await api('/breed', { method: 'POST', body: { parentA: breedSelA, parentB: breedSelB } });
      breedSelA = null; breedSelB = null;
      msg.textContent = 'Œuf en couvaison dans la cellule ! 🥚'; msg.classList.add('ok');
      await refresh();
    } catch (err) { msg.textContent = err.message; msg.classList.add('err'); }
  }
});

function renderCollection() {
  const owned = STATE.creatures.filter(c => c.stage !== 'egg');
  $('#coll-count').textContent = owned.length;
  $('#collection').innerHTML = owned.map(cardHtml).join('') ||
    '<p class="hint">Aucun Glump. Fais eclore un oeuf !</p>';
}

function cardHtml(c) {
  const baby = c.stage === 'baby';
  const badges = [];
  if (c.variant) badges.push('<span class="badge shiny">SHINY</span>');
  if (baby) badges.push('<span class="badge baby">Bebe</span>');
  const evo = (c.stage === 'adult' && c.evolvesTo)
    ? (c.canEvolve
        ? `<button class="btn small evo" data-evolve="${c.id}">⬆ Evoluer → ${c.evolvesToName}</button>`
        : `<button class="btn small evo" disabled>⬆ ${c.evolvesToName} · Niv ${c.evolveLevel}</button>`)
    : '';
  const xpPct = Math.min(100, Math.round(100 * (c.xpInto || 0) / (c.xpNext || 1)));
  return `<div class="card" data-id="${c.id}" data-rarity="${c.rarity}">
    ${badges.join('')}
    <span class="badge lvl">Niv ${c.level || 1}</span>
    ${avatar(c)}
    <div class="rarity-dots">${RARITY_DOTS(c.rarity)}</div>
    <div class="name">${c.nickname || c.speciesName}</div>
    <div class="sub">${c.type} · val. ${c.value}</div>
    <div class="stats">
      <span><b>${c.stats.force}</b>FOR</span>
      <span><b>${c.stats.vita}</b>VIT</span>
      <span><b>${c.stats.speed}</b>VIT.</span>
    </div>
    <div class="xpbar" title="${c.xpInto || 0}/${c.xpNext || 0} XP"><i style="width:${xpPct}%"></i></div>
    ${evo}
    <div class="card-actions">
      <button class="btn small" data-rename="${c.id}">Renommer</button>
      <button class="btn small" data-release="${c.id}">Relacher</button>
    </div>
  </div>`;
}

// Comptes a rebours fluides (sans appel serveur).
function updateCountdowns() {
  const now = serverNow();
  $$('.countdown[data-ready]').forEach(el => {
    const ready = Number(el.dataset.ready);
    const rem = ready - now;
    if (rem <= 0) { el.textContent = 'Eclot !'; el.closest('.incubator')?.classList.add('ready'); }
    else el.textContent = fmt(rem);
  });
  // barres de progression des oeufs
  for (const egg of eggs()) {
    const bar = document.querySelector(`[data-egg-bar="${egg.id}"]`);
    if (!bar) continue;
    const total = egg.readyAt - (egg.readyAt - durationGuess(egg));
    const rem = Math.max(0, egg.readyAt - now);
    const pct = Math.max(0, Math.min(100, 100 * (1 - rem / durationGuess(egg))));
    bar.style.width = pct + '%';
  }
}
// On ne connait pas la duree totale cote client; on l'estime via la rarete.
function durationGuess(egg) {
  return 120000 * egg.rarity; // doit matcher incubationBaseSec*1000
}

function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) { const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; }
  return m > 0 ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
}

// ============================================================
//  Actions
// ============================================================
$('#buy-slot').addEventListener('click', async () => {
  try { await api('/incubator/buy', { method: 'POST' }); await refresh(); }
  catch (err) { alert(err.message); }
});

$('#buy-cell').addEventListener('click', async () => {
  if (!confirm('Acheter une cellule de reproduction ? (coûteux)')) return;
  try { const r = await api('/breeding/buy-cell', { method: 'POST' }); flash(`Cellule achetée (-${r.cost} ✨)`); await refresh(); }
  catch (err) { alert(err.message); }
});

// Delegation pour relacher / renommer
// ---------- Fiche detaillee d'un Glump ----------
const STAT_LABEL = { force: 'Force', vita: 'Vitalite', speed: 'Vitesse' };
function openDetail(id) {
  const c = STATE.creatures.find(x => x.id === id);
  if (!c) return;
  const stageTxt = c.stage === 'egg' ? 'Oeuf' : c.stage === 'baby' ? 'Bebe' : 'Adulte';
  const natTxt = c.natureUp
    ? `<b>${c.nature}</b> (+10% ${STAT_LABEL[c.natureUp]}, −10% ${STAT_LABEL[c.natureDown]})`
    : `<b>${c.nature}</b> (neutre)`;
  const ivRow = (key) => {
    const g = c.genes[key], pct = Math.round(100 * g / 31);
    const cls = c.natureUp === key ? 'up' : c.natureDown === key ? 'down' : '';
    const sign = c.natureUp === key ? ' ▲' : c.natureDown === key ? ' ▼' : '';
    return `<div class="iv-row">
      <span class="iv-label ${cls}">${STAT_LABEL[key]}${sign}</span>
      <div class="iv-bar"><i style="width:${pct}%"></i></div>
      <span class="iv-val">${g}/31</span><span class="iv-stat">→ <b>${c.stats[key]}</b></span></div>`;
  };
  const xpPct = Math.round(100 * (c.xpInto || 0) / (c.xpNext || 1));
  $('#detail-name').textContent = (c.variant ? '✨ ' : '') + (c.nickname || c.speciesName);
  $('#detail-body').innerHTML = `
    <div class="detail-top" data-rarity="${c.rarity}">
      <div class="detail-avatar">${creatureVisual(c, 132)}</div>
      <div class="detail-species">${c.speciesName}</div>
      <div class="detail-tags">${c.type} · ${RARITY_DOTS(c.rarity)} · ${stageTxt}</div>
      ${c.variant ? '<div class="badge shiny" style="position:static;display:inline-block;margin-top:6px;">CHROMATIQUE ✨</div>' : ''}
    </div>
    <div class="detail-block"><div class="detail-lbl">Niveau ${c.level}</div>
      <div class="xpbar"><i style="width:${xpPct}%"></i></div>
      <div class="detail-sub">${c.xpInto}/${c.xpNext} XP — ${c.inPrairie ? "gagne de l'XP en prairie 🌳" : 'place-le en prairie pour progresser'}</div>
      <button class="btn small primary candy" data-candy="${c.id}" style="margin-top:10px;width:100%;">🍬 Super Bonbon ✨60 (+120 XP)</button>
    </div>
    <div class="detail-block"><div class="detail-lbl">Nature</div><div>${natTxt}</div></div>
    <div class="detail-block"><div class="detail-lbl">Genes (IV) → Stats</div>
      ${ivRow('force')}${ivRow('vita')}${ivRow('speed')}
      <div class="detail-sub">Puissance totale <b>${c.power}</b> · Valeur ${c.value}</div>
    </div>
    ${c.evolvesTo ? `<div class="detail-block"><div class="detail-lbl">Evolution</div>
      ${c.canEvolve
        ? `<button class="btn primary" data-evolve="${c.id}" style="width:100%;">⬆ Evoluer en ${c.evolvesToName}</button>`
        : `<div class="detail-sub">Evolue en <b>${c.evolvesToName}</b> au <b>niveau ${c.evolveLevel}</b> (actuel : ${c.level}).</div>`}
    </div>` : ''}`;
  $('#detail').classList.remove('hidden');
  $('#detail-overlay').classList.remove('hidden');
}
function closeDetail() { $('#detail').classList.add('hidden'); $('#detail-overlay').classList.add('hidden'); }
$('#detail-close').addEventListener('click', closeDetail);
$('#detail-overlay').addEventListener('click', closeDetail);
$('#detail-body').addEventListener('click', async (e) => {
  const candyBtn = e.target.closest('[data-candy]');
  const evoBtn = e.target.closest('[data-evolve]');
  if (candyBtn) {
    const id = Number(candyBtn.dataset.candy);
    try {
      const r = await api('/creature/candy', { method: 'POST', body: { id } });
      await refresh(); openDetail(id);
      flash(`+${r.xp} XP 🍬 (niveau ${r.creature.level})`);
    } catch (err) { alert(err.message); }
  } else if (evoBtn) {
    const id = Number(evoBtn.dataset.evolve);
    try {
      const r = await api('/creature/evolve', { method: 'POST', body: { id } });
      await refresh(); openDetail(id);
      flash(`✨ ${r.fromName} a evolue en ${r.creature.speciesName} !`);
    } catch (err) { alert(err.message); }
  }
});

$('#collection').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) { // clic sur la carte (hors bouton) -> fiche detaillee
    const card = e.target.closest('.card');
    if (card) openDetail(Number(card.dataset.id));
    return;
  }
  const rel = btn?.dataset.release;
  const ren = btn?.dataset.rename;
  const evo = btn?.dataset.evolve;
  if (evo) {
    const c = STATE.creatures.find(x => x.id === Number(evo));
    if (c && !confirm(`Faire evoluer ${c.nickname || c.speciesName} en ${c.evolvesToName} pour ${c.evolveCost} essence ?`)) return;
    try {
      const r = await api('/creature/evolve', { method: 'POST', body: { id: Number(evo) } });
      await refresh();
      flash(`✨ ${r.fromName} a evolue en ${r.creature.speciesName} !`);
    } catch (err) { alert(err.message); }
  } else if (rel) {
    if (!confirm('Relacher ce Glump contre de l\'essence ?')) return;
    try { await api('/creature/release', { method: 'POST', body: { id: Number(rel) } }); await refresh(); }
    catch (err) { alert(err.message); }
  } else if (ren) {
    const nickname = prompt('Nouveau surnom (vide pour retirer) :');
    if (nickname === null) return;
    try { await api('/creature/rename', { method: 'POST', body: { id: Number(ren), nickname } }); await refresh(); }
    catch (err) { alert(err.message); }
  }
});

// ============================================================
//  Classement + visite
// ============================================================
async function loadLeaderboard() {
  const { board } = await api('/leaderboard');
  const me = STATE?.user?.id;
  $('#board-body').innerHTML = board.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="${r.id === me ? 'me' : ''}">${r.username}</td>
      <td>${r.collection.toLocaleString('fr-FR')}</td>
      <td>${r.best}</td>
      <td>${r.count}</td>
      <td><span class="visit-link" data-visit="${r.id}" data-name="${r.username}">Visiter →</span></td>
    </tr>`).join('') || '<tr><td colspan="6">Aucun eleveur.</td></tr>';
}

$('#board-body').addEventListener('click', (e) => {
  const id = e.target.dataset.visit;
  if (!id) return;
  visitFarm(Number(id), e.target.dataset.name);
});

async function visitFarm(userId, name) {
  $$('.navbtn').forEach(x => x.classList.toggle('active', x.dataset.view === 'visit'));
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-visit').classList.remove('hidden');
  $('#visit-title').textContent = `Elevage de ${name}`;
  $('#visit-hint').textContent = 'Chargement...';
  try {
    const data = await api('/farm/' + userId);
    $('#visit-hint').textContent = `${data.creatures.length} Glump(s)`;
    $('#visit-cards').innerHTML = data.creatures.map(cardHtmlReadonly).join('') ||
      '<p class="hint">Cet eleveur n\'a aucun Glump.</p>';
  } catch (err) { $('#visit-hint').textContent = err.message; }
}

function cardHtmlReadonly(c) {
  const badges = [];
  if (c.variant) badges.push('<span class="badge shiny">SHINY</span>');
  if (c.stage === 'baby') badges.push('<span class="badge baby">Bebe</span>');
  return `<div class="card" data-rarity="${c.rarity}">
    ${badges.join('')}
    ${avatar(c)}
    <div class="rarity-dots">${RARITY_DOTS(c.rarity)}</div>
    <div class="name">${c.nickname || c.speciesName}</div>
    <div class="sub">${c.type} · valeur ${c.value}</div>
    <div class="stats">
      <span><b>${c.stats.force}</b>FOR</span>
      <span><b>${c.stats.vita}</b>VIT</span>
      <span><b>${c.stats.speed}</b>VIT.</span>
    </div>
  </div>`;
}

// ============================================================
//  Prairie : les creatures gambadent
// ============================================================
let prairieActive = false;
let prairieRAF = null;
let critters = [];       // { el, x, y, tx, ty, speed, size, facing }
let prairieIds = '';     // signature des creatures affichees

function startPrairie() {
  prairieActive = true;
  buildMeadow();
  renderPrairieSlots();
  if (!prairieRAF) prairieRAF = requestAnimationFrame(prairieLoop);
}
function stopPrairie() {
  prairieActive = false;
  if (prairieRAF) { cancelAnimationFrame(prairieRAF); prairieRAF = null; }
}

// Emplacements de prairie (chips sous le pre) + infos + bouton acheter.
function renderPrairieSlots() {
  if (!STATE) return;
  const max = STATE.user.prairieSlots;
  const inP = STATE.creatures.filter(c => c.inPrairie);
  $('#prairie-info').textContent = `${inP.length}/${max} · +${STATE.essencePerSec.toFixed(2)}/s ✨`;

  const buyBtn = $('#buy-prairie');
  if (max >= 12) { buyBtn.disabled = true; buyBtn.textContent = 'Max'; }
  else { buyBtn.disabled = false; buyBtn.textContent = '+ Emplacement'; }

  let html = '';
  for (let i = 0; i < max; i++) {
    const c = inP[i];
    if (c) {
      html += `<div class="slot">
        <div class="mini">${creatureVisual(c, 42)}</div>
        <span class="slot-name">${c.nickname || c.speciesName}</span>
        <button class="slot-rm" data-prairie-rm="${c.id}" title="Retirer">✕</button>
      </div>`;
    } else {
      html += `<div class="slot empty" data-prairie-add="1">+ Ajouter</div>`;
    }
  }
  $('#prairie-slots').innerHTML = html;
}

// Selecteur generique : openPicker(titre, items, renderFn, onPick(id)).
let pickerOnPick = null;
function openPicker(title, items, render, onPick) {
  $('#picker .drawer-head h3').textContent = title;
  $('#picker-list').innerHTML = items.length ? items.map(render).join('') : '<p class="hint">Rien de disponible.</p>';
  pickerOnPick = onPick;
  $('#picker').classList.remove('hidden');
  $('#picker-overlay').classList.remove('hidden');
}
function closePicker() {
  $('#picker').classList.add('hidden');
  $('#picker-overlay').classList.add('hidden');
  pickerOnPick = null;
}
function pickCardHtml(c) {
  return `<div class="card" data-pick="${c.id}" data-rarity="${c.rarity}">
    ${avatar(c)}
    <div class="name">${c.nickname || c.speciesName}</div>
    <div class="sub">${c.type} · P${c.power}</div>
  </div>`;
}

$('#buy-prairie').addEventListener('click', async () => {
  try { const r = await api('/prairie/buy', { method: 'POST' }); flash(`Emplacement achete (-${r.cost} ✨)`); await refresh(); }
  catch (err) { alert(err.message); }
});
$('#prairie-slots').addEventListener('click', async (e) => {
  const rm = e.target.dataset.prairieRm;
  const add = e.target.closest('[data-prairie-add]');
  if (rm) {
    try { await api('/prairie/remove', { method: 'POST', body: { id: Number(rm) } }); await refresh(); }
    catch (err) { alert(err.message); }
  } else if (add) {
    const avail = STATE.creatures.filter(c => c.stage === 'adult' && !c.inPrairie);
    openPicker('Mettre un Glump en prairie', avail, pickCardHtml, async (id) => {
      try { await api('/prairie/assign', { method: 'POST', body: { id } }); closePicker(); await refresh(); flash('Glump mis en prairie 🌳'); }
      catch (err) { alert(err.message); }
    });
  }
});
$('#picker-list').addEventListener('click', (e) => {
  const el = e.target.closest('[data-pick]');
  if (el && pickerOnPick) pickerOnPick(Number(el.dataset.pick));
});
$('#picker-close').addEventListener('click', closePicker);
$('#picker-overlay').addEventListener('click', closePicker);

function meadowSize() {
  const m = $('#meadow');
  return { w: m.clientWidth || 600, h: m.clientHeight || 460 };
}

// (Re)construit la prairie seulement si la liste des creatures a change.
function buildMeadow() {
  if (!STATE) return;
  const list = STATE.creatures.filter(c => c.inPrairie); // seuls les Glumps en prairie y gambadent
  const sig = list.map(c => c.id + c.stage).join(',');
  if (sig === prairieIds && critters.length) return; // rien de neuf
  prairieIds = sig;

  const m = $('#meadow');
  const { w, h } = meadowSize();
  // decor
  let decor = '<div class="sun"></div>';
  const clouds = [[w*0.12, 40, 90, 22], [w*0.5, 30, 120, 28], [w*0.78, 70, 80, 20]];
  for (const [x, y, cw, ch] of clouds) {
    decor += `<div class="cloud" style="left:${x}px;top:${y}px;width:${cw}px;height:${ch}px;"></div>`;
  }
  const bushes = [[ -10, 70, 90], [w*0.35, 60, 70], [w*0.7, 80, 110], [w*0.9, 50, 60]];
  for (const [x, bw, bh] of bushes) {
    decor += `<div class="bush" style="left:${x}px;width:${bw}px;height:${bh}px;"></div>`;
  }
  m.innerHTML = decor;

  critters = list.map(c => {
    const baby = c.stage === 'baby';
    const size = baby ? 44 : 66;
    const x = 20 + Math.random() * (w - size - 40);
    const y = (h * 0.45) + Math.random() * (h * 0.45 - size);
    const el = document.createElement('div');
    el.className = 'critter' + (baby ? ' baby' : '');
    el.style.width = size + 'px';
    el.innerHTML = creatureVisual(c, size) +
      `<span class="label">${c.variant ? '✨ ' : ''}${c.nickname || c.speciesName}</span>`;
    el.addEventListener('click', () => {
      el.classList.add('show-label');
      setTimeout(() => el.classList.remove('show-label'), 1500);
    });
    m.appendChild(el);
    return { el, x, y, tx: x, ty: y, size, speed: (baby ? 0.5 : 0.35) + Math.random() * 0.25, facing: 1, pause: 0 };
  });
}

function prairieLoop() {
  if (!prairieActive) { prairieRAF = null; return; }
  const { w, h } = meadowSize();
  for (const c of critters) {
    if (c.pause > 0) { c.pause--; }
    else {
      const dx = c.tx - c.x, dy = c.ty - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) {
        // nouvelle destination + petite pause
        c.tx = 20 + Math.random() * (w - c.size - 40);
        c.ty = (h * 0.4) + Math.random() * (h * 0.5 - c.size);
        c.pause = 30 + Math.floor(Math.random() * 120);
      } else {
        c.x += (dx / dist) * c.speed;
        c.y += (dy / dist) * c.speed;
        c.facing = dx >= 0 ? 1 : -1;
      }
    }
    // petit rebond vertical facon "marche"
    const bob = Math.sin((c.x + c.y) * 0.15) * 2;
    c.el.style.left = c.x + 'px';
    c.el.style.top = (c.y + bob) + 'px';
    c.el.style.transform = `scaleX(${c.facing})`;
  }
  prairieRAF = requestAnimationFrame(prairieLoop);
}

// ============================================================
//  Drawer lateral : evenements / boutique / reglages
// ============================================================
const DRAWER_TITLES = { events: '🎉 Evenements', shop: '🛒 Boutique', settings: '⚙️ Reglages', social: '👥 Social' };
function openDrawer(type) {
  $('#drawer-title').textContent = DRAWER_TITLES[type] || '';
  $$('.drawer-section').forEach(s => s.classList.add('hidden'));
  const sec = $('#drawer-' + type);
  if (sec) sec.classList.remove('hidden');
  if (type === 'social') loadSocial();
  $('#drawer').classList.remove('hidden');
  $('#drawer-overlay').classList.remove('hidden');
}

// ---------- Social : amis & code ami ----------
async function loadSocial() {
  try {
    const { code, friends } = await api('/social');
    $('#my-code').textContent = code;
    $('#friends-count').textContent = friends.length;
    $('#friends-list').innerHTML = friends.map(f => `
      <div class="friend-row">
        <span class="friend-name">${f.username}</span>
        <button class="btn small" data-visit-friend="${f.id}" data-name="${f.username}">Visiter</button>
        <button class="btn small" data-remove-friend="${f.id}">✕</button>
      </div>`).join('') || '<p class="hint">Aucun ami pour l\'instant. Ajoute un code !</p>';
  } catch (err) { $('#friends-list').innerHTML = `<p class="hint">${err.message}</p>`; }
}
$('#copy-code').addEventListener('click', () => {
  const code = $('#my-code').textContent;
  navigator.clipboard?.writeText(code);
  flash('Code copié : ' + code);
});
$('#add-friend-btn').addEventListener('click', async () => {
  const code = $('#friend-code-input').value.trim();
  const msg = $('#social-msg'); msg.className = 'msg';
  try {
    const r = await api('/social/add', { method: 'POST', body: { code } });
    msg.textContent = `${r.friend.username} ajouté !`; msg.classList.add('ok');
    $('#friend-code-input').value = '';
    loadSocial();
  } catch (err) { msg.textContent = err.message; msg.classList.add('err'); }
});
$('#friends-list').addEventListener('click', async (e) => {
  const visit = e.target.closest('[data-visit-friend]');
  const rem = e.target.closest('[data-remove-friend]');
  if (visit) {
    closeDrawer();
    visitFarm(Number(visit.dataset.visitFriend), visit.dataset.name);
  } else if (rem) {
    if (!confirm('Retirer cet ami ?')) return;
    try { await api('/social/remove', { method: 'POST', body: { friendId: Number(rem.dataset.removeFriend) } }); loadSocial(); }
    catch (err) { alert(err.message); }
  }
});

// ---------- Boutique (modale centree a onglets) ----------
let shopData = null;
function openShop() {
  $('#shop-modal').classList.remove('hidden');
  $('#shop-overlay').classList.remove('hidden');
  switchShopTab('egg');
}
function closeShop() {
  $('#shop-modal').classList.add('hidden');
  $('#shop-overlay').classList.add('hidden');
}
async function switchShopTab(tab) {
  $$('.shop-tab').forEach(t => t.classList.toggle('active', t.dataset.shoptab === tab));
  $$('.shop-pane').forEach(p => p.classList.add('hidden'));
  $('#shop-' + tab).classList.remove('hidden');
  if (!shopData) { try { shopData = await api('/shop'); } catch { shopData = { elements: [], eggPrice: 0, candy: {} }; } }
  if (tab === 'egg') renderShopEgg();
  else if (tab === 'item') renderShopItem();
  else if (tab === 'bonus') renderShopBonus();
}
function renderShopEgg() {
  $('#shop-egg').innerHTML = `<p class="hint">Un œuf d'un élément → un bébé <b>aléatoire</b> de ce type (pure chance !). Il te faut un incubateur libre (onglet Œufs).</p>
    <div class="shop-grid">` + shopData.elements.map(t => `
    <button class="shop-egg-tile" data-buy-egg-type="${t}">
      <span class="shop-egg-emoji">${TYPE_EMOJI[t] || '🥚'}</span>
      <span class="shop-egg-name">${t}</span>
      <span class="shop-egg-price">✨ ${shopData.eggPrice}</span>
    </button>`).join('') + `</div>`;
}
function renderShopItem() {
  const c = shopData.candy || {};
  $('#shop-item').innerHTML = `
    <div class="shop-item">
      <div class="shop-egg">🍬</div>
      <div class="shop-info"><div class="shop-name">Super Bonbon</div><div class="shop-sub">+${c.xp} XP à un Glump</div></div>
      <button class="btn small primary" id="buy-candy">✨ ${c.cost}</button>
    </div>`;
}
function renderShopBonus() {
  $('#shop-bonus').innerHTML = `
    <div class="shop-item">
      <div class="shop-egg">⚡</div>
      <div class="shop-info"><div class="shop-name">Accélérer un œuf</div><div class="shop-sub">Termine une éclosion / couvaison (coût selon le temps restant)</div></div>
      <button class="btn small primary" id="accel-egg">Choisir</button>
    </div>`;
}
$('#shop-modal').addEventListener('click', async (e) => {
  const eggTile = e.target.closest('[data-buy-egg-type]');
  if (eggTile) {
    try { await api('/shop/buy-egg', { method: 'POST', body: { type: eggTile.dataset.buyEggType } }); flash(`Œuf ${eggTile.dataset.buyEggType} acheté ! 🥚`); await refresh(); }
    catch (err) { alert(err.message); }
    return;
  }
  if (e.target.closest('#buy-candy')) {
    const glumps = STATE.creatures.filter(c => c.stage !== 'egg');
    openPicker('Donner un Super Bonbon à…', glumps, pickCardHtml, async (id) => {
      try { const r = await api('/creature/candy', { method: 'POST', body: { id } }); closePicker(); await refresh(); flash(`+${r.xp} XP 🍬`); }
      catch (err) { alert(err.message); }
    });
    return;
  }
  if (e.target.closest('#accel-egg')) {
    const inProgress = STATE.creatures.filter(c => c.stage === 'egg');
    openPicker('Accélérer quel œuf ?', inProgress, (c) => `<div class="card" data-pick="${c.id}">
        <div class="avatar"><div style="font-size:42px;">🥚</div></div>
        <div class="name">${c.fromBreeding ? '???' : c.speciesName}</div>
        <div class="sub">${Math.ceil((c.remainingMs || 0) / 1000)}s restantes</div>
      </div>`, async (id) => {
      try { const r = await api('/egg/accelerate', { method: 'POST', body: { id } }); closePicker(); await refresh(); flash(`Œuf accéléré (-${r.cost} ✨)`); }
      catch (err) { alert(err.message); }
    });
    return;
  }
});
$('#shop-close').addEventListener('click', closeShop);
$('#shop-overlay').addEventListener('click', closeShop);
$$('.shop-tab').forEach(t => t.addEventListener('click', () => switchShopTab(t.dataset.shoptab)));

function closeDrawer() {
  $('#drawer').classList.add('hidden');
  $('#drawer-overlay').classList.add('hidden');
}
$$('.railbtn').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.drawer === 'shop') openShop();
  else openDrawer(b.dataset.drawer);
}));
$('#drawer-close').addEventListener('click', closeDrawer);
$('#drawer-overlay').addEventListener('click', closeDrawer);

// ============================================================
//  Tutoriel
// ============================================================
const TUTO = [
  { icon: '🥚', title: 'Bienvenue dans Veilborn !', text: "Tu eleves des creatures appelees Glumps : fais-les eclore, grandir, evoluer, et complete ton Glumpdex de 300 Glumps. Tu demarres avec ton starter.", view: 'box' },
  { icon: '📦', title: 'Collection', text: "Voici tous tes Glumps. Clique sur l'un d'eux pour sa fiche (IV, stats, nature). Tu peux les renommer, les relacher, ou les faire evoluer une fois le niveau requis atteint.", view: 'box' },
  { icon: '🥚', title: 'Oeufs', text: "Tes incubateurs. Un oeuf eclot avec le temps (meme hors-ligne !) en bebe, qui devient adulte. Achete des incubateurs pour en faire eclore plusieurs.", view: 'eggs' },
  { icon: '💞', title: 'Reproduction', text: "Choisis deux Glumps adultes pour pondre un oeuf. L'enfant herite des genes des parents, avec une chance d'etre shiny ✨ ou d'une espece plus rare.", view: 'breed' },
  { icon: '🌳', title: 'Prairie', text: "Place tes Glumps ici : ce sont eux qui farment l'essence ✨ (la monnaie du jeu). Max 4 emplacements au depart, achetables. Choisis tes meilleurs farmeurs !", view: 'prairie' },
  { icon: '📖', title: 'Glumpdex', text: "Les 300 Glumps numerotes, a la suite. Ceux que tu n'as pas encore eus sont en silhouette. Objectif : tous les decouvrir !", view: 'dex' },
  { icon: '🏆', title: 'Rang & Visite', text: "Compare la valeur de ta collection aux autres eleveurs (Rang), et visite leurs elevages (onglet Visite).", view: 'leaderboard' },
  { icon: '🚀', title: "C'est parti !", text: "L'essence monte toute seule tant que tu as des Glumps en prairie. Reviens faire eclore, reproduire et evoluer. Tu peux revoir ce tuto dans Reglages ⚙️.", view: 'box' },
];
let tutoStep = 0;
function showTuto(step = 0) { tutoStep = step; renderTuto(); $('#tutorial').classList.remove('hidden'); $('#tuto-overlay').classList.remove('hidden'); }
function hideTuto() { $('#tutorial').classList.add('hidden'); $('#tuto-overlay').classList.add('hidden'); switchView('box'); try { localStorage.setItem('veilborn_tuto', '1'); } catch {} }
function renderTuto() {
  const s = TUTO[tutoStep];
  if (s.view) switchView(s.view); // on navigue en arriere-plan vers l'onglet decrit
  $('#tuto-icon').textContent = s.icon;
  $('#tuto-title').textContent = s.title;
  $('#tuto-text').textContent = s.text;
  $('#tuto-dots').innerHTML = TUTO.map((_, i) => `<span class="dot ${i === tutoStep ? 'on' : ''}"></span>`).join('');
  $('#tuto-prev').style.visibility = tutoStep === 0 ? 'hidden' : 'visible';
  $('#tuto-next').textContent = tutoStep === TUTO.length - 1 ? 'Terminer ✓' : 'Suivant →';
}
$('#tuto-next').addEventListener('click', () => { if (tutoStep < TUTO.length - 1) { tutoStep++; renderTuto(); } else hideTuto(); });
$('#tuto-prev').addEventListener('click', () => { if (tutoStep > 0) { tutoStep--; renderTuto(); } });
$('#tuto-skip').addEventListener('click', hideTuto);
$('#tuto-overlay').addEventListener('click', hideTuto);
$('#replay-tuto').addEventListener('click', () => { closeDrawer(); showTuto(0); });

// ============================================================
//  Demarrage
// ============================================================
(async function init() {
  try {
    const me = await api('/me');
    if (me.loggedIn) await enterGame();
  } catch { /* pas connecte */ }
})();
