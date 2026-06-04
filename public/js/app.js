// ---------- Client Veilborn ----------
import { creatureSVG, creatureVisual } from './sprites.js?v=12';
import { sfx, initAudioOnGesture, audioSettings } from './audio.js?v=1';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// Demarre l'audio (musique + sons) au 1er clic/touche.
initAudioOnGesture();

// Son de clic global sur les boutons (delegation).
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button, .navbtn, .railbtn, [data-pick], [data-id], .shop-tab, .tab');
  if (b && !b.disabled) sfx.click();
}, true);

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

// Toast ephemere (succes ou erreur) — remplace les alert() moches.
function flash(msg, type = 'ok') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'toast' + (type === 'err' ? ' err' : '');
  t.textContent = msg;
  void t.offsetWidth; // relance l'animation
  t.classList.add('show');
  (type === 'err' ? sfx.error : sfx.success)();
  clearTimeout(flash._t);
  flash._t = setTimeout(() => t.classList.remove('show'), type === 'err' ? 3200 : 2600);
}

// Jolie boite de confirmation (remplace confirm()). Renvoie une Promise<boolean>.
function confirmDialog(message) {
  return new Promise((resolve) => {
    $('#confirm-text').textContent = message;
    $('#confirm-modal').classList.remove('hidden');
    $('#confirm-overlay').classList.remove('hidden');
    const yes = $('#confirm-yes'), no = $('#confirm-no'), ov = $('#confirm-overlay');
    const done = (val) => {
      $('#confirm-modal').classList.add('hidden');
      $('#confirm-overlay').classList.add('hidden');
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      ov.removeEventListener('click', onNo);
      resolve(val);
    };
    const onYes = () => done(true);
    const onNo = () => done(false);
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    ov.addEventListener('click', onNo);
  });
}

// Banniere de succes debloque (en haut de l'ecran, avec son).
function achievementToast(a) {
  if (!a) return;
  const el = document.createElement('div');
  el.className = 'ach-toast';
  el.innerHTML = `<div class="ach-ic">${a.icon}</div><div><div class="ach-h">Succes debloque !</div><div class="ach-n">${a.name}</div></div>`;
  document.body.appendChild(el);
  sfx.success();
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3600);
}
function processNewAch(r) { (r?.newAch || []).forEach(achievementToast); }

