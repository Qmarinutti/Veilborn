// Verifie qu'un /breed REUSSI fonctionne apres le refactor (verrou + progressDaily hors verrou).
// Usage: node tools/breed-check.mjs setup   (cree user+2 adultes+session, imprime TOKEN id1 id2)
//        node tools/breed-check.mjs breed TOKEN id1 id2   (appelle /breed en HTTP)
import { run, get, initDb } from '../server/db.js';
import { hashPassword, createSession } from '../server/auth.js';

const mode = process.argv[2];
if (mode === 'setup') {
  await initDb();
  const now = Date.now();
  const { hash, salt } = hashPassword('pw');
  const uname = 'breed_' + Math.floor(now % 1e7);
  const { lastInsertRowid } = await run(
    'INSERT INTO users (username, pass_hash, pass_salt, essence, incubator_slots, prairie_slots, breeding_cells, daily_json, last_tick, last_login_day, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [uname, hash, salt, 1000, 2, 4, 1, null, now, new Date(now).toISOString().slice(0,10), now]);
  const uid = Number(lastInsertRowid);
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const r = await run("INSERT INTO creatures (owner_id, species, stage, gene_force, gene_vita, gene_speed, variant, nature, xp, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [uid, 'flammkit', 'adult', 20, 20, 20, 0, 'Equilibre', 0, now + i]);
    ids.push(Number(r.lastInsertRowid));
  }
  const token = await createSession(uid);
  console.log(token, ids[0], ids[1]);
  process.exit(0);
}
