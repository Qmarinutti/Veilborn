// Preuve DETERMINISTE du bug : reproduit l'entrelacement exact qui se produit sur Turso.
//  1) Une requete /state lit l'utilisateur (snapshot essence=E) au debut (requireAuth).
//  2) PENDANT son traitement, le joueur depense (bonbons) -> la DB descend a E-300.
//  3) L'ecriture finale de /state fait "essence = E + gain" (ABSOLU) -> ecrase la depense.
import { get, run, initDb } from '../server/db.js';
import { getPlayerState } from '../server/state.js';
import { hashPassword } from '../server/auth.js';

await initDb();
// Cree un utilisateur de test directement
const now = Date.now();
const { hash, salt } = await hashPassword('pw');
const uname = 'clob_' + Math.floor(now % 1e7);
const todayStr = new Date(now).toISOString().slice(0, 10); // neutralise le bonus de connexion
const { lastInsertRowid } = await run(
  'INSERT INTO users (username, pass_hash, pass_salt, essence, incubator_slots, prairie_slots, breeding_cells, last_tick, last_login_day, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
  [uname, hash, salt, 1000, 2, 4, 1, now - 5000, todayStr, now]);
const uid = Number(lastInsertRowid);
// Lui donner un Glump adulte qui farme (pour qu'il y ait un "gain" idle)
await run("INSERT INTO creatures (owner_id, species, stage, gene_force, gene_vita, gene_speed, variant, nature, in_prairie, biome, xp, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  [uid, 'flammkit', 'adult', 20, 20, 20, 0, 'Equilibre', 1, 'plaine', 0, now]);

// 1) snapshot "req.user" lu au debut de /state
const snapshot = await get('SELECT * FROM users WHERE id = ?', [uid]);
console.log('1) /state lit le snapshot : essence =', snapshot.essence);

// 2) le joueur depense 300 (5 bonbons) PENDANT que /state est en vol
await run('UPDATE users SET essence = essence - 300 WHERE id = ? AND essence >= 300', [uid]);
const afterSpend = (await get('SELECT essence FROM users WHERE id = ?', [uid])).essence;
console.log('2) le joueur depense 300 -> DB essence =', afterSpend);

// 3) /state termine son traitement avec le snapshot perime et ecrit son resultat
await getPlayerState(snapshot);
const finalEss = (await get('SELECT essence FROM users WHERE id = ?', [uid])).essence;
console.log('3) /state ecrit son resultat -> DB essence =', Math.floor(finalEss));

console.log('');
if (finalEss > afterSpend + 50) {
  console.log(`🔴 BUG CONFIRME : la depense de 300 a ete EFFACEE par /state.`);
  console.log(`   essence ${Math.floor(finalEss)} au lieu de ~${afterSpend} -> les bonbons etaient GRATUITS.`);
  process.exit(1);
} else {
  console.log(`✅ Pas de bug : essence finale ${Math.floor(finalEss)} (~${afterSpend}), la depense est conservee.`);
  process.exit(0);
}
