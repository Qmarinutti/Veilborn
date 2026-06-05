// ============================================================
//  Progression meta : succes, paliers du Glumpdex, quetes quotidiennes.
//  Partage par index.js (endpoints) et state.js (eclosions).
// ============================================================
import { get, run } from './db.js';
import { withLock } from './lock.js';

// ---------- Succes (achievements) ----------
export const ACHIEVEMENTS = [
  { id: 'first_hatch', icon: '🐣', name: 'Premiere eclosion', desc: 'Faire eclore un premier oeuf.' },
  { id: 'first_evolve', icon: '⬆️', name: 'Evolution', desc: 'Faire evoluer un Glump.' },
  { id: 'first_pvp', icon: '⚔️', name: 'Premier sang', desc: 'Gagner un combat en arene.' },
  { id: 'shiny', icon: '✨', name: 'Chromatique !', desc: 'Obtenir un Glump chromatique.' },
  { id: 'breeder', icon: '💞', name: 'Eleveur', desc: 'Reproduire 10 Glumps.' },
  { id: 'collector50', icon: '📖', name: 'Collectionneur', desc: 'Decouvrir 50 especes.' },
  { id: 'collector150', icon: '📚', name: 'Erudit', desc: 'Decouvrir 150 especes.' },
  { id: 'dexmaster', icon: '👑', name: 'Maitre du Glumpdex', desc: 'Decouvrir les 300 especes.' },
  { id: 'level50', icon: '🌟', name: 'Veteran', desc: 'Amener un Glump au niveau 50.' },
  { id: 'rich', icon: '💎', name: 'Fortune', desc: 'Posseder 50 000 essence.' },
];
const ACH_IDS = new Set(ACHIEVEMENTS.map(a => a.id));

export function parseAchSet(user) {
  try { return new Set(JSON.parse(user.ach_json || '[]')); } catch { return new Set(); }
}
// Debloque un succes. Renvoie l'objet succes si nouvellement debloque, sinon null.
export async function unlockAch(userId, achId) {
  if (!ACH_IDS.has(achId)) return null;
  const u = await get('SELECT ach_json FROM users WHERE id = ?', [userId]);
  let set; try { set = new Set(JSON.parse(u.ach_json || '[]')); } catch { set = new Set(); }
  if (set.has(achId)) return null;
  set.add(achId);
  await run('UPDATE users SET ach_json = ? WHERE id = ?', [JSON.stringify([...set]), userId]);
  return ACHIEVEMENTS.find(a => a.id === achId) || null;
}

// ---------- Paliers du Glumpdex ----------
export const DEX_MILESTONES = [
  { count: 10, essence: 500 },
  { count: 25, essence: 1500 },
  { count: 50, essence: 4000, prairie: true },   // +1 emplacement de prairie
  { count: 75, essence: 8000 },                   // (nouveau) comble le trou 50->100
  { count: 100, essence: 12000, cell: true },     // +1 cellule de reproduction
  { count: 150, essence: 25000 },                 // (nouveau) comble le trou 100->200
  { count: 200, essence: 40000, prairie: true },
  { count: 250, essence: 80000 },                 // (nouveau) comble le trou 200->300
  { count: 300, essence: 150000, title: 'Maitre du Glumpdex' },
];
// Migration : avant, dex_claimed = INDEX dans l'ancienne liste [10,25,50,100,200,300].
// Les counts commencent a 10 -> toute valeur stockee < 10 est un ANCIEN index, qu'on convertit
// en COUNT (seuil du dernier palier reclame). Apres migration, dex_claimed stocke un COUNT (>=10).
const OLD_DEX_COUNTS = [10, 25, 50, 100, 200, 300];
export function dexClaimedCount(user) {
  let v = user.dex_claimed || 0;
  if (v > 0 && v < 10) v = OLD_DEX_COUNTS[Math.min(v, OLD_DEX_COUNTS.length) - 1];
  return v;
}

// ---------- Quetes quotidiennes ----------
export const DAILY_POOL = [
  { id: 'hatch2', icon: '🥚', text: 'Faire eclore 2 oeufs', goal: 2, reward: 200 },
  { id: 'breed1', icon: '💞', text: 'Reproduire 1 Glump', goal: 1, reward: 150 },
  { id: 'pvp3', icon: '⚔️', text: 'Gagner 3 combats', goal: 3, reward: 300 },
  { id: 'candy3', icon: '⬆️', text: 'Monter un Glump de niveau 3 fois', goal: 3, reward: 150 },
  { id: 'evolve1', icon: '⬆️', text: 'Faire evoluer 1 Glump', goal: 1, reward: 250 },
  { id: 'buyegg2', icon: '🛒', text: 'Acheter 2 oeufs', goal: 2, reward: 150 },
];
const DAILY_BY_ID = Object.fromEntries(DAILY_POOL.map(d => [d.id, d]));

export function todayStr() { return new Date().toISOString().slice(0, 10); }

function rollDailies() {
  const pool = [...DAILY_POOL], chosen = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return chosen.map(q => ({ id: q.id, progress: 0, claimed: false }));
}
// Etat des quetes du jour (re-tire si nouveau jour).
export async function getDaily(user) {
  let data; try { data = JSON.parse(user.daily_json || 'null'); } catch { data = null; }
  const today = todayStr();
  if (!data || data.day !== today) {
    data = { day: today, quests: rollDailies() };
    await run('UPDATE users SET daily_json = ? WHERE id = ?', [JSON.stringify(data), user.id]);
  }
  return data;
}
// Incremente la progression d'une quete (no-op si inactive/terminee).
// SOUS VERROU (meme verrou que /daily/claim) : sinon ce read-modify-write de daily_json
// pourrait effacer le flag claimed=true pose par /daily/claim -> recompense reclamable en boucle.
// IMPORTANT : ne jamais appeler progressDaily DEPUIS un withLock deja tenu (verrou non reentrant).
export async function progressDaily(userId, questId, by = 1) {
  await withLock(userId, async () => {
    const u = await get('SELECT daily_json FROM users WHERE id = ?', [userId]);
    let data; try { data = JSON.parse(u.daily_json || 'null'); } catch { data = null; }
    if (!data || data.day !== todayStr()) return;
    const q = data.quests.find(x => x.id === questId);
    if (!q || q.claimed) return;
    const def = DAILY_BY_ID[questId];
    q.progress = Math.min(def.goal, (q.progress || 0) + by);
    await run('UPDATE users SET daily_json = ? WHERE id = ?', [JSON.stringify(data), userId]);
  });
}
// Vue enrichie (texte, but, recompense, complet ?) pour le client.
export function dailyView(data) {
  return {
    day: data.day,
    quests: data.quests.map(q => {
      const def = DAILY_BY_ID[q.id] || {};
      return { id: q.id, icon: def.icon, text: def.text, goal: def.goal, reward: def.reward,
        progress: q.progress || 0, claimed: !!q.claimed, done: (q.progress || 0) >= def.goal };
    }),
  };
}
