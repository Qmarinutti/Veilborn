// Analyse READ-ONLY des vrais joueurs (Turso) pour un audit de satisfaction.
import { createClient } from '@libsql/client';
import { levelFromXp } from '../server/game.js';
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

const users = await q('SELECT * FROM users ORDER BY username');
const now = Date.now();
console.log('=== JOUEURS ===');
for (const u of users) {
  const cr = await q('SELECT stage, xp, variant, gene_force g1, gene_vita g2, gene_speed g3, species, biome FROM creatures WHERE owner_id=?', [u.id]);
  const adults = cr.filter(c => c.stage === 'adult');
  const maxLvl = cr.reduce((m, c) => Math.max(m, levelFromXp(c.xp || 0)), 0);
  const shinies = cr.filter(c => c.variant === 1).length;
  const perfect = cr.filter(c => c.g1 === 31 && c.g2 === 31 && c.g3 === 31).length;
  const has31 = cr.filter(c => c.g1 === 31 || c.g2 === 31 || c.g3 === 31).length;
  const farming = cr.filter(c => c.biome).length;
  const disc = (await q('SELECT COUNT(*) n FROM discoveries WHERE user_id=? AND variant=0', [u.id]))[0].n;
  const days = Math.floor((now - u.last_tick) / 86400000);
  let biomes = []; try { biomes = JSON.parse(u.biomes_json || '[]'); } catch {}
  let items = {}; try { items = JSON.parse(u.items_json || '{}'); } catch {}
  let res = {}; try { res = JSON.parse(u.resources_json || '{}'); } catch {}
  const exped = (() => { try { return JSON.parse(u.expeditions_json || '[]').length; } catch { return 0; } })();
  console.log(`\n${u.username}  (vu il y a ${days}j)`);
  console.log(`  essence=${Math.round(u.essence).toLocaleString('fr-FR')}  trophees=${u.pvp_trophies}  serie=${u.login_streak}j`);
  console.log(`  glumps=${cr.length} (adultes=${adults.length}, au farm=${farming})  niv max=${maxLvl}`);
  console.log(`  dex=${disc}/300  shinies=${shinies}  IV parfaits(31/31/31)=${perfect}  avec >=1 IV31=${has31}`);
  console.log(`  cellules=${u.breeding_cells} incub=${u.incubator_slots} prairie=${u.prairie_slots}  biomes achetes=${biomes.length}/6  explos en cours=${exped}`);
  console.log(`  ressources=${JSON.stringify(res)}  sac=${JSON.stringify(items)}`);
}
console.log('\n=== AGREGATS ===');
const totCr = (await q('SELECT COUNT(*) n FROM creatures'))[0].n;
const totTrades = (await q('SELECT COUNT(*) n, status FROM trades GROUP BY status')).map(r => `${r.status}:${r.n}`).join(' ');
const pvpActive = users.filter(u => u.pvp_trophies !== 1000).length;
console.log(`creatures totales: ${totCr}`);
console.log(`echanges: ${totTrades || 'aucun'}`);
console.log(`joueurs ayant touche au PvP (trophees != 1000): ${pvpActive}/${users.length}`);
process.exit(0);
