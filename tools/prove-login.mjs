// Prouve que le bonus de connexion n'est credite qu'UNE fois meme avec des /state concurrents.
import { get, run, initDb } from '../server/db.js';
import { getPlayerState } from '../server/state.js';
import { hashPassword } from '../server/auth.js';

await initDb();
const now = Date.now();
const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
const { hash, salt } = hashPassword('pw');
const uname = 'login_' + Math.floor(now % 1e7);
const { lastInsertRowid } = await run(
  'INSERT INTO users (username, pass_hash, pass_salt, essence, incubator_slots, prairie_slots, breeding_cells, login_streak, last_login_day, last_tick, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  [uname, hash, salt, 0, 2, 4, 1, 0, yesterday, now, now]); // pas de creature -> pas de farm, essence = bonus seul
const uid = Number(lastInsertRowid);

// Deux requetes /state SIMULTANEES le 1er jour (chacune son snapshot, comme deux vrais polls).
const snap1 = await get('SELECT * FROM users WHERE id = ?', [uid]);
const snap2 = await get('SELECT * FROM users WHERE id = ?', [uid]);
await Promise.all([getPlayerState(snap1), getPlayerState(snap2)]);

const ess = Math.round((await get('SELECT essence FROM users WHERE id = ?', [uid])).essence);
console.log('essence apres 2 /state concurrents le 1er jour =', ess, '(bonus attendu = 50, une seule fois)');
if (ess <= 60) {
  console.log('✅ FIX OK : bonus de connexion credite une seule fois.');
  process.exit(0);
} else {
  console.log(`🔴 BUG : bonus credite plusieurs fois (${ess} essence) -> essence gratuite.`);
  process.exit(1);
}
