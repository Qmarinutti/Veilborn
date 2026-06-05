// Verifie le systeme de paliers dex count-based + migration de l'ancien index.
//  setup : cree un user avec 80 decouvertes et dex_claimed=3 (ANCIEN index = a reclame 10/25/50).
//  Puis on reclame en HTTP : doit donner 75 puis 100, puis echouer (150 non atteint a 80).
import { run, get, initDb } from '../server/db.js';
import { hashPassword, createSession } from '../server/auth.js';
import { dexClaimedCount } from '../server/progress.js';
import { SPECIES_IDS } from '../server/game.js';

if (process.argv[2] === 'setup') {
  await initDb();
  const now = Date.now();
  const { hash, salt } = await hashPassword('pw');
  const uname = 'dex_' + Math.floor(now % 1e7);
  const { lastInsertRowid } = await run(
    'INSERT INTO users (username, pass_hash, pass_salt, essence, incubator_slots, prairie_slots, breeding_cells, dex_claimed, last_tick, last_login_day, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [uname, hash, salt, 0, 2, 4, 1, 3, now, new Date(now).toISOString().slice(0,10), now]); // dex_claimed=3 (ANCIEN index)
  const uid = Number(lastInsertRowid);
  // 80 decouvertes (variant 0)
  for (let i = 0; i < 80; i++) {
    await run('INSERT OR IGNORE INTO discoveries (user_id, species, variant) VALUES (?,?,0)', [uid, SPECIES_IDS[i]]);
  }
  console.log('migration dex_claimed 3 (index) ->', dexClaimedCount({ dex_claimed: 3 }), '(attendu 50)');
  const token = await createSession(uid);
  console.log('TOKEN', token);
  process.exit(0);
}
