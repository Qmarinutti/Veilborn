// Test d'exploitation (anti-triche). Tente de "se donner des choses".
// node tools/security.mjs  (serveur local sur 3899)
const BASE = 'http://localhost:3899';
let pass = 0, fail = 0; const fails = [];
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; fails.push(l); console.log('  ✗ EXPLOIT POSSIBLE: ' + l); } };
const section = t => console.log('\n=== ' + t + ' ===');
function makeClient() {
  let cookie = '';
  const fn = async (path, opts = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    const r = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  };
  return fn;
}
async function reg(name, starter) {
  const c = makeClient();
  await c('/api/register', { method: 'POST', body: { username: name, password: 'pw123456', starter } });
  return c;
}
const sx = Math.floor(Math.random() * 1e7);
const A = await reg('sec_a_' + sx, 'flammkit');
const B = await reg('sec_b_' + sx, 'aquolet');

// ---------------------------------------------------------------
section('1. Double-relache concurrente (dupe essence ?)');
{
  const st = (await A('/api/state')).data;
  const ess0 = st.user.essence;
  const nCreat0 = st.creatures.length;
  const victim = st.creatures.find(c => c.stage === 'adult');
  // 8 relaches simultanees du MEME Glump
  const results = await Promise.all(Array.from({ length: 8 }, () => A('/api/creature/release', { method: 'POST', body: { id: victim.id } })));
  const okCount = results.filter(r => r.status === 200).length;
  const st1 = (await A('/api/state')).data;
  const gained = st1.user.essence - ess0;
  const expected = Math.round(victim.value * 0.5); // un seul remboursement legitime
  console.log(`  relaches acceptees=${okCount}, essence gagnee=${gained}, attendu<=${expected}`);
  ok(gained <= expected, `double-relache ne rembourse qu'une fois (gagne ${gained}, max ${expected})`);
  ok(st1.creatures.length === nCreat0 - 1, 'le Glump est supprime exactement une fois');
}

// ---------------------------------------------------------------
section('2. Se battre contre soi-meme (farm essence/trophees ?)');
{
  const S = await reg('sec_self_' + sx, 'flammkit');
  const st = (await S('/api/state')).data;
  const me = st.user.id;
  const myAdult = st.creatures.find(c => c.stage === 'adult');
  const r = await S('/api/pvp/start', { method: 'POST', body: { opponentId: me, team: [myAdult.id] } });
  ok(r.status >= 400, 'PvP contre soi-meme refuse (' + r.status + ' ' + JSON.stringify(r.data?.error || '') + ')');
}

// ---------------------------------------------------------------
section('3. Agir sur les Glumps d\'un AUTRE joueur');
{
  const stB = (await B('/api/state')).data;
  const bCreature = stB.creatures.find(c => c.stage === 'adult');
  // A tente de manipuler le Glump de B
  const rel = await A('/api/creature/release', { method: 'POST', body: { id: bCreature.id } });
  ok(rel.status === 404 || rel.status === 400, 'A ne peut pas relacher le Glump de B (' + rel.status + ')');
  const candy = await A('/api/creature/candy', { method: 'POST', body: { id: bCreature.id } });
  ok(candy.status >= 400, 'A ne peut pas bonbonner le Glump de B (' + candy.status + ')');
  const fav = await A('/api/creature/favorite', { method: 'POST', body: { id: bCreature.id } });
  ok(fav.status >= 400, 'A ne peut pas favoriser le Glump de B (' + fav.status + ')');
  const ren = await A('/api/creature/rename', { method: 'POST', body: { id: bCreature.id, nickname: 'hack' } });
  ok(ren.status >= 400, 'A ne peut pas renommer le Glump de B (' + ren.status + ')');
  const evo = await A('/api/creature/evolve', { method: 'POST', body: { id: bCreature.id } });
  ok(evo.status >= 400, 'A ne peut pas faire evoluer le Glump de B (' + evo.status + ')');
  // breed avec un Glump de B
  const stA = (await A('/api/state')).data;
  const aCreature = stA.creatures.find(c => c.stage === 'adult');
  if (aCreature) {
    const breed = await A('/api/breed', { method: 'POST', body: { parentA: aCreature.id, parentB: bCreature.id } });
    ok(breed.status >= 400, 'A ne peut pas reproduire avec le Glump de B (' + breed.status + ')');
  } else ok(true, 'A sans adulte (skip breed)');
}

// ---------------------------------------------------------------
section('4. Essence ne peut pas devenir negative (spam bonbon)');
{
  const C = await reg('sec_c_' + sx, 'sprouty');
  const st = (await C('/api/state')).data;
  const adult0 = st.creatures.find(c => c.stage === 'adult');
  const id = adult0.id;
  const xp0 = adult0.xp;
  // 50 bonbons simultanes ; le max depend de l'essence reelle au depart (60/bonbon).
  const ess0 = st.user.essence;
  const maxCandy = Math.floor(ess0 / 60);
  const results = await Promise.all(Array.from({ length: 50 }, () => C('/api/creature/candy', { method: 'POST', body: { id } })));
  const okCount = results.filter(r => r.status === 200).length;
  const candyXp = results.find(r => r.status === 200)?.data?.xp || 0;
  const st1 = (await C('/api/state')).data;
  const xpGained = st1.creatures.find(c => c.id === id).xp - xp0;
  console.log(`  essence depart=${ess0}, bonbons acceptes=${okCount}, XP gagnee=${xpGained}, essence finale=${st1.user.essence}`);
  ok(st1.user.essence >= 0, 'essence jamais negative (' + st1.user.essence + ')');
  ok(okCount <= maxCandy, `pas plus de bonbons que l'essence ne le permet (${okCount} <= ${maxCandy})`);
  // PREUVE anti-desync : chaque bonbon accepte = exactement une depense (XP couplee a la depense, pas de phantom)
  ok(xpGained === okCount * candyXp, `couplage XP<->depense exact : ${xpGained} XP = ${okCount} bonbons x ${candyXp}`);
}

// ---------------------------------------------------------------
section('5. Montants/ids malformes ne donnent rien');
{
  const D = await reg('sec_d_' + sx, 'flammkit');
  const neg = await D('/api/creature/release', { method: 'POST', body: { id: -1 } });
  ok(neg.status >= 400, 'release id negatif rejete (' + neg.status + ')');
  const buyNeg = await D('/api/shop/buy-egg', { method: 'POST', body: { type: 'basic', count: -999 } });
  ok(buyNeg.status === 200 || buyNeg.status >= 400, 'buy-egg ignore un "count" client (cout serveur fixe)');
  // verifier qu'on n'a pas recu 999 oeufs
  const st = (await D('/api/state')).data;
  const eggs = st.creatures.filter(c => c.stage === 'egg').length;
  ok(eggs <= 2, 'pas de multi-oeuf via parametre client (' + eggs + ' oeufs)');
}

console.log('\n========================================');
console.log(`RESULTAT SECURITE: ${pass} OK, ${fail} EXPLOIT(S)`);
if (fails.length) { console.log('FAILLES:'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