// Jolie saisie de texte (remplace prompt()). Renvoie Promise<string|null>.
function promptDialog(message, value = '', placeholder = '') {
  return new Promise((resolve) => {
    $('#confirm-text').textContent = message;
    const wrap = document.createElement('div');
    wrap.className = 'prompt-input-wrap';
    wrap.innerHTML = `<input id="prompt-input" type="text" maxlength="20" placeholder="${placeholder}" />`;
    $('#confirm-text').after(wrap);
    const input = wrap.querySelector('#prompt-input');
    input.value = value;
    $('#confirm-yes').textContent = 'Valider';
    $('#confirm-modal').classList.remove('hidden');
    $('#confirm-overlay').classList.remove('hidden');
    setTimeout(() => input.focus(), 30);
    const yes = $('#confirm-yes'), no = $('#confirm-no'), ov = $('#confirm-overlay');
    const done = (val) => {
      $('#confirm-modal').classList.add('hidden');
      $('#confirm-overlay').classList.add('hidden');
      $('#confirm-yes').textContent = 'Confirmer';
      wrap.remove();
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      ov.removeEventListener('click', onNo);
      input.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onYes = () => done(input.value.trim());
    const onNo = () => done(null);
    const onKey = (e) => { if (e.key === 'Enter') onYes(); if (e.key === 'Escape') onNo(); };
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    ov.addEventListener('click', onNo);
    input.addEventListener('keydown', onKey);
  });
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
  cancelAnimationFrame(tickRAF); tickRAF = 0;
  stopPrairie();
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
  if (view === 'arena') loadArena();
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
    const cr = { species: id, speciesName: sp.name, color: sp.color, type: sp.type, rarity: sp.tier ?? sp.rarity, shape: sp.shape, hasArt: sp.hasArt, line: sp.line, variant: shiny ? 1 : 0 };
    html += `<div class="dexmon ${locked ? 'locked' : ''}" data-rarity="${sp.tier ?? sp.rarity}">
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
  cancelAnimationFrame(tickRAF);
  tickRAF = requestAnimationFrame(tickLoop); // animation des comptes a rebours + essence
  if (!localStorage.getItem('veilborn_tuto')) showTuto(0); // tuto au 1er passage
}

async function refresh() {
  try {
    STATE = await api('/state');
    SERVER_SKEW = STATE.serverTime - Date.now();
    $('#who').textContent = STATE.user.username;
    const sw = $('#settings-who'); if (sw) sw.textContent = STATE.user.username;
    renderAll();
    // Bonus de connexion quotidien (une fois par jour) + succes nouvellement debloques.
    if (STATE.loginBonus > 0) flash(`Bonus du jour : +${STATE.loginBonus} ✨ (serie ${STATE.user.loginStreak} 🔥)`);
    for (const a of (STATE.newAchievements || [])) achievementToast(a);
  } catch (err) {
    // session expiree -> retour login
    clearInterval(pollTimer);
    $('#game-screen').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
  }
}

function serverNow() { return Date.now() + SERVER_SKEW; }

// Boucle locale fluide (essence qui monte, comptes a rebours).
let tickRAF = 0;
function tickLoop() {
  if (STATE) {
    // estimation locale de l'essence + ressources entre deux refresh
    const dt = (serverNow() - STATE.serverTime) / 1000;
    $('#essence').textContent = Math.floor(STATE.user.essence + STATE.essencePerSec * dt).toLocaleString('fr-FR');
    const rate = STATE.resourcePerSec || {}, res = STATE.user.resources || {};
    for (const k in rate) {
      const el = document.getElementById('res-' + k);
      if (el) el.textContent = Math.floor((res[k] || 0) + (rate[k] || 0) * dt).toLocaleString('fr-FR');
    }
    updateCountdowns();
  }
  tickRAF = requestAnimationFrame(tickLoop);
}

// ============================================================
//  Rendu
// ============================================================
const RES_EMOJI = { magma: '🌋', ecume: '🌊', spores: '🍃', sable: '🏜️', orage: '⚡', eclat: '🔮' };
const RES_NAME = { magma: 'Magma', ecume: 'Écume', spores: 'Spores', sable: 'Sable', orage: 'Orage', eclat: 'Éclat' };

function renderAll() {
  $('#rate').textContent = '+' + (STATE.essencePerSec * 60).toFixed(1) + '/min';
  renderResbar();
  renderIncubators();
  renderBreedingCells();
  renderCollection();
  updateNavBadges();
  if (prairieActive) { renderBiomeTabs(); buildMeadow(); renderPrairieSlots(); }
}

// Barre des ressources de biome (en plus de l'essence dans la topbar).
function renderResbar() {
  const res = STATE.user.resources || {};
  const rate = STATE.resourcePerSec || {};
  const keys = Object.keys(RES_EMOJI).filter(k => (res[k] > 0 || (rate[k] || 0) > 0));
  $('#resbar').innerHTML = keys.map(k =>
    `<span class="res" title="${RES_NAME[k]} (+${((rate[k] || 0) * 60).toFixed(1)}/min)">${RES_EMOJI[k]} <b id="res-${k}">${Math.floor(res[k] || 0)}</b></span>`).join('');
}

// Pastilles de notification sur les onglets (actions a faire).
function updateNavBadges() {
  const now = serverNow();
  const eggsReady = STATE.creatures.filter(c => c.stage === 'egg' && !c.fromBreeding && (c.readyAt - now) <= 0).length;
  const bredReady = STATE.creatures.filter(c => c.stage === 'egg' && c.fromBreeding && (c.readyAt - now) <= 0).length;
  const canEvolve = STATE.creatures.filter(c => c.stage === 'adult' && c.canEvolve).length;
  const setBadge = (view, n) => {
    const btn = document.querySelector(`.navbtn[data-view="${view}"]`);
    if (!btn) return;
    let b = btn.querySelector('.nav-badge');
    if (n > 0) {
      if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; btn.appendChild(b); }
      b.textContent = n > 9 ? '9+' : n;
    } else if (b) b.remove();
  };
  setBadge('eggs', eggsReady);
  setBadge('breed', bredReady);
  setBadge('box', canEvolve);
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
    <div class="egg-prog"><i data-egg-bar="${egg.id}" data-total="${egg.totalMs || 0}"></i></div>
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
        <div class="breed-mid"><div class="breed-egg">🥚</div><div class="countdown" data-ready="${egg.readyAt}"></div>
          <div class="egg-prog"><i data-egg-bar="${egg.id}" data-total="${egg.totalMs || 0}"></i></div></div>
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
  // Cellule a debloquer, juste en dessous (jusqu'au max de 5).
  if (STATE.user.nextCellCost != null) {
    html += `<div class="breed-cell unlock" data-buy-cell="1">
      <span class="unlock-lock">🔒</span>
      <span>Débloquer une cellule</span>
      <span class="unlock-cost">✨ ${STATE.user.nextCellCost.toLocaleString('fr-FR')}</span>
    </div>`;
  }
  $('#breeding-cells').innerHTML = html;
}

$('#breeding-cells').addEventListener('click', async (e) => {
  const slot = e.target.closest('[data-pick-parent]');
  const doBreed = e.target.closest('#do-breed');
  const buyCell = e.target.closest('[data-buy-cell]');
  if (buyCell) {
    if (!await confirmDialog(`Débloquer une cellule de reproduction pour ${STATE.user.nextCellCost.toLocaleString('fr-FR')} essence ?`)) return;
    try { const r = await api('/breeding/buy-cell', { method: 'POST' }); flash(`Cellule débloquée (-${r.cost} ✨)`); await refresh(); }
    catch (err) { flash(err.message, "err"); }
    return;
  }
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
      const r = await api('/breed', { method: 'POST', body: { parentA: breedSelA, parentB: breedSelB } });
      breedSelA = null; breedSelB = null;
      msg.textContent = 'Œuf en couvaison dans la cellule ! 🥚'; msg.classList.add('ok');
      await refresh(); processNewAch(r);
    } catch (err) { msg.textContent = err.message; msg.classList.add('err'); }
  }
});

const collFilter = { search: '', type: '', sort: 'recent', favOnly: false };
let collSelectMode = false;
const collSelected = new Set();

function renderCollection() {
  let owned = STATE.creatures.filter(c => c.stage !== 'egg');
  $('#coll-count').textContent = owned.length;

  // Remplit la liste des types une seule fois (depuis les Glumps possedes + connus).
  const typeSel = $('#coll-type');
  if (typeSel && typeSel.options.length <= 1) {
    const types = [...new Set(STATE.creatures.map(c => c.type))].filter(Boolean).sort();
    typeSel.insertAdjacentHTML('beforeend', types.map(t => `<option value="${t}">${t}</option>`).join(''));
  }

  // Filtres
  const q = collFilter.search.trim().toLowerCase();
  if (q) owned = owned.filter(c => (c.nickname || '').toLowerCase().includes(q) || c.speciesName.toLowerCase().includes(q) || c.type.toLowerCase().includes(q));
  if (collFilter.type) owned = owned.filter(c => c.type === collFilter.type);
  if (collFilter.favOnly) owned = owned.filter(c => c.favorite);

  // Tri
  const cmp = {
    recent: (a, b) => b.id - a.id,
    value: (a, b) => b.value - a.value,
    level: (a, b) => (b.level || 0) - (a.level || 0),
    rarity: (a, b) => b.rarity - a.rarity || b.value - a.value,
    name: (a, b) => (a.nickname || a.speciesName).localeCompare(b.nickname || b.speciesName),
  }[collFilter.sort] || ((a, b) => b.id - a.id);
  owned.sort(cmp);

  $('#collection').innerHTML = owned.map(c => cardHtml(c, collSelectMode)).join('') ||
    '<p class="hint">Aucun Glump ne correspond.</p>';
  $('#collection').classList.toggle('selecting', collSelectMode);
}

function cardHtml(c, selecting = false) {
  const baby = c.stage === 'baby';
  const badges = [];
  if (c.variant) badges.push('<span class="badge shiny">SHINY</span>');
  if (baby) badges.push('<span class="badge baby">Bebe</span>');
  if (c.fainted) badges.push('<span class="badge ko">KO</span>');
  const evo = (c.stage === 'adult' && c.evolvesTo)
    ? (c.canEvolve
        ? `<button class="btn small evo" data-evolve="${c.id}">⬆ Evoluer → ${c.evolvesToName} (✨${c.evolveCost})</button>`
        : `<button class="btn small evo" disabled>⬆ ${c.evolvesToName} · Niv ${c.evolveLevel}</button>`)
    : '';
  const xpPct = Math.min(100, Math.round(100 * (c.xpInto || 0) / (c.xpNext || 1)));
  const hpPct = Math.round(100 * (c.hp ?? c.maxHp) / (c.maxHp || 1));
  const sel = selecting && collSelected.has(c.id);
  return `<div class="card ${c.fainted ? 'fainted' : ''} ${c.favorite ? 'fav' : ''} ${sel ? 'sel' : ''}" data-id="${c.id}" data-rarity="${c.rarity}">
    ${selecting ? `<span class="sel-check">${sel ? '✅' : '⬜'}</span>` : ''}
    ${badges.join('')}
    <span class="badge lvl">Niv ${c.level || 1}</span>
    <button class="fav-btn ${c.favorite ? 'on' : ''}" data-fav="${c.id}" title="Favori (verrou)">${c.favorite ? '💚' : '🤍'}</button>
    ${avatar(c)}
    <div class="rarity-dots">${RARITY_DOTS(c.rarity)}</div>
    <div class="name">${c.nickname || c.speciesName}</div>
    <div class="sub">${c.type} · val. ${c.value}</div>
    <div class="stats">
      <span><b>${c.stats.force}</b>FOR</span>
      <span><b>${c.stats.vita}</b>VIT</span>
      <span><b>${c.stats.speed}</b>VIT.</span>
    </div>
    ${c.stage === 'adult' ? `<div class="hpbar" title="${c.hp ?? c.maxHp}/${c.maxHp} PV"><i style="width:${hpPct}%"></i></div>` : ''}
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
  // barres de progression des oeufs (la duree totale vient du serveur : data-total)
  $$('[data-egg-bar]').forEach(bar => {
    const total = Number(bar.dataset.total) || 0;
    const ready = Number(bar.closest('.incubator,.breed-mid')?.querySelector('[data-ready]')?.dataset.ready) || 0;
    if (!total || !ready) { bar.style.width = '0%'; return; }
    const rem = Math.max(0, ready - now);
    bar.style.width = Math.max(0, Math.min(100, 100 * (1 - rem / total))) + '%';
  });
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
  catch (err) { flash(err.message, "err"); }
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
  const hpPct = Math.round(100 * (c.hp ?? c.maxHp) / (c.maxHp || 1));
  const hpBlock = c.stage === 'adult' ? `
    <div class="detail-block"><div class="detail-lbl">Points de vie ${c.fainted ? '— <b style="color:var(--bad)">KO 💀</b>' : ''}</div>
      <div class="hpbar big"><i style="width:${hpPct}%"></i></div>
      <div class="detail-sub">${c.hp ?? c.maxHp}/${c.maxHp} PV${c.fainted ? ' — ranime-le avec un Rappel (boutique)' : c.hp < c.maxHp ? ' — soigne-le avec une Potion (boutique)' : ''}</div>
    </div>` : '';
  // Production de farm (par minute) + biome actuel.
  const curBiome = c.biome && (STATE.biomes || []).find(b => b.id === c.biome);
  const farmBlock = c.stage === 'adult' ? `
    <div class="detail-block"><div class="detail-lbl">Production</div>
      <div class="detail-sub"><b>+${c.farmPerMin} ${c.farmResEmoji}/min</b>${c.farmSynergy ? ' <span style="color:var(--gold)">⭐ synergie +25%</span>' : ''}
        ${curBiome ? `<br>Farme dans : <b>${curBiome.emoji} ${curBiome.name}</b>` : '<br>Pas assigné — place-le dans un biome (onglet 🗺️) pour farmer.'}</div>
    </div>` : '';
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
      <div class="detail-sub">${c.xpInto}/${c.xpNext} XP — ${c.inPrairie ? "gagne de l'XP en farmant 🗺️" : 'place-le dans un biome pour progresser'}</div>
      <button class="btn small primary candy" data-candy="${c.id}" style="margin-top:10px;width:100%;">🍬 Super Bonbon ✨60 (+120 XP)</button>
    </div>
    ${hpBlock}
    ${farmBlock}
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
    } catch (err) { flash(err.message, "err"); }
  } else if (evoBtn) {
    const id = Number(evoBtn.dataset.evolve);
    try {
      const r = await api('/creature/evolve', { method: 'POST', body: { id } });
      await refresh(); openDetail(id);
      flash(`✨ ${r.fromName} a evolue en ${r.creature.speciesName} !`);
    } catch (err) { flash(err.message, "err"); }
  }
});

