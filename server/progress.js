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
  // --- Succes etendus ---
  { id: 'collector100', icon: '📗', name: 'Naturaliste', desc: 'Decouvrir 100 especes.' },
  { id: 'collector200', icon: '📕', name: 'Savant', desc: 'Decouvrir 200 especes.' },
  { id: 'coll50', icon: '📦', name: 'Petit elevage', desc: 'Posseder 50 Glumps.' },
  { id: 'coll100', icon: '🏠', name: 'Grand elevage', desc: 'Posseder 100 Glumps.' },
  { id: 'shiny5', icon: '✨', name: 'Chasseur de couleurs', desc: 'Decouvrir 5 Glumps chromatiques.' },
  { id: 'shiny15', icon: '🌟', name: 'Prisme', desc: 'Decouvrir 15 Glumps chromatiques.' },
  { id: 'shiny30', icon: '🌠', name: 'Arc-en-ciel', desc: 'Decouvrir 30 Glumps chromatiques.' },
  { id: 'level25', icon: '⭐', name: 'Aguerri', desc: 'Amener un Glump au niveau 25.' },
  { id: 'level75', icon: '💫', name: 'Maitre dresseur', desc: 'Amener un Glump au niveau 75.' },
  { id: 'level_max', icon: '🏆', name: 'Apogee', desc: 'Amener un Glump au niveau 100.' },
  { id: 'rich2', icon: '💰', name: 'Riche', desc: 'Posseder 250 000 essence.' },
  { id: 'millionaire', icon: '🤑', name: 'Millionnaire', desc: 'Posseder 1 000 000 essence.' },
  { id: 'typemaster', icon: '🌈', name: 'Polyvalent', desc: 'Posseder un Glump de chaque type (14).' },
  { id: 'mono10', icon: '🎨', name: 'Specialiste', desc: 'Posseder 10 Glumps du meme type.' },
  { id: 'perfect_iv', icon: '💠', name: 'Genetique parfaite', desc: 'Posseder un Glump aux genes parfaits (31/31/31).' },
  { id: 'evolved', icon: '🦋', name: 'Metamorphose', desc: 'Posseder une forme finale (stade 3).' },
  { id: 'evolved10', icon: '🐉', name: 'Eleveur d\'elite', desc: 'Posseder 10 formes finales.' },
  { id: 'breeder50', icon: '💗', name: 'Eleveur confirme', desc: 'Reproduire 50 Glumps.' },
  { id: 'breeder100', icon: '💝', name: 'Maitre eleveur', desc: 'Reproduire 100 Glumps.' },
  { id: 'epic_owner', icon: '🔮', name: 'Trouvaille epique', desc: 'Posseder un Glump Epique.' },
  { id: 'legend_owner', icon: '🔱', name: 'Legende vivante', desc: 'Posseder un Glump Legendaire.' },
  { id: 'pvp1500', icon: '🥈', name: 'Gladiateur', desc: 'Atteindre 1500 trophees d\'arene.' },
  { id: 'pvp2000', icon: '🥇', name: 'Champion', desc: 'Atteindre 2000 trophees d\'arene.' },
  { id: 'biome_all', icon: '🗺️', name: 'Explorateur', desc: 'Posseder tous les biomes.' },
  { id: 'farm12', icon: '🌾', name: 'Grand fermier', desc: 'Debloquer 12 emplacements de farm.' },
];
const ACH_IDS = new Set(ACHIEVEMENTS.map(a => a.id));

export function parseAchSet(user) {
  try { return new Set(JSON.parse(user.ach_json || '[]')); } catch { return new Set(); }
}
// Debloque un succes. Renvoie l'objet succes si nouvellement debloque, sinon null.
// ATOMIQUE + IDEMPOTENT : un seul UPDATE conditionnel, pas de read-modify-write (donc pas de
// lost-update, et SURTOUT pas besoin de verrou -> appelable depuis l'interieur d'un withLock).
// json_insert(..., '$[#]', ?) ajoute en fin de tableau JSON ; le NOT EXISTS garantit l'unicite.
// rowsAffected = 1 seulement si le succes etait absent -> on ne le signale qu'une fois.
export const ACH_INSERT_SQL =
  `UPDATE users SET ach_json = json_insert(COALESCE(ach_json, '[]'), '$[#]', ?)
   WHERE id = ? AND NOT EXISTS (
     SELECT 1 FROM json_each(COALESCE(ach_json, '[]')) WHERE value = ?
   )`;
export async function unlockAch(userId, achId) {
  if (!ACH_IDS.has(achId)) return null;
  const r = await run(ACH_INSERT_SQL, [achId, userId, achId]);
  return r.rowsAffected ? (ACHIEVEMENTS.find(a => a.id === achId) || null) : null;
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

// ---------- Paliers du Dex CHROMATIQUE (shiny) ----------
// Recompense enfin le shiny-hunting (pity jusqu'a 5%) qui n'avait aucun palier dedie.
// dex_claimed-like : on stocke le COUNT du dernier palier shiny reclame.
export const SHINY_DEX_MILESTONES = [
  { count: 1,  essence: 1500 },
  { count: 5,  essence: 6000 },
  { count: 15, essence: 18000, cell: true },     // +1 cellule de reproduction
  { count: 30, essence: 45000, prairie: true },  // +1 emplacement de farm
  { count: 60, essence: 120000, title: 'Chasseur de Chromatiques' },
];

// ---------- Paliers de TROPHEES PvP ----------
// Les trophees ne debloquaient rien : on ajoute des paliers (reclamables une fois le seuil
// ATTEINT, et qui restent acquis meme si les trophees redescendent). pvp_claimed = seuil max reclame.
export const PVP_MILESTONES = [
  { trophies: 1200, essence: 3000 },
  { trophies: 1500, essence: 10000 },
  { trophies: 2000, essence: 30000, cell: true },
  { trophies: 2500, essence: 75000, title: 'Champion de l\'Arene' },
];

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
    const fresh = { day: today, quests: rollDailies() };
    // Ecriture CONDITIONNELLE (atomique) : on ne roule les quetes du jour que si elles ne l'ont pas
    // deja ete (sinon deux /state|/progress concurrents genereraient 2 jeux differents et s'effaceraient).
    const r = await run(
      "UPDATE users SET daily_json = ? WHERE id = ? AND (daily_json IS NULL OR COALESCE(json_extract(daily_json, '$.day'), '') <> ?)",
      [JSON.stringify(fresh), user.id, today]);
    if (r.rowsAffected) {
      data = fresh;
    } else {
      // Un concurrent a deja roule les quetes du jour -> on relit la valeur stockee.
      const u = await get('SELECT daily_json FROM users WHERE id = ?', [user.id]);
      try { data = JSON.parse(u.daily_json); } catch { data = fresh; }
    }
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
