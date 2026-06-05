// Test E2E complet de Veilborn. Lance contre un serveur local.
// node tools/e2e.mjs   (serveur sur PORT 3899)
const BASE = 'http://localhost:3899';
let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; fails.push(label); console.log('  ✗ ' + label); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// Petit client avec cookies par "compte"
function makeClient() {
  let cookie = '';
  return async function call(path, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    const r = await fetch(BASE + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  };
}

async function register(name) {
  const c = makeClient();
  // Choisir un starter au hasard
  const st = (await c('/api/starters')).data.starters[0];
  const r = await c('/api/register', { method: 'POST', body: { username: name, password: 'pw123456', starter: st.id } });
  return { c, reg: r };
}

const A = await register('e2e_alice_' + Math.floor(Math.random() * 1e6));
const B = await register('e2e_bob_' + Math.floor(Math.random() * 1e6));

section('Inscription / login');
ok(A.reg.status === 200, 'register alice 200 (got ' + A.reg.status + ' ' + JSON.stringify(A.reg.data) + ')');
ok(A.reg.data?.ok === true, 'register renvoie ok:true');

let st = (await A.c('/api/state')).data;
ok(st?.user, 'state.user present');
ok(Array.isArray(st?.creatures), 'state.creatures est un tableau');
ok(st.creatures.length >= 1, 'alice a au moins 1 creature (starter)');
ok(typeof st.user.essence === 'number', 'essence numerique = ' + st.user?.essence);

section('Boutique / oeufs');
const shop = (await A.c('/api/shop')).data;
ok(shop?.eggs || shop?.items || shop, 'shop repond');
// Acheter un oeuf basique si possible
const buyEgg = await A.c('/api/shop/buy-egg', { method: 'POST', body: { tier: 'basic' } });
ok(buyEgg.status === 200 || buyEgg.status === 400, 'buy-egg repond (' + buyEgg.status + ' ' + JSON.stringify(buyEgg.data) + ')');

section('Candy / niveau');
st = (await A.c('/api/state')).data;
const starter = st.creatures.find(c => c.stage === 'adult') || st.creatures[0];
ok(starter, 'trouve une creature');
let candyErr = null, lvlBefore = starter.level;
// donner plein d'essence via candy plusieurs fois
let candyOk = 0;
for (let i = 0; i < 3; i++) {
  const r = await A.c('/api/creature/candy', { method: 'POST', body: { id: starter.id } });
  if (r.status === 200) { candyOk++; ok(typeof r.data.cost === 'number', 'candy renvoie cost'); ok(r.data.creature, 'candy renvoie creature'); }
  else candyErr = r.data;
}
ok(candyOk >= 1 || candyErr, 'candy fonctionne ou erreur essence (' + JSON.stringify(candyErr) + ')');

section('Biomes');
const ba = await A.c('/api/biome/active', { method: 'POST', body: { biome: 'volcan' } });
ok(ba.status === 200 || ba.status === 400, 'biome/active repond (' + ba.status + ' ' + JSON.stringify(ba.data) + ')');
const baBad = await A.c('/api/biome/active', { method: 'POST', body: { biome: 'PASUNBIOME' } });
ok(baBad.status >= 400, 'biome/active rejette biome invalide (' + baBad.status + ')');

section('Exploration');
const exBad = await A.c('/api/explore/start', { method: 'POST', body: { biome: 'volcan', tier: 'facile', team: [] } });
ok(exBad.status >= 400, 'explore/start rejette team vide (' + exBad.status + ' ' + JSON.stringify(exBad.data) + ')');
const exBad2 = await A.c('/api/explore/start', { method: 'POST', body: { biome: 'volcan', tier: 'facile', team: [999999] } });
ok(exBad2.status >= 400, 'explore/start rejette creature inexistante (' + exBad2.status + ')');

section('PvP');
const opp = await A.c('/api/pvp/opponent');
ok(opp.status === 200 || opp.status === 404 || opp.status === 400, 'pvp/opponent repond (' + opp.status + ')');

section('Trade / echange');
const tl = await A.c('/api/trade/list');
ok(tl.status === 200, 'trade/list 200');
const tBad = await A.c('/api/trade/propose', { method: 'POST', body: { creatureId: 999999, wantType: 'Feu' } });
ok(tBad.status >= 400, 'trade/propose rejette creature inexistante (' + tBad.status + ')');

section('Progression / daily / dex');
const prog = await A.c('/api/progress');
ok(prog.status === 200, 'progress 200');
const daily = await A.c('/api/daily/claim', { method: 'POST', body: { id: 'nope' } });
ok(daily.status >= 400 || daily.status === 200, 'daily/claim repond (' + daily.status + ')');

section('Leaderboard / social');
const lb = await A.c('/api/leaderboard');
ok(lb.status === 200 && Array.isArray(lb.data?.board), 'leaderboard 200 + tableau');
const social = await A.c('/api/social');
ok(social.status === 200, 'social 200');

section('Sécurité / auth');
const anon = makeClient();
const noauth = await anon('/api/state');
ok(noauth.status === 401, 'state sans auth -> 401 (got ' + noauth.status + ')');
const dupReg = await A.c('/api/register', { method: 'POST', body: { username: 'x', password: 'y' } });
ok(dupReg.status >= 400, 'register sans starter/court -> erreur (' + dupReg.status + ')');

console.log('\n========================================');
console.log(`RESULTAT: ${pass} OK, ${fail} ECHEC`);
if (fails.length) { console.log('Echecs:'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
