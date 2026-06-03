// Authentification simple : hash scrypt + session cookie httpOnly.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, run } from './db.js';

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
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
