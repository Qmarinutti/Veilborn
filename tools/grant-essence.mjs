// Admin : ajoute de l'essence a un joueur dans la base TURSO (jeu deploye).
// Usage (PowerShell) :
//   $env:TURSO_DATABASE_URL="libsql://veilborn-crahover1.aws-eu-west-1.turso.io"
//   $env:TURSO_AUTH_TOKEN="<ton_token_turso>"
//   node tools/grant-essence.mjs                 # liste les joueurs
//   node tools/grant-essence.mjs Kizack 500      # +500 essence a Kizack (insensible a la casse)
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('\n  /!\\ Definis TURSO_DATABASE_URL et TURSO_AUTH_TOKEN avant de lancer.\n');
  process.exit(1);
}
const db = createClient({ url, authToken });

const [who, amountArg] = process.argv.slice(2);

if (!who) {
  // Pas d'argument : on liste les joueurs (verification).
  const r = await db.execute('SELECT id, username, ROUND(essence) AS ess FROM users ORDER BY ess DESC');
  console.log(`\n  ${r.rows.length} joueurs dans Turso :`);
  for (const u of r.rows) console.log(`    #${u.id}  ${u.username}  —  ${u.ess} essence`);
  console.log('\n  Pour crediter :  node tools/grant-essence.mjs <pseudo> <montant>\n');
  process.exit(0);
}

const amount = Number(amountArg);
if (!Number.isFinite(amount) || amount === 0) {
  console.error('  Montant invalide. Ex : node tools/grant-essence.mjs Kizack 500');
  process.exit(1);
}

const u = await db.execute({
  sql: 'SELECT id, username, ROUND(essence) AS ess FROM users WHERE lower(username) = lower(?)',
  args: [who],
});
if (!u.rows.length) {
  console.error(`  Joueur introuvable : "${who}". Lance sans argument pour voir la liste exacte.`);
  process.exit(1);
}
const target = u.rows[0];
await db.execute({ sql: 'UPDATE users SET essence = essence + ? WHERE id = ?', args: [amount, target.id] });
const after = await db.execute({ sql: 'SELECT ROUND(essence) AS ess FROM users WHERE id = ?', args: [target.id] });
console.log(`\n  OK : ${target.username}  ${target.ess} -> ${after.rows[0].ess} essence  (${amount >= 0 ? '+' : ''}${amount})\n`);
process.exit(0);
