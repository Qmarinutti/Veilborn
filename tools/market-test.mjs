// Test E2E de l'Hotel des Ventes : flux complet + anti-dupe (achat concurrent).
const BASE = 'http://localhost:3899';
let pass = 0, fail = 0; const fails = [];
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; fails.push(l); console.log('  ✗ ' + l); } };
function mk() { let ck = ''; return async (p, o = {}) => { const h = { 'content-type': 'application/json' }; if (ck) h.cookie = ck; const r = await fetch(BASE + p, { method: o.method || 'GET', headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json().catch(() => null) }; }; }
async function reg(name, st) { const c = mk(); await c('/api/register', { method: 'POST', body: { username: name, password: 'pw123456', starter: st } }); return c; }
const sx = Math.floor(Math.random() * 1e7);
const seller = await reg('mk_sell_' + sx, 'flammkit');
const buyer = await reg('mk_buy_' + sx, 'aquolet');
const buyer2 = await reg('mk_buy2_' + sx, 'sprouty');

const ess = async c => (await c('/api/state')).data.user.essence;
const sellerCr = (await seller('/api/state')).data.creatures.find(c => c.stage === 'adult');
const sEss0 = await ess(seller), bEss0 = await ess(buyer);

console.log('=== Vente ===');
const list = await seller('/api/market/list', { method: 'POST', body: { creatureId: sellerCr.id, price: 100 } });
ok(list.status === 200, 'mise en vente OK (' + list.status + ' ' + JSON.stringify(list.data) + ')');
const sState = (await seller('/api/state')).data.creatures.find(c => c.id === sellerCr.id);
ok(sState.listed === true, 'le Glump est marque "en vente"');
ok(!sState.farming && !sState.biome, 'le Glump en vente ne farme plus');

console.log('=== Garde-fous (Glump en vente inutilisable) ===');
const relTry = await seller('/api/creature/release', { method: 'POST', body: { id: sellerCr.id } });
ok(relTry.status >= 400, 'impossible de relacher un Glump en vente (' + relTry.status + ')');
const farmTry = await seller('/api/biome/assign', { method: 'POST', body: { id: sellerCr.id } });
ok(farmTry.status >= 400, 'impossible de mettre au farm un Glump en vente (' + farmTry.status + ')');

console.log('=== Achat ===');
const market = (await buyer('/api/market')).data;
ok(market.listings.length >= 1, 'l\'annonce apparait dans le marche');
const listingId = market.listings.find(l => l.creature.id === sellerCr.id)?.id;
const selfBuy = await seller('/api/market/buy', { method: 'POST', body: { listingId } });
ok(selfBuy.status >= 400, 'impossible d\'acheter sa propre annonce (' + selfBuy.status + ')');

console.log('=== ANTI-DUPE : 2 acheteurs simultanes ===');
const [b1, b2] = await Promise.all([
  buyer('/api/market/buy', { method: 'POST', body: { listingId } }),
  buyer2('/api/market/buy', { method: 'POST', body: { listingId } }),
]);
const wins = [b1, b2].filter(r => r.status === 200).length;
ok(wins === 1, `exactement UN acheteur gagne (gagnants=${wins})`);

// Verifs finales
const sCreatures = (await seller('/api/state')).data.creatures;
ok(!sCreatures.some(c => c.id === sellerCr.id), 'le vendeur n\'a plus le Glump');
const b1Has = (await buyer('/api/state')).data.creatures.some(c => c.id === sellerCr.id);
const b2Has = (await buyer2('/api/state')).data.creatures.some(c => c.id === sellerCr.id);
ok((b1Has ? 1 : 0) + (b2Has ? 1 : 0) === 1, 'le Glump existe chez UN SEUL acheteur (pas de dupe)');

const sEss1 = await ess(seller);
ok(Math.round(sEss1 - sEss0) >= 90 && Math.round(sEss1 - sEss0) <= 96, `vendeur credite de 95 (prix 100 - 5% taxe) : +${Math.round(sEss1 - sEss0)}`);
// l'acheteur perdant doit etre rembourse (essence ~ inchangee), le gagnant a paye 100
const bEss1 = await ess(buyer), b2Ess1 = await ess(buyer2);
console.log(`  acheteur1 delta=${Math.round(bEss1 - bEss0)}  acheteur2 delta=${Math.round(b2Ess1 - bEss0)}`);
const totalPaid = Math.max(0, Math.round(bEss0 - bEss1)) + Math.max(0, Math.round(bEss0 - b2Ess1));
ok(totalPaid >= 95 && totalPaid <= 105, `un seul acheteur a paye ~100, l'autre rembourse (total paye=${totalPaid})`);

console.log('\n========================================');
console.log(`RESULTAT MARCHE: ${pass} OK, ${fail} ECHEC`);
if (fails.length) fails.forEach(f => console.log('  - ' + f));
process.exit(fail > 0 ? 1 : 0);
