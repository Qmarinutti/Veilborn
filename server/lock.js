// Verrou par utilisateur (mutex en memoire), PARTAGE entre les routes et l'etat.
// Serialise les operations sensibles d'un meme joueur pour eviter les races
// (doubles-credits, ecritures concurrentes sur le meme JSON).
const userLocks = new Map();
export async function withLock(userId, fn) {
  while (userLocks.get(userId)) { try { await userLocks.get(userId); } catch {} }
  let release;
  const p = new Promise(r => (release = r));
  userLocks.set(userId, p);
  try { return await fn(); }
  finally { userLocks.delete(userId); release(); }
}