// Barre d'outils de la collection (recherche / filtre / tri / favoris / selection).
$('#coll-search')?.addEventListener('input', (e) => { collFilter.search = e.target.value; renderCollection(); });
$('#coll-type')?.addEventListener('change', (e) => { collFilter.type = e.target.value; renderCollection(); });
$('#coll-sort')?.addEventListener('change', (e) => { collFilter.sort = e.target.value; renderCollection(); });
$('#coll-fav-only')?.addEventListener('click', () => {
  collFilter.favOnly = !collFilter.favOnly;
  $('#coll-fav-only').classList.toggle('on', collFilter.favOnly);
  $('#coll-fav-only').setAttribute('aria-pressed', String(collFilter.favOnly));
  renderCollection();
});
function setSelectMode(on) {
  collSelectMode = on; collSelected.clear();
  $('#coll-bulkbar').classList.toggle('hidden', !on);
  $('#coll-select').classList.toggle('on', on);
  updateSelCount(); renderCollection();
}
function updateSelCount() { $('#coll-selcount').textContent = `${collSelected.size} sélectionné(s)`; }
$('#coll-select')?.addEventListener('click', () => setSelectMode(!collSelectMode));
$('#coll-cancel-sel')?.addEventListener('click', () => setSelectMode(false));
$('#coll-release-sel')?.addEventListener('click', async () => {
  if (!collSelected.size) { flash('Rien de sélectionné.', 'err'); return; }
  if (!await confirmDialog(`Relâcher ${collSelected.size} Glump(s) ? (favoris ignorés)`)) return;
  try {
    const r = await api('/creature/release-many', { method: 'POST', body: { ids: [...collSelected] } });
    flash(`${r.released} relâché(s) · +${r.refund} ✨`);
    setSelectMode(false); await refresh();
  } catch (err) { flash(err.message, 'err'); }
});

$('#collection').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  // Mode selection : clic sur une carte = (de)selectionne (sauf bouton favori)
  if (collSelectMode && !(btn && btn.dataset.fav)) {
    const card = e.target.closest('.card');
    if (card) {
      const id = Number(card.dataset.id);
      if (collSelected.has(id)) collSelected.delete(id); else collSelected.add(id);
      updateSelCount(); renderCollection();
    }
    return;
  }
  if (!btn) { // clic sur la carte (hors bouton) -> fiche detaillee
    const card = e.target.closest('.card');
    if (card) openDetail(Number(card.dataset.id));
    return;
  }
  const rel = btn?.dataset.release;
  const ren = btn?.dataset.rename;
  const evo = btn?.dataset.evolve;
  const fav = btn?.dataset.fav;
  if (fav) {
    try { const r = await api('/creature/favorite', { method: 'POST', body: { id: Number(fav) } }); await refresh(); flash(r.favorite ? 'Ajoute aux favoris 💚' : 'Retire des favoris'); }
    catch (err) { flash(err.message, 'err'); }
    return;
  }
  if (evo) {
    const c = STATE.creatures.find(x => x.id === Number(evo));
    if (c && !await confirmDialog(`Faire evoluer ${c.nickname || c.speciesName} en ${c.evolvesToName} pour ${c.evolveCost} essence ?`)) return;
    try {
      const r = await api('/creature/evolve', { method: 'POST', body: { id: Number(evo) } });
      await refresh();
      flash(`✨ ${r.fromName} a evolue en ${r.creature.speciesName} !`); processNewAch(r);
    } catch (err) { flash(err.message, "err"); }
  } else if (rel) {
    if (!await confirmDialog('Relacher ce Glump contre de l\'essence ?')) return;
    try { await api('/creature/release', { method: 'POST', body: { id: Number(rel) } }); await refresh(); }
    catch (err) { flash(err.message, "err"); }
  } else if (ren) {
    const cur = STATE.creatures.find(x => x.id === Number(ren));
    const nickname = await promptDialog('Nouveau surnom (vide pour retirer) :', cur?.nickname || '', cur?.speciesName || '');
    if (nickname === null) return;
    try { await api('/creature/rename', { method: 'POST', body: { id: Number(ren), nickname } }); await refresh(); flash('Surnom mis a jour'); }
    catch (err) { flash(err.message, "err"); }
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
let currentBiome = 'plaine'; // biome selectionne dans la vue

function startPrairie() {
  prairieActive = true;
  renderBiomeTabs();
  buildMeadow();
  renderPrairieSlots();
  if (!prairieRAF) prairieRAF = requestAnimationFrame(prairieLoop);
}

// Onglets de biome (possedes = cliquables, verrouilles = vers la boutique).
function renderBiomeTabs() {
  if (!STATE) return;
  const biomes = STATE.biomes || [];
  if (!biomes.some(b => b.id === currentBiome && b.owned)) currentBiome = 'plaine';
  $('#biome-tabs').innerHTML = biomes.map(b => `
    <button class="biome-tab ${b.id === currentBiome ? 'sel' : ''} ${b.owned ? '' : 'locked'}" data-biome="${b.id}" data-owned="${b.owned ? 1 : 0}">
      <span class="bt-emoji">${b.emoji}</span>
      <span class="bt-name">${b.name}${b.owned ? '' : ' 🔒'}</span>
      <span class="bt-res">${b.owned ? '+' + (b.ratePerSec * 60).toFixed(1) + ' ' + b.resEmoji + '/min' : '✨' + b.cost.toLocaleString('fr-FR')}</span>
    </button>`).join('');
}
$('#biome-tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-biome]');
  if (!t) return;
  if (t.dataset.owned === '1') {
    currentBiome = t.dataset.biome;
    prairieIds = ''; // force la reconstruction du pre
    renderBiomeTabs(); buildMeadow(); renderPrairieSlots();
  } else {
    openShop(); switchShopTab('terrain');
  }
});
function stopPrairie() {
  prairieActive = false;
  if (prairieRAF) { cancelAnimationFrame(prairieRAF); prairieRAF = null; }
}

