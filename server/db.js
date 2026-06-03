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

// Helpers : args positionnels avec "?".
export async function get(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0];
}
export async function all(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}
export async function run(sql, args = []) {
  return db.execute({ sql, args });
}
// Insert + renvoie l'id cree (lastInsertRowid est un BigInt).
export async function insert(sql, args = []) {
  const r = await db.execute({ sql, args });
  return Number(r.lastInsertRowid);
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

    CREATE TABLE IF NOT EXISTS discoveries (
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      species  TEXT NOT NULL,
      PRIMARY KEY (user_id, species)
    );
  `);

  // Migrations pour les bases deja existantes (ignore si la colonne existe deja).
  for (const sql of [
    'ALTER TABLE users ADD COLUMN prairie_slots INTEGER NOT NULL DEFAULT 4',
    'ALTER TABLE creatures ADD COLUMN in_prairie INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE creatures ADD COLUMN xp INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE creatures ADD COLUMN nature TEXT NOT NULL DEFAULT 'Equilibre'",
  ]) {
    try { await db.execute(sql); } catch { /* colonne deja presente */ }
  }
}
