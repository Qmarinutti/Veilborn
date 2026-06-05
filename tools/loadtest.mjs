// ============================================================
//  Test de charge Veilborn — simule N joueurs concurrents.
//  Usage:  PLAYERS=1000 DURATION=60 node tools/loadtest.mjs
//  Params (env): PLAYERS (def 1000), DURATION s de mesure (def 60),
//                RAMP s d'inscription progressive (def 20),
//                POLL_MS intervalle de poll /state (def 4000),
//                ACTION_PROB proba d'action par tick (def 0.15),
//                HOST (def 127.0.0.1), PORT (def 3899)
//  NB: client et serveur tournent sur la MEME machine ici -> ils se partagent le CPU.
//      Pour un chiffre "pur serveur", lancer le client depuis une autre machine.
//      Avec SQLite LOCAL, ce test reflete le chemin "replique embarquee" de prod
//      (lectures locales rapides) ; en prod Turso les ECRITURES sont + lentes (reseau).
// ============================================================
import http from 'node:http';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = +(process.env.PORT || 3899);
const PLAYERS = +(process.env.PLAYERS || 1000);
const DURATION = +(process.env.DURATION || 60);
const RAMP = +(process.env.RAMP || 20);
const POLL_MS = +(process.env.POLL_MS || 4000);
const ACTION_PROB = +(process.env.ACTION_PROB || 0.15);

const agent = new http.Agent({ keepAlive: true, maxSockets: PLAYERS + 100, maxFreeSockets: PLAYERS + 100 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const STARTERS = ['flammkit', 'aquolet', 'sprouty'];

// ---- metriques ----
const lat = { state: [], action: [], register: [] };
const codes = {};
let okC = 0, gameReject = 0, realErr = 0;   // 2xx / 4xx(attendu) / 5xx+reseau
let measuring = false, measWindowStart = 0, measReqs = 0;

function record(bucket, ms, code) {
  codes[code] = (codes[code] || 0) + 1;
  if (code === 0 || code >= 500) realErr++;
  else if (code >= 400) gameReject++;
  else okC++;
  if (measuring) { measReqs++; if (bucket !== 'register') lat[bucket].push(ms); }
  if (bucket === 'register') lat.register.push(ms);
}

function req(method, path, cookie, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (cookie.c) headers.cookie = cookie.c;
    if (payload) headers['content-length'] = Buffer.byteLength(payload);
    const t0 = performance.now();
    const r = http.request({ host: HOST, port: PORT, path, method, agent, headers }, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        const sc = res.headers['set-cookie'];
        if (sc) cookie.c = String(sc[0]).split(';')[0];
        let data = null; try { data = JSON.parse(buf); } catch {}
        resolve({ code: res.statusCode, data, ms: performance.now() - t0 });
      });
    });
    r.on('error', () => resolve({ code: 0, data: null, ms: performance.now() - t0 }));
    if (payload) r.write(payload);
    r.end();
  });
}

async function call(cookie, method, path, body, bucket) {
  const r = await req(method, path, cookie, body);
  record(bucket, r.ms, r.code);
  return r;
}

let stop = false;
let active = 0, regDone = 0;

async function player(i) {
  const cookie = { c: '' };
  const name = `lt${i}_${Math.floor(Math.random() * 1e9).toString(36)}`;
  const reg = await call(cookie, 'POST', '/api/register', { username: name, password: 'pw123456', starter: STARTERS[i % 3] }, 'register');
  regDone++;
  if (reg.code !== 200) return; // inscription ratee -> ce joueur ne participe pas
  active++;
  let myId = null;
  const st = await call(cookie, 'GET', '/api/state', null, 'state');
  if (st.data?.creatures) myId = st.data.creatures.find(c => c.stage === 'adult')?.id;
  while (!stop) {
    await sleep(POLL_MS * (0.7 + Math.random() * 0.6)); // jitter pour eviter le troupeau synchrone
    if (stop) break;
    await call(cookie, 'GET', '/api/state', null, 'state');
    if (Math.random() < ACTION_PROB) {
      const r = Math.random();
      if (r < 0.45 && myId) await call(cookie, 'POST', '/api/creature/candy', { id: myId }, 'action'); // ecriture atomique
      else if (r < 0.65) await call(cookie, 'POST', '/api/shop/buy-egg', { type: 'basic' }, 'action');   // ecriture SOUS VERROU
      else if (r < 0.85) await call(cookie, 'GET', '/api/pvp/opponent', null, 'action');                 // lecture lourde (JOIN)
      else await call(cookie, 'GET', '/api/progress', null, 'action');                                   // lecture daily/dex
    }
  }
}

