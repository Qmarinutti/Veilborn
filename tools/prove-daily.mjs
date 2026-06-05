// Prouve que progressDaily est bien serialise par le verrou partage (sinon /daily/claim
// pourrait se faire effacer son flag claimed=true -> recompense reclamable en boucle).
// Principe : on TIENT le verrou, on lance progressDaily, et on verifie qu'il ATTEND.
import { get, run, initDb } from '../server/db.js';
import { withLock } from '../server/lock.js';
import { progressDaily, todayStr } from '../server/progress.js';
import { hashPassword } from '../server/auth.js';

await initDb();
const now = Date.now();
const { hash, salt } = await hashPassword('pw');
const uname = 'daily_' + Math.floor(now % 1e7);
const daily = JSON.stringify({ day: todayStr(), quests: [{ id: 'candy3', progress: 3, claimed: false }] });
const { lastInsertRowid } = await run(
  'INSERT INTO users (username, pass_hash, pass_salt, essence, incubator_slots, prairie_slots, breeding_cells, daily_json, last_tick, last_login_day, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  [uname, hash, salt, 0, 2, 4, 1, daily, now, todayStr(), now]);
const uid = Number(lastInsertRowid);

let progressFinished = false;
// On TIENT le verrou et on observe si progressDaily (qui doit prendre le MEME verrou) attend.
const respectedLock = await withLock(uid, async () => {
  const p = progressDaily(uid, 'candy3', 1).then(() => { progressFinished = true; });
  // Simule le travail de /daily/claim sous verrou : pose claimed=true
  const u = await get('SELECT daily_json FROM users WHERE id = ?', [uid]);
  const data = JSON.parse(u.daily_json);
  data.quests.find(q => q.id === 'candy3').claimed = true;
  await new Promise(r => setTimeout(r, 60));
  await run('UPDATE users SET daily_json = ?, essence = essence + 150 WHERE id = ?', [JSON.stringify(data), uid]);
  // a cet instant, progressDaily ne doit PAS avoir fini (il attend le verrou)
  globalThis.__pPromise = p;
  return !progressFinished;
});
await globalThis.__pPromise; // laisse progressDaily se terminer apres liberation

const final = JSON.parse((await get('SELECT daily_json FROM users WHERE id = ?', [uid])).daily_json);
const stillClaimed = final.quests.find(q => q.id === 'candy3').claimed;
console.log('progressDaily a respecte le verrou (a attendu) :', respectedLock);
console.log('flag claimed conserve apres la course        :', stillClaimed);
if (respectedLock && stillClaimed) {
  console.log('\n✅ FIX OK : progressDaily ne peut plus effacer le claim -> pas de reclamation en boucle.');
  process.exit(0);
} else {
  console.log('\n🔴 BUG : progressDaily ignore le verrou -> /daily/claim peut etre efface (essence gratuite repetable).');
  process.exit(1);
}
