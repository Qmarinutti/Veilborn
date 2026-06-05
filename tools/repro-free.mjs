// Reproduit le bug "depenses gratuites" : on depense (bonbons) PENDANT que des
// polls /state tournent en concurrence. Si /state ecrase l'essence -> depense effacee.
const BASE = 'http://localhost:3899';
let cookie = '';
async function call(path, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null) };
}
const u = 'repro_' + Math.floor(Math.random() * 1e7);
await call('/api/register', { method: 'POST', body: { username: u, password: 'pw123456', starter: 'flammkit' } });

let st = (await call('/api/state')).data;
const adult = st.creatures.find(c => c.stage === 'adult');
let totalSpent = 0, totalOkCandies = 0;
const startEssence = st.user.essence;
console.log('essence depart =', startEssence);

// Plusieurs rounds : a chaque round, on tire des bonbons EN MEME TEMPS que des polls /state.
for (let round = 0; round < 8; round++) {
  st = (await call('/api/state')).data;
  const before = st.user.essence;
  if (before < 60) break;
  const nCandy = Math.min(3, Math.floor(before / 60));
  const pollsBefore = [call('/api/state'), call('/api/state'), call('/api/state')];
  const candyJobs = [];
  for (let i = 0; i < nCandy; i++) candyJobs.push(call('/api/creature/candy', { method: 'POST', body: { id: adult.id } }));
  const pollsAfter = [call('/api/state'), call('/api/state'), call('/api/state')];
  // tout concurrent : les polls recouvrent les depenses
  const [, candyResults] = await Promise.all([
    Promise.all([...pollsBefore, ...pollsAfter]),
    Promise.all(candyJobs),
  ]);
  const okC = candyResults.filter(r => r.status === 200).length;
  totalOkCandies += okC; totalSpent += okC * 60;
}

// Essence finale (apres stabilisation)
await new Promise(r => setTimeout(r, 500));
const finalEssence = (await call('/api/state')).data.user.essence;
console.log(`bonbons reussis = ${totalOkCandies} -> devraient couter ${totalSpent} essence`);
console.log(`essence finale = ${finalEssence}`);
// Sans bug : finalEssence ~= startEssence - totalSpent (+ petit farm). Avec bug : finalEssence reste haute.
const expectedMax = startEssence - totalSpent + 50; // +50 marge farm
if (finalEssence > expectedMax) {
  console.log(`\n🔴 BUG CONFIRME : ${totalOkCandies} bonbons appliques mais l'essence n'a pas ete debitee`);
  console.log(`   (essence finale ${finalEssence} > attendu max ${expectedMax}) -> DEPENSES GRATUITES`);
  process.exit(1);
} else {
  console.log(`\n✅ Pas de bug : l'essence a bien ete debitee (${finalEssence} <= ${expectedMax})`);
  process.exit(0);
}
