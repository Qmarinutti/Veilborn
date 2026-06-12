// Outil admin : donne a un joueur TOUTES les especes en adulte, niveau 100, IV 31/31/31.
// Idempotent : ne recree pas une espece deja possedee en 31/31/31 niveau 100 adulte.
// Decouvre aussi toutes les especes dans le Dex.
//
// Usage (LOCAL, fichier data.db) :   node tools/grant-all.mjs Crashover
// Usage (PROD, base Turso)        :   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node tools/grant-all.mjs Crashover
//   En PowerShell :  $env:TURSO_DATABASE_URL='...'; $env:TURSO_AUTH_TOKEN='...'; node tools/grant-all.mjs Crashover
import { db, get, all, batch } from '../server/db.js';
import { SPECIES, xpForLevel } from '../server/game.js';

const username = process.argv[2] || 'Crashover';
const PERFECT = 31;
const XP_MAX = xpForLevel(100); // 495000
const now = Date.now();

// 1) Trouver le joueur (insensible a la casse).
const user = await get('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE', [username]);
if (!user) {
  console.error(`\n  Joueur introuvable : "${username}". Verifie l'orthographe (ou la base : ${process.env.TURSO_DATABASE_URL ? 'Turso (prod)' : 'file:data.db (local)'}).`);
  const some = await all('SELECT username FROM users ORDER BY id LIMIT 20');
  if (some.length) console.error('  Comptes existants :', some.map(r => r.username).join(', '));
  process.exit(1);
}
console.log(`\n  Cible : ${user.username} (id ${user.id}) sur ${process.env.TURSO_DATABASE_URL ? 'Turso (PROD)' : 'data.db (local)'}`);

// 2) Especes deja possedees en 31/31/31 niveau 100 adulte -> on ne les recree pas.
const ownedPerfect = new Set(
  (await all(
    `SELECT species FROM creatures
     WHERE owner_id = ? AND stage = 'adult'
       AND gene_force = ? AND gene_vita = ? AND gene_speed = ? AND xp >= ?`,
    [user.id, PERFECT, PERFECT, PERFECT, XP_MAX]
  )).map(r => r.species)
);

const allIds = Object.keys(SPECIES);
const toAdd = allIds.filter(id => !ownedPerfect.has(id));
console.log(`  Especes totales : ${allIds.length} | deja en 31/31/31 lv100 : ${ownedPerfect.size} | a ajouter : ${toAdd.length}`);

if (!toAdd.length && ownedPerfect.size >= allIds.length) {
  console.log('  Rien a faire : le joueur a deja toutes les especes parfaites.\n');
  process.exit(0);
}

// 3) Inserer une creature parfaite par espece manquante + decouvrir toutes les especes.
const stmts = [];
for (const species of toAdd) {
  stmts.push({
    sql: `INSERT INTO creatures
            (owner_id, species, stage, gene_force, gene_vita, gene_speed, variant, nature, xp, created_at)
          VALUES (?, ?, 'adult', ?, ?, ?, 0, 'Equilibre', ?, ?)`,
    args: [user.id, species, PERFECT, PERFECT, PERFECT, XP_MAX, now],
  });
}
for (const species of allIds) {
  stmts.push({
    sql: 'INSERT OR IGNORE INTO discoveries (user_id, species, variant) VALUES (?, ?, 0)',
    args: [user.id, species],
  });
}

// libSQL accepte de gros batches, mais on tronconne par securite (reseau Turso).
const CHUNK = 100;
for (let i = 0; i < stmts.length; i += CHUNK) {
  await batch(stmts.slice(i, i + CHUNK), 'write');
}

const total = await get("SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND stage = 'adult'", [user.id]);
console.log(`  OK : ${toAdd.length} especes ajoutees (lv100, 31/31/31). ${user.username} a maintenant ${total.n} adultes.\n`);
process.exit(0);
