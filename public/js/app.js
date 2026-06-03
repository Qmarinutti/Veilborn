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
async function loadDex() {
  const { species } = await api('/species');
  const discovered = new Set(STATE?.discovered || []);
  const entries = Object.entries(species); // ordre du species.json (familles a la suite)
  const total = entries.length;

  // Grille continue : tous les Glumps a la suite (N°001, 002, 003...), qui reviennent a la ligne.
  let html = `<p class="hint">Decouverts : <b>${discovered.size}</b> / ${total}</p><div class="dexgrid">`;
  let num = 0;
  for (const [id, sp] of entries) {
    num++;
    const locked = !discovered.has(id);
    const cr = { species: id, speciesName: sp.name, color: sp.color, type: sp.type, rarity: sp.rarity, shape: sp.shape, hasArt: sp.hasArt, variant: 0 };
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
  renderBreedPickers();
  renderCollection();
  if (prairieActive) { buildMeadow(); renderPrairieSlots(); }
}

const RARITY_DOTS = (r) => '★'.repeat(r) + '☆'.repeat(5 - r);

function avatar(c) {
  return `<div class="avatar">${creatureVisual(c, 74)}</div>`;
}

function eggs() { return STATE.creatures.filter(c => c.stage === 'egg'); }

function renderIncubators() {
  const slots = STATE.user.incubatorSlots;
  const e = eggs();
  let html = '';
  for (let i = 0; i < slots; i++) {
    const egg = e[i];
    if (!egg) {
      html += `<div class="incubator empty"><div class="egg">⬚</div><div>Libre</div></div>`;
    } else {
      const ready = egg.remainingMs <= 0;
      html += `<div class="incubator ${ready ? 'ready' : ''}" data-egg="${egg.id}">
        <div class="egg">${ready ? '🐣' : '🥚'}</div>
        <div class="sub">${egg.speciesName} ${RARITY_DOTS(egg.rarity)}</div>
        <div class="countdown" data-ready="${egg.readyAt}">${ready ? 'Eclot !' : ''}</div>
        <div class="bar"><i data-egg-bar="${egg.id}"></i></div>
      </div>`;
    }
  }
  $('#incubators').innerHTML = html;

  // Bouton acheter incubateur
  const buyBtn = $('#buy-slot');
  if (slots >= 8) { buyBtn.disabled = true; buyBtn.textContent = 'Max'; }
  else { buyBtn.disabled = false; buyBtn.textContent = '+ Incubateur'; }
}

function renderBreedPickers() {
  const adults = STATE.creatures.filter(c => c.stage === 'adult');
  const opt = (c) => `<option value="${c.id}">${label(c)}</option>`;
  const a = $('#parentA'), b = $('#parentB');
  const prevA = a.value, prevB = b.value;
  const options = adults.map(opt).join('');
  a.innerHTML = '<option value="">— parent 1 —</option>' + options;
  b.innerHTML = '<option value="">— parent 2 —</option>' + options;
  if (adults.find(c => String(c.id) === prevA)) a.value = prevA;
  if (adults.find(c => String(c.id) === prevB)) b.value = prevB;
  $('#breed-btn').disabled = adults.length < 2;
}

function label(c) {
  const name = c.nickname || c.speciesName;
  return `${c.variant ? '✨ ' : ''}${name} (P${c.power})`;
}

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
    ? `<button class="btn small evo" data-evolve="${c.id}">⬆ ${c.evolvesToName} <span class="evo-cost">✨${c.evolveCost}</span></button>`
    : '';
  return `<div class="card" data-id="${c.id}" data-rarity="${c.rarity}">
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
$('#breed-btn').addEventListener('click', async () => {
  const parentA = $('#parentA').value, parentB = $('#parentB').value;
  const msg = $('#breed-msg');
  msg.className = 'msg';
  if (!parentA || !parentB) { msg.textContent = 'Choisis deux parents.'; msg.classList.add('err'); return; }
  try {
    const r = await api('/breed', { method: 'POST', body: { parentA, parentB } });
    msg.textContent = `Oeuf de ${r.egg.speciesName} pondu ! ${r.egg.variant ? '✨ SHINY !' : ''}`;
    msg.classList.add('ok');
    await refresh();
  } catch (err) { msg.textContent = err.message; msg.classList.add('err'); }
});

$('#buy-slot').addEventListener('click', async () => {
  try { await api('/incubator/buy', { method: 'POST' }); await refresh(); }
  catch (err) { alert(err.message); }
});

// Delegation pour relacher / renommer
$('#collection').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
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

// Selecteur : liste des adultes pas encore en prairie.
function openPicker() {
  const avail = STATE.creatures.filter(c => c.stage === 'adult' && !c.inPrairie);
  $('#picker-list').innerHTML = avail.map(c => `
    <div class="card" data-pick="${c.id}" data-rarity="${c.rarity}">
      ${avatar(c)}
      <div class="name">${c.nickname || c.speciesName}</div>
      <div class="sub">${c.type} · P${c.power}</div>
    </div>`).join('') || '<p class="hint">Aucun adulte disponible. Fais eclore et grandir des Glumps !</p>';
  $('#picker').classList.remove('hidden');
  $('#picker-overlay').classList.remove('hidden');
}
function closePicker() {
  $('#picker').classList.add('hidden');
  $('#picker-overlay').classList.add('hidden');
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
    openPicker();
  }
});
$('#picker-list').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-pick]');
  if (!card) return;
  try { await api('/prairie/assign', { method: 'POST', body: { id: Number(card.dataset.pick) } }); closePicker(); await refresh(); flash('Glump mis en prairie 🌳'); }
  catch (err) { alert(err.message); }
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
const DRAWER_TITLES = { events: '🎉 Evenements', shop: '🛒 Boutique', settings: '⚙️ Reglages' };
function openDrawer(type) {
  $('#drawer-title').textContent = DRAWER_TITLES[type] || '';
  $$('.drawer-section').forEach(s => s.classList.add('hidden'));
  const sec = $('#drawer-' + type);
  if (sec) sec.classList.remove('hidden');
  if (type === 'shop') loadShop();
  $('#drawer').classList.remove('hidden');
  $('#drawer-overlay').classList.remove('hidden');
}

// Boutique d'oeufs
async function loadShop() {
  try {
    const { eggs } = await api('/shop');
    $('#shop-eggs').innerHTML = eggs.map(e => `
      <div class="shop-item">
        <div class="shop-egg">${e.emoji}</div>
        <div class="shop-info"><div class="shop-name">${e.name}</div><div class="shop-sub">Rarete ${e.rarities[0]}–${e.rarities[1]}</div></div>
        <button class="btn small primary" data-buy-egg="${e.id}">✨ ${e.price}</button>
      </div>`).join('');
  } catch (err) { $('#shop-eggs').innerHTML = `<p class="hint">${err.message}</p>`; }
}
$('#shop-eggs').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-buy-egg]');
  if (!b) return;
  try {
    const r = await api('/shop/buy-egg', { method: 'POST', body: { tier: b.dataset.buyEgg } });
    flash(`Oeuf achete ! 🥚 (${r.egg.speciesName})`);
    await refresh();
  } catch (err) { alert(err.message); }
});
function closeDrawer() {
  $('#drawer').classList.add('hidden');
  $('#drawer-overlay').classList.add('hidden');
}
$$('.railbtn').forEach(b => b.addEventListener('click', () => openDrawer(b.dataset.drawer)));
$('#drawer-close').addEventListener('click', closeDrawer);
$('#drawer-overlay').addEventListener('click', closeDrawer);

// ============================================================
//  Tutoriel
// ============================================================
const TUTO = [
  { icon: '🥚', title: 'Bienvenue dans Veilborn !', text: "Tu eleves des creatures appelees Glumps : fais-les eclore, grandir, evoluer, et complete ton Glumpdex de 300 Glumps. Tu demarres avec ton starter.", view: 'box' },
  { icon: '📦', title: 'Collection', text: "Voici tous tes Glumps. Tu peux les renommer, les relacher contre de l'essence, ou les faire evoluer (bouton vert) quand ils sont adultes.", view: 'box' },
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