// Emplacements du biome courant (chips sous le pre) + infos + bouton acheter.
function renderPrairieSlots() {
  if (!STATE) return;
  const b = (STATE.biomes || []).find(x => x.id === currentBiome);
  const max = STATE.user.prairieSlots;
  const buyBtn = $('#buy-prairie');

  if (!b || !b.owned) {
    $('#prairie-info').textContent = '';
    buyBtn.style.display = 'none';
    $('#prairie-slots').innerHTML = `<div class="biome-locked">🔒 <b>${b ? b.name : 'Terrain'}</b> non débloqué — achète-le dans la boutique pour <b>✨ ${b ? b.cost.toLocaleString('fr-FR') : ''}</b>.<br>
      <button class="btn primary" id="goto-terrain" style="margin-top:10px;">🗺️ Débloquer dans la boutique</button></div>`;
    return;
  }
  buyBtn.style.display = '';
  const inB = STATE.creatures.filter(c => c.biome === currentBiome);
  $('#prairie-info').textContent = `${b.emoji} ${b.name} · ${inB.length}/${max} · +${(b.ratePerSec * 60).toFixed(1)} ${b.resEmoji}/min`;
  if (max >= 12) { buyBtn.disabled = true; buyBtn.textContent = 'Max'; }
  else { buyBtn.disabled = false; buyBtn.textContent = '+ Emplacement'; }

  let html = '';
  for (let i = 0; i < max; i++) {
    const c = inB[i];
    if (c) {
      const syn = b.types.includes(c.type);
      html += `<div class="slot ${syn ? 'syn' : ''}" title="${syn ? 'Synergie +25% !' : ''}">
        <div class="mini">${creatureVisual(c, 42)}</div>
        <span class="slot-name">${syn ? '⭐ ' : ''}${c.nickname || c.speciesName}</span>
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
  const pct = Math.round(100 * (c.hp ?? c.maxHp) / (c.maxHp || 1));
  return `<div class="card ${c.fainted ? 'fainted' : ''}" data-pick="${c.id}" data-rarity="${c.rarity}">
    ${avatar(c)}
    <div class="name">${c.nickname || c.speciesName}</div>
    <div class="sub">${c.fainted ? '💀 KO' : c.type + ' · P' + c.power}</div>
    <div class="hpbar"><i style="width:${pct}%"></i></div>
  </div>`;
}

$('#buy-prairie').addEventListener('click', async () => {
  try { const r = await api('/prairie/buy', { method: 'POST' }); flash(`Emplacement achete (-${r.cost} ✨)`); await refresh(); }
  catch (err) { flash(err.message, "err"); }
});
$('#prairie-slots').addEventListener('click', async (e) => {
  const rm = e.target.dataset.prairieRm;
  const add = e.target.closest('[data-prairie-add]');
  const goto = e.target.closest('#goto-terrain');
  if (goto) { openShop(); switchShopTab('terrain'); return; }
  if (rm) {
    try { await api('/biome/remove', { method: 'POST', body: { id: Number(rm) } }); await refresh(); }
    catch (err) { flash(err.message, "err"); }
  } else if (add) {
    const b = (STATE.biomes || []).find(x => x.id === currentBiome);
    const avail = STATE.creatures.filter(c => c.stage === 'adult' && c.biome !== currentBiome);
    if (!avail.length) { flash('Aucun Glump adulte disponible.', 'err'); return; }
    openPicker(`Assigner au ${b?.name || 'biome'} ${b?.emoji || ''}`, avail, pickBiomeCardHtml, async (id) => {
      try { await api('/biome/assign', { method: 'POST', body: { id, biome: currentBiome } }); closePicker(); await refresh(); flash(`Assigné au ${b?.name} ${b?.emoji || ''}`); }
      catch (err) { flash(err.message, "err"); }
    });
  }
});
// Carte de selecteur qui indique la synergie avec le biome courant.
function pickBiomeCardHtml(c) {
  const b = (STATE.biomes || []).find(x => x.id === currentBiome);
  const syn = b && b.types.includes(c.type);
  return `<div class="card" data-pick="${c.id}" data-rarity="${c.rarity}">
    ${avatar(c)}
    <div class="name">${syn ? '⭐ ' : ''}${c.nickname || c.speciesName}</div>
    <div class="sub">${c.type}${syn ? ' · +25% !' : ''}${c.biome ? ' · déjà placé' : ''}</div>
  </div>`;
}
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
  const list = STATE.creatures.filter(c => c.biome === currentBiome); // Glumps du biome courant
  const sig = currentBiome + '|' + list.map(c => c.id + c.stage).join(',');
  if (sig === prairieIds && critters.length) return; // rien de neuf
  prairieIds = sig;

  const m = $('#meadow');
  m.className = 'meadow biome-' + currentBiome;
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
    // On retournera UNIQUEMENT le sprite (1er enfant), pas le label (sinon le nom s'ecrit a l'envers).
    return { el, spriteEl: el.firstElementChild, x, y, tx: x, ty: y, size, speed: (baby ? 0.5 : 0.35) + Math.random() * 0.25, facing: 1, pause: 0 };
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
    // on retourne SEULEMENT le sprite (le label garde son sens de lecture)
    if (c.spriteEl) c.spriteEl.style.transform = `scaleX(${c.facing})`;
  }
  prairieRAF = requestAnimationFrame(prairieLoop);
}

// ============================================================
//  Drawer lateral : evenements / boutique / reglages
// ============================================================
const DRAWER_TITLES = { progress: '🏅 Progression', shop: '🛒 Boutique', settings: '⚙️ Reglages', social: '👥 Social' };
function openDrawer(type) {
  $('#drawer-title').textContent = DRAWER_TITLES[type] || '';
  $$('.drawer-section').forEach(s => s.classList.add('hidden'));
  const sec = $('#drawer-' + type);
  if (sec) sec.classList.remove('hidden');
  if (type === 'social') loadSocial();
  if (type === 'settings') syncAudioToggles();
  if (type === 'progress') loadProgress();
  $('#drawer').classList.remove('hidden');
  $('#drawer-overlay').classList.remove('hidden');
}

// ---------- Progression : quetes du jour, paliers dex, succes ----------
async function loadProgress() {
  let p;
  try { p = await api('/progress'); } catch { return; }
  $('#prog-streak').innerHTML = `🔥 Série de connexion : <b>${p.streak} jour${p.streak > 1 ? 's' : ''}</b>`;
  // Quetes du jour
  $('#prog-daily').innerHTML = p.daily.quests.map(q => {
    const pct = Math.min(100, Math.round(100 * q.progress / q.goal));
    const action = q.claimed
      ? `<span class="q-claimed">✓ Reçu</span>`
      : q.done
        ? `<button class="btn small primary" data-claim-daily="${q.id}">Récupérer</button>`
        : `<span class="q-prog">${q.progress}/${q.goal}</span>`;
    return `<div class="quest ${q.done ? 'done' : ''}">
      <div class="q-ic">${q.icon}</div>
      <div class="q-main">
        <div class="q-text">${q.text}</div>
        <div class="q-reward">🎁 Récompense : <b>+${q.reward} ✨</b></div>
        <div class="q-bar"><i style="width:${pct}%"></i></div>
      </div>
      <div class="q-act">${action}</div>
    </div>`;
  }).join('');
  // Paliers dex
  $('#prog-dex').innerHTML = `<div class="dex-prog-head">${p.dex.discovered}/${p.dex.total} espèces découvertes</div>` +
    p.dex.milestones.map(m => {
      const reward = `✨${m.essence.toLocaleString('fr-FR')}${m.prairie ? ' +🌳' : ''}${m.cell ? ' +💞' : ''}`;
      const state = m.claimed ? `<span class="q-claimed">✓</span>`
        : m.claimable ? `<button class="btn small primary" data-claim-dex="${m.count}">Récupérer</button>`
        : `<span class="q-prog">${p.dex.discovered}/${m.count}</span>`;
      return `<div class="quest ${m.reached ? 'done' : ''}">
        <div class="q-ic">${m.count >= p.dex.total ? '👑' : '📖'}</div>
        <div class="q-main"><div class="q-text">${m.count} espèces — ${reward}</div></div>
        <div class="q-act">${state}</div>
      </div>`;
    }).join('');
  // Succes
  $('#prog-ach').innerHTML = p.achievements.map(a => `
    <div class="ach ${a.unlocked ? 'on' : ''}" title="${a.desc}">
      <div class="ach-icon">${a.unlocked ? a.icon : '🔒'}</div>
      <div class="ach-name">${a.name}</div>
    </div>`).join('');
}
$('#drawer-progress')?.addEventListener('click', async (e) => {
  const cd = e.target.closest('[data-claim-daily]');
  const cx = e.target.closest('[data-claim-dex]');
  if (cd) {
    try { const r = await api('/daily/claim', { method: 'POST', body: { id: cd.dataset.claimDaily } }); flash(`Quête terminée : +${r.reward} ✨`); await refresh(); loadProgress(); }
    catch (err) { flash(err.message, 'err'); }
  } else if (cx) {
    try { const r = await api('/dex/claim', { method: 'POST', body: { count: Number(cx.dataset.claimDex) } }); flash(`Palier réclamé : +${r.essence} ✨ ${r.extra || ''}`); await refresh(); loadProgress(); }
    catch (err) { flash(err.message, 'err'); }
  }
});

// ---------- Reglages audio (sons + musique) ----------
function syncAudioToggles() {
  $('#toggle-sfx')?.classList.toggle('on', audioSettings.sfx);
  $('#toggle-music')?.classList.toggle('on', audioSettings.music);
}
$('#toggle-sfx')?.addEventListener('click', () => {
  const on = audioSettings.toggleSfx();
  $('#toggle-sfx').classList.toggle('on', on);
  flash(on ? 'Sons actives 🔊' : 'Sons coupes 🔇');
});
$('#toggle-music')?.addEventListener('click', () => {
  const on = audioSettings.toggleMusic();
  $('#toggle-music').classList.toggle('on', on);
  flash(on ? 'Musique activee 🎵' : 'Musique coupee 🔇');
});

// ---------- Social : amis & code ami ----------
async function loadSocial() {
  try {
    const { code, friends } = await api('/social');
    $('#my-code').textContent = code;
    $('#friends-count').textContent = friends.length;
    $('#friends-list').innerHTML = friends.map(f => `
      <div class="friend-row">
        <span class="friend-name">${f.username}</span>
        <button class="btn small" data-trade-friend="${f.id}" data-name="${f.username}">🔄</button>
        <button class="btn small" data-visit-friend="${f.id}" data-name="${f.username}">Visiter</button>
        <button class="btn small" data-remove-friend="${f.id}">✕</button>
      </div>`).join('') || '<p class="hint">Aucun ami pour l\'instant. Ajoute un code !</p>';
    loadTrades();
  } catch (err) { $('#friends-list').innerHTML = `<p class="hint">${err.message}</p>`; }
}

async function loadTrades() {
  try {
    const { incoming, outgoing } = await api('/trade/list');
    const row = (t, dir) => {
      const c = t.creature;
      const who = dir === 'in' ? t.fromName : t.toName;
      const sprite = c ? creatureVisual(c, 40) : '❔';
      const name = c ? (c.nickname || c.speciesName) : '???';
      const act = dir === 'in'
        ? `<button class="btn small primary" data-trade-accept="${t.id}">Accepter</button>
           <button class="btn small" data-trade-cancel="${t.id}">Refuser</button>`
        : `<button class="btn small" data-trade-cancel="${t.id}">Annuler</button>`;
      return `<div class="trade-row">
        <div class="trade-sprite">${sprite}</div>
        <div class="trade-info"><b>${name}</b><span>${dir === 'in' ? 'de ' + who : 'à ' + who}</span></div>
        <div class="trade-act">${act}</div>
      </div>`;
    };
    const html = [...incoming.map(t => row(t, 'in')), ...outgoing.map(t => row(t, 'out'))].join('');
    $('#trades-list').innerHTML = html || '<p class="hint">Aucun échange en cours. Clique sur 🔄 à côté d\'un ami pour proposer un Glump.</p>';
  } catch { $('#trades-list').innerHTML = ''; }
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
  const trade = e.target.closest('[data-trade-friend]');
  if (trade) {
    const toUser = Number(trade.dataset.tradeFriend);
    const mine = STATE.creatures.filter(c => c.stage !== 'egg' && !c.favorite);
    if (!mine.length) { flash('Aucun Glump échangeable (les favoris sont verrouillés).', 'err'); return; }
    openPicker(`Proposer un Glump à ${trade.dataset.name}`, mine, pickCardHtml, async (id) => {
      try { await api('/trade/propose', { method: 'POST', body: { toUser, creatureId: id } }); closePicker(); flash('Proposition envoyée 🔄'); loadTrades(); }
      catch (err) { flash(err.message, 'err'); }
    });
  } else if (visit) {
    closeDrawer();
    visitFarm(Number(visit.dataset.visitFriend), visit.dataset.name);
  } else if (rem) {
    if (!await confirmDialog('Retirer cet ami ?')) return;
    try { await api('/social/remove', { method: 'POST', body: { friendId: Number(rem.dataset.removeFriend) } }); loadSocial(); }
    catch (err) { flash(err.message, "err"); }
  }
});
$('#trades-list').addEventListener('click', async (e) => {
  const acc = e.target.closest('[data-trade-accept]');
  const can = e.target.closest('[data-trade-cancel]');
  if (acc) {
    const mine = STATE.creatures.filter(c => c.stage !== 'egg' && !c.favorite);
    if (!mine.length) { flash('Aucun Glump à offrir en retour.', 'err'); return; }
    openPicker('Offrir lequel en retour ?', mine, pickCardHtml, async (id) => {
      try { const r = await api('/trade/accept', { method: 'POST', body: { id: Number(acc.dataset.tradeAccept), creatureId: id } }); closePicker(); flash(`Échange réussi ! Reçu : ${r.received.speciesName} 🎉`); await refresh(); loadSocial(); }
      catch (err) { flash(err.message, 'err'); }
    });
  } else if (can) {
    try { await api('/trade/cancel', { method: 'POST', body: { id: Number(can.dataset.tradeCancel) } }); loadTrades(); }
    catch (err) { flash(err.message, 'err'); }
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
  else if (tab === 'terrain') renderShopTerrain();
  else if (tab === 'item') renderShopItem();
  else if (tab === 'bonus') renderShopBonus();
}
function renderShopEgg() {
  const res = STATE?.user?.resources || {};
  const owned = new Set((STATE?.biomes || []).filter(b => b.owned).map(b => b.id));
  const cost = shopData.typeEggCost || 200;
  let html = `<p class="hint">🥚 <b>Basique</b> = bébé aléatoire (essence). Œuf <b>typé</b> = payé avec la ressource de son biome (farme dans le biome !). Il faut un incubateur libre.</p>
    <button class="shop-egg-tile basic" data-buy-egg-type="basic">
      <span class="shop-egg-emoji">🥚</span><span class="shop-egg-name">Basique</span>
      <span class="shop-egg-price">✨ ${shopData.eggPrice}</span></button>
    <div class="shop-grid">`;
  html += shopData.elements.map(t => {
    const biomeId = (shopData.biomeOfType || {})[t];
    const b = (shopData.biomes || []).find(x => x.id === biomeId) || {};
    const have = res[b.resource] || 0;
    const isOwned = owned.has(biomeId);
    const enough = have >= cost;
    const ok = isOwned && enough;
    return `<button class="shop-egg-tile ${ok ? '' : 'dim'}" data-buy-egg-type="${t}" ${ok ? '' : 'disabled'}
        title="${!isOwned ? 'Débloque le ' + (b.name || 'biome') : !enough ? 'Pas assez de ' + (b.resName || '') : ''}">
      <span class="shop-egg-emoji">${TYPE_EMOJI[t] || '🥚'}</span>
      <span class="shop-egg-name">${t}</span>
      <span class="shop-egg-price">${b.resEmoji || ''} ${cost}${!isOwned ? ' 🔒' : ''}</span>
    </button>`;
  }).join('') + `</div>`;
  $('#shop-egg').innerHTML = html;
}
function renderShopTerrain() {
  const owned = new Set((STATE?.biomes || []).filter(b => b.owned).map(b => b.id));
  $('#shop-terrain').innerHTML = `<p class="hint">Achète un biome pour y <b>farmer sa ressource</b> et acheter ses œufs typés. Un Glump du bon type y gagne <b>+25%</b> de production.</p>` +
    (shopData.biomes || []).filter(b => b.id !== 'plaine').map(b => {
      const own = owned.has(b.id);
      return `<div class="shop-item">
        <div class="shop-egg">${b.emoji}</div>
        <div class="shop-info"><div class="shop-name">${b.name} ${b.resEmoji}</div>
          <div class="shop-sub">Produit ${b.resName} · types : ${b.types.join(', ')}</div></div>
        ${own ? '<span class="q-claimed">✓ Possédé</span>' : `<button class="btn small primary" data-buy-terrain="${b.id}">✨ ${b.cost.toLocaleString('fr-FR')}</button>`}
      </div>`;
    }).join('');
}
function renderShopItem() {
  const c = shopData.candy || {}, po = shopData.potion || {}, rv = shopData.revive || {};
  $('#shop-item').innerHTML = `
    <div class="shop-item">
      <div class="shop-egg">🍬</div>
      <div class="shop-info"><div class="shop-name">Super Bonbon</div><div class="shop-sub">+${c.xp} XP à un Glump</div></div>
      <button class="btn small primary" id="buy-candy">✨ ${c.cost}</button>
    </div>
    <div class="shop-item">
      <div class="shop-egg">❤️</div>
      <div class="shop-info"><div class="shop-name">Potion</div><div class="shop-sub">Restaure tous les PV d'un Glump</div></div>
      <button class="btn small primary" id="buy-potion">✨ ${po.cost}</button>
    </div>
    <div class="shop-item">
      <div class="shop-egg">✨</div>
      <div class="shop-info"><div class="shop-name">Rappel</div><div class="shop-sub">Ranime un Glump KO (50% PV)</div></div>
      <button class="btn small primary" id="buy-revive">✨ ${rv.cost}</button>
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
  const terr = e.target.closest('[data-buy-terrain]');
  if (terr) {
    try { const r = await api('/biome/buy', { method: 'POST', body: { biome: terr.dataset.buyTerrain } }); flash('Terrain débloqué ! 🗺️'); await refresh(); renderShopTerrain(); renderShopEgg(); }
    catch (err) { flash(err.message, "err"); }
    return;
  }
  const eggTile = e.target.closest('[data-buy-egg-type]');
  if (eggTile) {
    const t = eggTile.dataset.buyEggType;
    try { const r = await api('/shop/buy-egg', { method: 'POST', body: { type: t } }); flash(`Œuf ${t === 'basic' ? 'basique' : t} acheté ! 🥚`); await refresh(); renderShopEgg(); processNewAch(r); }
    catch (err) { flash(err.message, "err"); }
    return;
  }
  if (e.target.closest('#buy-candy')) {
    const glumps = STATE.creatures.filter(c => c.stage !== 'egg');
    openPicker('Donner un Super Bonbon à…', glumps, pickCardHtml, async (id) => {
      try { const r = await api('/creature/candy', { method: 'POST', body: { id } }); closePicker(); await refresh(); flash(`+${r.xp} XP 🍬`); processNewAch(r); }
      catch (err) { flash(err.message, "err"); }
    });
    return;
  }
  if (e.target.closest('#buy-potion')) {
    const blesses = STATE.creatures.filter(c => c.stage === 'adult' && !c.fainted && c.hp < c.maxHp);
    if (!blesses.length) { flash('Aucun Glump blessé.', 'err'); return; }
    openPicker('Soigner quel Glump ?', blesses, pickCardHtml, async (id) => {
      try { await api('/heal/potion', { method: 'POST', body: { id } }); closePicker(); await refresh(); flash('PV restaurés ❤️'); }
      catch (err) { flash(err.message, "err"); }
    });
    return;
  }
  if (e.target.closest('#buy-revive')) {
    const kos = STATE.creatures.filter(c => c.fainted);
    if (!kos.length) { flash('Aucun Glump KO.', 'err'); return; }
    openPicker('Ranimer quel Glump ?', kos, pickCardHtml, async (id) => {
      try { await api('/heal/revive', { method: 'POST', body: { id } }); closePicker(); await refresh(); flash('Glump ranimé ✨'); }
      catch (err) { flash(err.message, "err"); }
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
      catch (err) { flash(err.message, "err"); }
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
  { icon: '🥚', title: 'Bienvenue dans Veilborn !', text: "Tu eleves des creatures appelees Glumps : fais-les eclore, grandir, evoluer, et complete ton Glumpdex de 300 Glumps. Tu demarres avec ton starter.", view: 'box', color: '#6c8cff' },
  { icon: '📦', title: 'Collection', text: "Voici tous tes Glumps. Clique sur l'un d'eux pour sa fiche (IV, stats, nature, PV). Tu peux les renommer, les relacher, ou les faire evoluer une fois le niveau requis atteint.", view: 'box', color: '#34e1c4' },
  { icon: '🥚', title: 'Oeufs', text: "Tes incubateurs. Un oeuf eclot avec le temps (meme hors-ligne !) en bebe, qui devient adulte. Achete des incubateurs pour en faire eclore plusieurs a la fois.", view: 'eggs', color: '#ffb347' },
  { icon: '💞', title: 'Reproduction', text: "Choisis deux Glumps adultes pour pondre un oeuf. L'enfant herite des genes des parents, avec une chance d'etre shiny ✨ ou d'une espece plus rare. Debloque des cellules pour reproduire en parallele.", view: 'breed', color: '#ff7bd5' },
  { icon: '🗺️', title: 'Biomes', text: "Assigne tes Glumps à un biome pour farmer sa ressource : la Plaine donne de l'essence ✨, le Volcan du magma 🌋, l'Océan de l'écume 🌊… Un Glump du BON type dans son biome gagne +25% ! Les ressources servent à acheter les œufs typés. Achète les terrains dans la boutique.", view: 'prairie', color: '#51d88a' },
  { icon: '📖', title: 'Glumpdex', text: "Les 300 Glumps numerotes, a la suite. Ceux que tu n'as pas encore eus sont en silhouette. Dex normal et dex chromatique ✨ separes. Objectif : tous les decouvrir !", view: 'dex', color: '#9a6cff' },
  { icon: '⚔️', title: 'Arene (PvP)', text: "Forme une equipe (3 Glumps) et combat au tour par tour : choisis tes attaques ! Frappe sure, deflagration risquee, ou inflige un statut (brulure, gel, poison, paralysie). Les types comptent. Un Glump KO le reste — Rappel + Potion en boutique.", view: 'arena', color: '#ff6b7d' },
  { icon: '👥', title: 'Rang & Social', text: "Compare la valeur de ta collection au classement (onglet Rang), ajoute des amis avec ton code ami (panneau Social 👥) et visite leurs elevages.", view: 'leaderboard', color: '#ffd34d' },
  { icon: '🚀', title: "C'est parti !", text: "L'essence monte toute seule tant que tu as des Glumps en prairie. Reviens faire eclore, reproduire, evoluer et combattre. Tu peux revoir ce tuto, couper les sons ou la musique dans Reglages ⚙️.", view: 'box', color: '#6c8cff' },
];
let tutoStep = 0;
function showTuto(step = 0) { tutoStep = step; renderTuto(); $('#tutorial').classList.remove('hidden'); $('#tuto-overlay').classList.remove('hidden'); }
function hideTuto() { $('#tutorial').classList.add('hidden'); $('#tuto-overlay').classList.add('hidden'); switchView('box'); try { localStorage.setItem('veilborn_tuto', '1'); } catch {} }
function renderTuto() {
  const s = TUTO[tutoStep];
  if (s.view) switchView(s.view); // on navigue en arriere-plan vers l'onglet decrit
  const card = $('#tutorial');
  const col = s.color || '#6c8cff';
  card.style.setProperty('--tuto-col', col);
  $('#tuto-icon').textContent = s.icon;
  $('#tuto-step').textContent = `Etape ${tutoStep + 1}/${TUTO.length}`;
  $('#tuto-title').textContent = s.title;
  $('#tuto-text').textContent = s.text;
  $('#tuto-bar').style.width = Math.round(((tutoStep + 1) / TUTO.length) * 100) + '%';
  $('#tuto-dots').innerHTML = TUTO.map((_, i) => `<span class="dot ${i === tutoStep ? 'on' : ''}"></span>`).join('');
  $('#tuto-prev').style.visibility = tutoStep === 0 ? 'hidden' : 'visible';
  $('#tuto-next').textContent = tutoStep === TUTO.length - 1 ? 'Terminer ✓' : 'Suivant →';
  // petite animation d'entree a chaque etape
  card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
  sfx.pop();
}
$('#tuto-next').addEventListener('click', () => { if (tutoStep < TUTO.length - 1) { tutoStep++; renderTuto(); } else hideTuto(); });
$('#tuto-prev').addEventListener('click', () => { if (tutoStep > 0) { tutoStep--; renderTuto(); } });
$('#tuto-skip').addEventListener('click', hideTuto);
$('#tuto-overlay').addEventListener('click', hideTuto);
$('#replay-tuto').addEventListener('click', () => { closeDrawer(); showTuto(0); });

// ============================================================
//  Arene (PvP)
// ============================================================
let pvpTeam = [];        // ids de mon equipe (max 3)
let pvpOpponent = null;
function savePvpTeam() { try { localStorage.setItem('veilborn_pvp', JSON.stringify(pvpTeam)); } catch {} }
function loadPvpTeam() { try { return JSON.parse(localStorage.getItem('veilborn_pvp') || '[]'); } catch { return []; } }

async function loadArena() {
  $('#pvp-trophies').textContent = `🏆 ${STATE.user.pvpTrophies}`;
  if (!pvpTeam.length) pvpTeam = loadPvpTeam(); // restaure l'equipe sauvegardee
  pvpTeam = pvpTeam.filter(id => STATE.creatures.some(c => c.id === id && c.stage === 'adult' && !c.fainted));
  savePvpTeam();
  renderArenaTeam();
  $('#pvp-opponent').innerHTML = '';
  pvpOpponent = null;
  loadPvpRanking();
}
function renderArenaTeam() {
  let html = '';
  for (let i = 0; i < 3; i++) {
    const c = pvpTeam[i] && STATE.creatures.find(x => x.id === pvpTeam[i]);
    html += c
      ? `<div class="pvp-slot filled" data-team-rm="${c.id}">${creatureVisual(c, 56)}<span>${c.nickname || c.speciesName}</span><b class="rm">✕</b></div>`
      : `<div class="pvp-slot empty" data-team-add="1"><div class="add">+</div><span>Glump</span></div>`;
  }
  $('#pvp-team').innerHTML = html;
}
$('#pvp-team').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-team-rm]');
  const add = e.target.closest('[data-team-add]');
  if (rm) { pvpTeam = pvpTeam.filter(id => id !== Number(rm.dataset.teamRm)); savePvpTeam(); renderArenaTeam(); }
  else if (add) {
    const avail = STATE.creatures.filter(c => c.stage === 'adult' && !pvpTeam.includes(c.id) && !c.fainted);
    if (!avail.length) { flash('Aucun Glump disponible (KO ?). Soigne-les en boutique.', 'err'); return; }
    openPicker('Ajouter à ton équipe', avail, pickCardHtml, (id) => {
      if (pvpTeam.length < 3 && !pvpTeam.includes(id)) pvpTeam.push(id);
      savePvpTeam(); closePicker(); renderArenaTeam();
    });
  }
});
function fighterMini(c) {
  return `<div class="fighter-mini" data-rarity="${c.rarity}">
    <div class="fm-sprite">${creatureVisual(c, 50)}</div>
    <div class="fm-name">${c.name || c.speciesName}</div>
    <div class="fm-lvl">Niv ${c.level} · P${c.power}</div>
  </div>`;
}
$('#pvp-find').addEventListener('click', async () => {
  try {
    pvpOpponent = await api('/pvp/opponent');
    $('#pvp-opponent').innerHTML = `
      <div class="opp-card">
        <div class="opp-head"><b>${pvpOpponent.username}</b> · 🏆 ${pvpOpponent.trophies}</div>
        <div class="opp-team">${pvpOpponent.team.map(fighterMini).join('')}</div>
        <button id="pvp-fight" class="btn primary" style="width:100%;margin-top:10px;">⚔️ Combattre !</button>
      </div>`;
  } catch (err) { $('#pvp-opponent').innerHTML = `<p class="hint">${err.message}</p>`; }
});
$('#pvp-opponent').addEventListener('click', async (e) => {
  if (!e.target.closest('#pvp-fight')) return;
  if (!pvpTeam.length) { flash("Compose ton équipe d'abord !", 'err'); return; }
  if (!pvpOpponent) return;
  try {
    const init = await api('/pvp/start', { method: 'POST', body: { opponentId: pvpOpponent.id, team: pvpTeam } });
    openBattle(init);
  } catch (err) { flash(err.message, 'err'); }
});
async function loadPvpRanking() {
  try {
    const { ranking } = await api('/pvp/ranking');
    const me = STATE?.user?.id;
    $('#pvp-ranking').innerHTML = ranking.map((r, i) => `
      <div class="rank-row ${r.id === me ? 'me' : ''}"><span class="rank-pos">${i + 1}</span><span class="rank-name">${r.username}</span><span class="rank-tr">🏆 ${r.trophies}</span></div>`).join('') || '<p class="hint">Personne au classement.</p>';
  } catch { $('#pvp-ranking').innerHTML = ''; }
}

// --- Combat tour-par-tour interactif ---
const STATUS_ICON = { burn: '🔥', poison: '🟣', para: '⚡', freeze: '❄️', weaken: '💀' };
let bState = null, bBusy = false;

function benchHtml(team, activeIdx) {
  return team.map((f, i) => i === activeIdx ? '' :
    `<span class="bench-dot ${f.hp <= 0 ? 'ko' : ''}" title="${f.name} ${f.hp}/${f.maxHp}">${f.hp <= 0 ? '✖' : '●'}</span>`).join('');
}
function bActiveHtml(f, id) {
  if (!f) return `<div class="b-fighter empty" id="${id}"></div>`;
  const pct = Math.round(100 * f.hp / (f.maxHp || 1));
  const st = f.status ? `<span class="bf-status">${STATUS_ICON[f.status] || ''}</span>` : '';
  return `<div class="b-fighter ${f.hp <= 0 ? 'ko' : ''}" id="${id}" data-rarity="${f.rarity}">
    <div class="bf-head"><span class="bf-name">${f.name}</span><span class="bf-lvl">Niv ${f.level}</span>${st}</div>
    <div class="bf-sprite">${creatureVisual(f, 96)}</div>
    <div class="bf-hpwrap"><div class="bf-hpbar"><i id="${id}-hp" style="width:${pct}%"></i></div>
      <span class="bf-hpval" id="${id}-val">${f.hp}/${f.maxHp}</span></div>
  </div>`;
}
function moveBtnsHtml(moves) {
  return moves.map(m => {
    const meta = m.kind === 'attack' ? `⚔ ${Math.round(m.power * 100)}%`
      : m.kind === 'status' ? `${STATUS_ICON[m.status] || ''} statut`
      : m.kind === 'heal' ? '💚 soin' : '🛡️ garde';
    return `<button class="mv-btn k-${m.kind}" data-move="${m.id}">
      <span class="mv-name">${m.name}</span>
      <span class="mv-meta">${meta} · ${Math.round(m.acc * 100)}%</span></button>`;
  }).join('');
}
function openBattle(init) {
  bState = init; bBusy = false;
  $('#battle-modal').classList.remove('hidden');
  $('#battle-overlay').classList.remove('hidden');
  $('#battle-result').classList.add('hidden');
  $('#battle-close').classList.add('hidden');
  $('#battle-title').textContent = `⚔️ vs ${init.oppName}`;
  renderBattle();
}
function renderBattle() {
  const s = bState;
  $('#b-opp-active').innerHTML = bActiveHtml(s.opp[s.activeOpp], 'b-opp');
  $('#b-me-active').innerHTML = bActiveHtml(s.me[s.activeMe], 'b-me');
  $('#b-opp-bench').innerHTML = benchHtml(s.opp, s.activeOpp);
  $('#b-me-bench').innerHTML = benchHtml(s.me, s.activeMe);
  $('#battle-moves').innerHTML = s.over ? '' : moveBtnsHtml(s.myMoves);
}
// Anime un PV : tween de la barre + popup chiffre.
function animateHp(side, hp, maxHp, popup, cls) {
  const bar = document.getElementById(`${side}-hp`);
  const val = document.getElementById(`${side}-val`);
  const card = document.getElementById(side);
  if (bar) bar.style.width = Math.max(0, Math.round(100 * hp / (maxHp || 1))) + '%';
  if (val) val.textContent = `${hp}/${maxHp}`;
  if (card && popup != null) {
    card.classList.add('hit'); setTimeout(() => card.classList.remove('hit'), 200);
    const d = document.createElement('div');
    d.className = 'dmg-pop ' + (cls || '');
    d.textContent = popup;
    card.appendChild(d); setTimeout(() => d.remove(), 700);
  }
}
function logBattle(msg) { $('#battle-log').textContent = msg; }

// Joue les events d'un tour sequentiellement, puis re-rend l'etat.
function animateEvents(events) {
  return new Promise((resolve) => {
    const s = bState;
    const maxOf = (side) => side === 'a' ? (s.me[s.activeMe]?.maxHp || 1) : (s.opp[s.activeOpp]?.maxHp || 1);
    const domOf = (side) => side === 'a' ? 'b-me' : 'b-opp';
    let i = 0;
    const next = () => {
      if (i >= events.length) return resolve();
      const ev = events[i++];
      let delay = 520;
      if (ev.t === 'hit') {
        const tgtSide = ev.side === 'a' ? 'b' : 'a';
        animateHp(domOf(tgtSide), ev.hp, maxOf(tgtSide), '-' + ev.dmg + (ev.crit ? ' CRIT' : ''), ev.crit ? 'crit' : ev.mult > 1 ? 'super' : ev.mult < 1 ? 'weak' : '');
        logBattle(`${ev.name} utilise ${ev.move}${ev.mult > 1 ? ' — efficace !' : ev.mult < 1 ? ' — peu efficace…' : ''}`);
        if (document.getElementById(domOf(ev.side))) { document.getElementById(domOf(ev.side)).classList.add('atk'); setTimeout(() => document.getElementById(domOf(ev.side))?.classList.remove('atk'), 180); }
      } else if (ev.t === 'miss') { logBattle(`${ev.name} rate ${ev.move} !`); delay = 420; }
      else if (ev.t === 'dot') { animateHp(domOf(ev.side), ev.hp, maxOf(ev.side), '-' + ev.dmg, 'dot'); logBattle(`${ev.name} souffre (${STATUS_ICON[ev.status] || ''}).`); }
      else if (ev.t === 'heal') { animateHp(domOf(ev.side), ev.hp, maxOf(ev.side), '+' + ev.amount, 'heal'); logBattle(`${ev.name} récupère des PV 💚.`); }
      else if (ev.t === 'status') { logBattle(`${ev.name} est affecté ${STATUS_ICON[ev.status] || ''} !`); delay = 460; }
      else if (ev.t === 'guard') { logBattle(`${ev.name} se met en garde 🛡️.`); delay = 380; }
      else if (ev.t === 'para') { logBattle(`${ev.name} est paralysé ⚡, il ne peut pas agir !`); }
      else if (ev.t === 'frozen') { logBattle(`${ev.name} est gelé ❄️ !`); }
      else if (ev.t === 'thaw') { logBattle(`${ev.name} dégèle !`); delay = 380; }
      else if (ev.t === 'cured') { logBattle(`${ev.name} récupère.`); delay = 360; }
      setTimeout(next, delay);
    };
    next();
  });
}
async function playMove(moveId) {
  if (bBusy || !bState || bState.over) return;
  bBusy = true;
  $('#battle-moves').innerHTML = '<div class="mv-wait">…</div>';
  try {
    const r = await api('/pvp/move', { method: 'POST', body: { battleId: bState.battleId, moveId } });
    await animateEvents(r.events);
    bState = r.state;
    renderBattle();
    if (r.result) finishBattle(r.result);
  } catch (err) { flash(err.message, 'err'); $('#battle-close').classList.remove('hidden'); }
  bBusy = false;
}
function finishBattle(result) {
  const win = result.winner === 'me';
  const rb = $('#battle-result');
  rb.className = 'battle-result ' + (win ? 'win' : 'lose');
  rb.innerHTML = `<div class="br-title">${win ? '🏆 Victoire !' : '💀 Défaite'}</div>
    <div class="br-rewards">${win ? `+${result.rewards.trophies} 🏆 · +${result.rewards.essence} ✨ · +${result.rewards.xp} XP` : `${result.rewards.trophies} 🏆 · +${result.rewards.xp} XP`}</div>`;
  rb.classList.remove('hidden');
  $('#battle-moves').innerHTML = '';
  $('#battle-close').classList.remove('hidden');
  logBattle(win ? 'Tu remportes le combat !' : 'Tu as perdu ce combat.');
  refresh().then(() => { loadArena(); });
  processNewAch(result);
}
$('#battle-moves').addEventListener('click', (e) => {
  const b = e.target.closest('[data-move]');
  if (b) playMove(b.dataset.move);
});
function closeBattle() { $('#battle-modal').classList.add('hidden'); $('#battle-overlay').classList.add('hidden'); bState = null; }
$('#battle-close').addEventListener('click', closeBattle);
$('#battle-overlay').addEventListener('click', () => { if (!$('#battle-close').classList.contains('hidden')) closeBattle(); });

// ============================================================
//  Demarrage
// ============================================================
(async function init() {
  try {
    const me = await api('/me');
    if (me.loggedIn) await enterGame();
  } catch { /* pas connecte */ }
})();