function pct(arr, p) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }
function line(name, arr) {
  if (!arr.length) return `  ${name.padEnd(10)} (aucune)`;
  return `  ${name.padEnd(10)} n=${String(arr.length).padStart(6)}  p50=${pct(arr, 50).toFixed(1)}ms  p95=${pct(arr, 95).toFixed(1)}ms  p99=${pct(arr, 99).toFixed(1)}ms  max=${Math.max(...arr).toFixed(0)}ms`;
}

async function main() {
  console.log(`\n=== TEST DE CHARGE : ${PLAYERS} joueurs ===`);
  console.log(`cible ${HOST}:${PORT} · ramp ${RAMP}s · mesure ${DURATION}s · poll ${POLL_MS}ms · action ${(ACTION_PROB * 100)}%\n`);
  // sonde de dispo
  const probe = await req('GET', '/api/starters', { c: '' }, null);
  if (probe.code !== 200) { console.log(`❌ Serveur injoignable sur ${HOST}:${PORT} (code ${probe.code}). Lance-le d'abord.`); process.exit(1); }

  const tasks = [];
  for (let i = 0; i < PLAYERS; i++) {
    tasks.push((async () => { await sleep((i / PLAYERS) * RAMP * 1000); await player(i); })());
  }

  // progression live
  const ticker = setInterval(() => {
    const since = measuring ? (performance.now() - measWindowStart) / 1000 : 0;
    const rps = measuring && since > 0 ? (measReqs / since).toFixed(0) : '—';
    console.log(`  [${measuring ? 'MESURE' : 'ramp  '}] joueurs actifs=${active}  req/s=${rps}  p95(state)=${pct(lat.state, 95).toFixed(0)}ms  erreurs=${realErr}`);
  }, 5000);

  // Attend que TOUTES les inscriptions soient terminees (sinon le burst scrypt pollue la mesure).
  const regDeadline = performance.now() + (RAMP + 120) * 1000;
  while (regDone < PLAYERS && performance.now() < regDeadline) await sleep(500);
  await sleep(1500); // petit settle
  // demarre la fenetre de mesure (steady-state pur)
  lat.state.length = 0; lat.action.length = 0; measReqs = 0;
  measuring = true; measWindowStart = performance.now();
  console.log(`\n>>> Fenetre de MESURE demarree (${active}/${PLAYERS} joueurs actifs, ${regDone} inscriptions traitees)\n`);

  await sleep(DURATION * 1000);
  const measSecs = (performance.now() - measWindowStart) / 1000;
  stop = true;
  clearInterval(ticker);
  await Promise.allSettled(tasks);

  console.log(`\n========================================`);
  console.log(`RESULTAT (fenetre de mesure ${measSecs.toFixed(0)}s, ${active}/${PLAYERS} joueurs)`);
  console.log(`========================================`);
  console.log(`Debit          : ${(measReqs / measSecs).toFixed(0)} req/s`);
  console.log(`Latences (steady-state):`);
  console.log(line('/state', lat.state));
  console.log(line('actions', lat.action));
  console.log(`Inscription    :`);
  console.log(line('register', lat.register));
  console.log(`Resultats      : ${okC} OK · ${gameReject} rejets jeu (4xx attendus: plus d'essence...) · ${realErr} ERREURS REELLES (5xx/reseau)`);
  console.log(`Codes HTTP     : ${Object.entries(codes).map(([c, n]) => `${c}:${n}`).join('  ')}`);
  const p95 = pct(lat.state, 95);
  console.log(`\nVERDICT (subjectif): ${realErr === 0 && p95 < 150 ? '✅ tient bien (p95 ' + p95.toFixed(0) + 'ms, 0 erreur)' : realErr > 0 ? '⚠️ ' + realErr + ' erreurs reelles -> regarde lesquelles' : '⚠️ p95 ' + p95.toFixed(0) + 'ms eleve -> proche saturation'}`);
  console.log(`(Surveille aussi le CPU du process node serveur pendant le test.)`);
  process.exit(0);
}
main();
