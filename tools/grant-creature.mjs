// Admin : donne un Glump a un joueur dans la base TURSO (jeu deploye).
// Usage (PowerShell) :
//   $env:TURSO_DATABASE_URL="libsql://veilborn-crahover1.aws-eu-west-1.turso.io"
//   $env:TURSO_AUTH_TOKEN="<token_turso_frais>"
//   node tools/grant-creature.mjs                          # liste les joueurs
//   node tools/grant-creature.mjs crash ryuzar             # donne 1 Ryuzar niv100 31/31/31 a crash
//   node tools/grant-creature.mjs crash sparkbud shiny     # version chromatique
import { createClient } from '@libsql/client';
import { SPECIES, xpForLevel, power, levelFromXp } from '../server/game.js';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) { console.error('\n  /!\\ Definis TURSO_DATABASE_URL et TURSO_AUTH_TOKEN.\n'); process.exit(1); }
const db = createClient({ url, authToken });

const [who, species, flag] = process.argv.slice(2);

if (!who) {
  const r = await db.execute('SELECT username, essence, (SELECT COUNT(*) FROM creatures WHERE owner_id = users.id) AS n FROM users ORDER BY username');
  console.log('\nJoueurs :');
  for (const u of r.rows) console.log(`  ${u.username.padEnd(16)} essence=${u.essence}  glumps=${u.n}`);
  console.log('\n-> node tools/grant-creature.mjs <joueur> <espece> [shiny]\n');
  process.exit(0);
}

if (!species || !SPECIES[species]) { console.error(`\n  Espece inconnue: "${species}". Donne un id d'espece valide.\n`); process.exit(1); }

const u = (await db.execute({ sql: 'SELECT id, username FROM users WHERE lower(username) = lower(?)', args: [who] })).rows[0];
if (!u) { console.error(`\n  Joueur "${who}" introuvable.\n`); process.exit(1); }

const variant = flag === 'shiny' ? 1 : 0;
const xp = xpForLevel(100);                 // niveau 100
const c = { species, gene_force: 31, gene_vita: 31, gene_speed: 31, variant, xp, nature: 'Brutal', stage: 'adult' };
const now = Date.now();
await db.execute({
  sql: `INSERT INTO creatures (owner_id, species, stage, gene_force, gene_vita, gene_speed, variant, nature, in_prairie, from_breeding, hp, xp, created_at, favorite)
        VALUES (?, ?, 'adult', 31, 31, 31, ?, 'Brutal', 0, 0, NULL, ?, ?, 0)`,
  args: [u.id, species, variant, xp, now],
});
console.log(`\n  ✅ Donne a ${u.username} : ${SPECIES[species].name}${variant ? ' CHROMATIQUE ✨' : ''}`);
console.log(`     niveau ${levelFromXp(xp)} · IV 31/31/31 · type ${SPECIES[species].type} · puissance ${power(c)}\n`);
process.exit(0);
