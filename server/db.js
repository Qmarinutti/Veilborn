// Base de donnees via libSQL (@libsql/client).
//  - En LOCAL  : fichier SQLite (url "file:data.db"). Testable sans rien installer.
//  - En PROD   : Turso (variables TURSO_DATABASE_URL + TURSO_AUTH_TOKEN).
// Le SQL reste identique aux deux endroits (c'est du SQLite).
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || 'file:data.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

export const usingTurso = !!process.env.TURSO_DATABASE_URL;
export const dbUrl = url;
export const hasToken = !!authToken;

export const db = createClient(authToken ? { url, authToken } : { url });

// Garde-fou : libSQL refuse NaN/Infinity comme parametre (RangeError -> 500).
// Un id NaN provient toujours d'une entree invalide et ne matcherait rien :
// on le convertit en NULL pour obtenir un "aucun resultat" propre (404/400) au lieu d'un crash.
function safeArgs(args) {
  return (args || []).map(a => (typeof a === 'number' && !Number.isFinite(a)) ? null : a);
}
// Helpers : args positionnels avec "?".
export async function get(sql, args = []) {
  const r = await db.execute({ sql, args: safeArgs(args) });
  return r.rows[0];
}
export async function all(sql, args = []) {
  const r = await db.execute({ sql, args: safeArgs(args) });
  return r.rows;
}
export async function run(sql, args = []) {
  return db.execute({ sql, args: safeArgs(args) });
}
// Insert + renvoie l'id cree (lastInsertRowid est un BigInt).
export async function insert(sql, args = []) {
  const r = await db.execute({ sql, args: safeArgs(args) });
  return Number(r.lastInsertRowid);
}
// Groupe plusieurs requetes en UN SEUL aller-retour reseau (transaction).
// stmts : tableau de { sql, args }. mode : 'read' | 'write' | 'deferred'.
export async function batch(stmts, mode = 'write') {
  if (!stmts.length) return [];
  return db.batch(stmts.map(s => ({ sql: s.sql, args: safeArgs(s.args || []) })), mode);
}

export async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      username        TEXT UNIQUE NOT NULL,
      pass_hash       TEXT NOT NULL,
      pass_salt       TEXT NOT NULL,
      essence         REAL NOT NULL DEFAULT 0,
      incubator_slots INTEGER NOT NULL DEFAULT 2,
      prairie_slots   INTEGER NOT NULL DEFAULT 4,
      breeding_cells  INTEGER NOT NULL DEFAULT 1,
      friend_code     TEXT,
      pvp_trophies    INTEGER NOT NULL DEFAULT 1000,
      last_tick       INTEGER NOT NULL,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS creatures (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      species     TEXT NOT NULL,
      stage       TEXT NOT NULL,
      gene_force  INTEGER NOT NULL,
      gene_vita   INTEGER NOT NULL,
      gene_speed  INTEGER NOT NULL,
      variant     INTEGER NOT NULL DEFAULT 0,
      nature      TEXT NOT NULL DEFAULT 'Equilibre',
      nickname    TEXT,
      in_prairie  INTEGER NOT NULL DEFAULT 0,
      from_breeding INTEGER NOT NULL DEFAULT 0,
      parent_a    INTEGER,
      parent_b    INTEGER,
      hp          INTEGER,
      xp          INTEGER NOT NULL DEFAULT 0,
      hatch_at    INTEGER,
      mature_at   INTEGER,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_creatures_owner ON creatures(owner_id);

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friends (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, friend_id)
    );

    CREATE TABLE IF NOT EXISTS discoveries (
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      species  TEXT NOT NULL,
      variant  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, species, variant)
    );
  `);

  // Migrations pour les bases deja existantes (ignore si la colonne existe deja).
  for (const sql of [
    'ALTER TABLE users ADD COLUMN prairie_slots INTEGER NOT NULL DEFAULT 4',
    'ALTER TABLE creatures ADD COLUMN in_prairie INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE creatures ADD COLUMN xp INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE creatures ADD COLUMN nature TEXT NOT NULL DEFAULT 'Equilibre'",
    'ALTER TABLE users ADD COLUMN breeding_cells INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE creatures ADD COLUMN from_breeding INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN friend_code TEXT',
    'ALTER TABLE creatures ADD COLUMN parent_a INTEGER',
    'ALTER TABLE creatures ADD COLUMN parent_b INTEGER',
    'ALTER TABLE users ADD COLUMN pvp_trophies INTEGER NOT NULL DEFAULT 1000',
    'ALTER TABLE creatures ADD COLUMN hp INTEGER',
    // Nouveautes : shiny hunting, favoris, paliers du dex, streak/daily, succes.
    'ALTER TABLE users ADD COLUMN shiny_pity INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN dex_claimed INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN login_streak INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN last_login_day TEXT',
    'ALTER TABLE users ADD COLUMN daily_json TEXT',
    'ALTER TABLE users ADD COLUMN ach_json TEXT',
    'ALTER TABLE creatures ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0',
    // Biomes : ressources, biomes possedes, et le biome ou farme chaque Glump.
    'ALTER TABLE users ADD COLUMN resources_json TEXT',
    'ALTER TABLE users ADD COLUMN biomes_json TEXT',
    'ALTER TABLE creatures ADD COLUMN biome TEXT',
    "ALTER TABLE users ADD COLUMN active_biome TEXT NOT NULL DEFAULT 'plaine'", // biome actif unique
    'ALTER TABLE users ADD COLUMN expeditions_json TEXT', // explorations en cours
    'ALTER TABLE users ADD COLUMN items_json TEXT',       // sac d'objets (candy/potion/revive)
  ]) {
    try { await db.execute(sql); } catch { /* colonne deja presente */ }
  }

  // Migration prairie -> biomes : les Glumps deja "en prairie" passent dans la Plaine.
  try { await db.execute("UPDATE creatures SET biome = 'plaine' WHERE in_prairie = 1 AND (biome IS NULL OR biome = '')"); } catch {}

  // Table des echanges entre amis (propositions en attente / historiques).
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS trades (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_creature INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trades_to ON trades(to_user, status);
  `);

  // Nettoyage des sessions trop vieilles (>30 jours) pour eviter l'accumulation.
  try {
    await db.execute({ sql: 'DELETE FROM sessions WHERE created_at < ?', args: [Date.now() - 30 * 24 * 3600 * 1000] });
  } catch {}

  // Migration discoveries -> ajoute la dimension "variant" (normal/chromatique).
  // discoveries est un cache reconstruit a chaque lecture, on peut le recreer sans risque.
  try {
    await db.execute('SELECT variant FROM discoveries LIMIT 1');
  } catch {
    try { await db.execute('DROP TABLE IF EXISTS discoveries'); } catch {}
    await db.execute(`CREATE TABLE discoveries (
      user_id INTEGER NOT NULL, species TEXT NOT NULL, variant INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, species, variant))`);
  }
}
