// Mesure le DEBIT MAX de /state cote serveur, avec un cout client minimal
// (1 compte, C connexions en boucle serree). Isole la capacite du serveur.
// Usage: CONC=40 SECONDS=10 node tools/throughput.mjs
import http from 'node:http';
const HOST = process.env.HOST || '127.0.0.1', PORT = +(process.env.PORT || 3899);
const CONC = +(process.env.CONC || 40), SECONDS = +(process.env.SECONDS || 10);
const agent = new http.Agent({ keepAlive: true, maxSockets: CONC + 5 });
const cookie = { c: '' };
function req(method, path, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (cookie.c) headers.cookie = cookie.c;
    if (payload) headers['content-length'] = Buffer.byteLength(payload);
    const t0 = performance.now();
    const r = http.request({ host: HOST, port: PORT, path, method, agent, headers }, (res) => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => {
        const sc = res.headers['set-cookie']; if (sc) cookie.c = String(sc[0]).split(';')[0];
        resolve({ code: res.statusCode, ms: performance.now() - t0 });
      });
    });
    r.on('error', () => resolve({ code: 0, ms: performance.now() - t0 }));
    if (payload) r.write(payload); r.end();
  });
}
const name = 'tp_' + Math.floor(Math.random() * 1e9).toString(36);
await req('POST', '/api/register', { username: name, password: 'pw123456', starter: 'flammkit' });
let n = 0, errs = 0; const lats = [];
let stop = false;
async function worker() { while (!stop) { const r = await req('GET', '/api/state', null); n++; if (r.code !== 200) errs++; else lats.push(r.ms); } }
const t0 = performance.now();
const ws = Array.from({ length: CONC }, worker);
await new Promise(r => setTimeout(r, SECONDS * 1000));
stop = true; await Promise.allSettled(ws);
const secs = (performance.now() - t0) / 1000;
lats.sort((a, b) => a - b);
const pct = p => lats[Math.min(lats.length - 1, Math.floor(p / 100 * lats.length))] || 0;
console.log(`\n=== DEBIT /state (${CONC} connexions, ${secs.toFixed(1)}s) ===`);
console.log(`  ${(n / secs).toFixed(0)} req/s   p50=${pct(50).toFixed(1)}ms p95=${pct(95).toFixed(1)}ms p99=${pct(99).toFixed(1)}ms  erreurs=${errs}`);
console.log(`  -> a 1 poll / 4s par joueur, ca fait ~${Math.round(n / secs * 4)} joueurs/instance sur le chemin /state`);
process.exit(0);
