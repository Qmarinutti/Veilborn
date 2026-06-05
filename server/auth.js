// Authentification simple : hash scrypt (ASYNC) + session cookie httpOnly.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { get, run } from './db.js';

const scryptAsync = promisify(scrypt);

// ASYNC : scrypt est lourd (~75ms CPU). En version synchrone il BLOQUE l'event loop
// -> sous charge (beaucoup de connexions/inscriptions) le serveur n'accepte plus rien.
// La version async tourne sur le threadpool libuv (jusqu'a 4 en parallele) sans bloquer.
export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const buf = await scryptAsync(password, salt, 64);
  return { hash: buf.toString('hex'), salt };
}

export async function verifyPassword(password, salt, expectedHash) {
  const { hash } = await hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  await run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)',
    [token, userId, Date.now()]);
  return token;
}

export async function destroySession(token) {
  if (token) await run('DELETE FROM sessions WHERE token = ?', [token]);
}

function tokenFromRequest(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.split(';').map(c => c.trim()).find(c => c.startsWith('sid='));
  return match ? decodeURIComponent(match.slice(4)) : null;
}

// Lit le cookie "sid" et renvoie l'utilisateur, ou null.
export async function userFromRequest(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const sess = await get('SELECT user_id FROM sessions WHERE token = ?', [token]);
  if (!sess) return null;
  return (await get('SELECT * FROM users WHERE id = ?', [sess.user_id])) || null;
}

export { tokenFromRequest };

// Middleware express : exige un utilisateur connecte.
export async function requireAuth(req, res, next) {
  try {
    const user = await userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non connecte' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
