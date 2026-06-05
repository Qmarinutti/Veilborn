// Compte les allers-retours DB d'un appel /state (getPlayerState).
import { db, get } from '../server/db.js';
import { getPlayerState } from '../server/state.js';
let exec = 0, bat = 0;
const oe = db.execute.bind(db), ob = db.batch.bind(db);
db.execute = (...a) => { exec++; return oe(...a); };
db.batch = (...a) => { bat++; return ob(...a); };
const user = await get('SELECT * FROM users ORDER BY id DESC LIMIT 1');
if (!user) { console.log('aucun utilisateur en base'); process.exit(0); }
// 1er appel (peut avoir des transitions) puis 2e appel = regime stable
await getPlayerState({ ...user });
exec = 0; bat = 0;
const u2 = await get('SELECT * FROM users WHERE id = ?', [user.id]);
exec = 0; bat = 0;
await getPlayerState(u2);
console.log(`Regime stable: ${exec} execute + ${bat} batch = ${exec + bat} allers-retours DB`);
process.exit(0);
