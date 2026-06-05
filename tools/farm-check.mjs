// Verifie que le farming idle progresse encore apres l'optimisation de /state.
const BASE = 'http://localhost:3899';
let cookie = '';
async function call(path, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null) };
}
const u = 'farm_' + Math.floor(Math.random() * 1e7);
await call('/api/register', { method: 'POST', body: { username: u, password: 'pw123456', starter: 'flammkit' } });
const s0 = (await call('/api/state')).data;
const e0 = s0.user.essence;
const rate = s0.essencePerSec;
console.log('essence initiale =', e0, '| essencePerSec =', rate, '| creatures =', s0.creatures.length);
console.log('le starter farme ?', s0.creatures[0]?.farming, 'biome=', s0.creatures[0]?.biome);
const waitS = 28; // 0.04/s * 28s = ~1.12 -> franchit l'entier malgre l'arrondi inferieur
await new Promise(r => setTimeout(r, waitS * 1000));
const s1 = (await call('/api/state')).data;
const e1 = s1.user.essence;
console.log(`essence apres ${waitS}s =`, e1, '(gain =', (e1 - e0) + ')');
const okGrow = e1 > e0;
const okRate = rate > 0;
console.log(okGrow ? '✓ farming progresse' : '✗ FARMING CASSE (essence ne monte pas)');
console.log(okRate ? '✓ essencePerSec > 0' : '✗ taux nul');
// verifie la coherence des champs essentiels du state
const okShape = s1.user && Array.isArray(s1.creatures) && Array.isArray(s1.biomes) && Array.isArray(s1.exploreZones) && typeof s1.serverTime === 'number';
console.log(okShape ? '✓ forme du state intacte' : '✗ forme du state cassee');
process.exit(okGrow && okRate && okShape ? 0 : 1);
