// ============================================================
//  Moderation du chat : filtre d'insultes (blocklist), liens, et flood.
//  Defensif et auto-suffisant (aucun service externe).
// ============================================================

// Liste de termes offensants (FR + EN). Volontairement modeste ; a etendre au besoin.
// Sert UNIQUEMENT a filtrer le chat (usage defensif).
const BLOCKED = [
  // FR — insultes / slurs
  'connard', 'connasse', 'conard', 'salope', 'salaud', 'pute', 'putain', 'encule', 'enfoire',
  'batard', 'nique ta', 'niquer', 'ntm', 'pede', 'tapette', 'grosse pute',
  'negre', 'bougnoule', 'youpin', 'sale juif', 'sale arabe', 'sale noir', 'mongol', 'attarde',
  // EN — insults / slurs
  'fuck', 'fucker', 'motherfucker', 'shit', 'bitch', 'asshole', 'cunt', 'whore', 'slut',
  'nigger', 'nigga', 'faggot', 'retard',
];

// Normalise : minuscules, sans accents, repetitions 3+ reduites a 1 (fuuuck -> fuck),
// ponctuation -> espaces (pour un match "mot entier"). Entoure d'espaces.
function norm(s) {
  return ' ' + String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(.)\1{2,}/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() + ' ';
}

// Le texte contient-il un terme bloque (match mot entier apres normalisation) ?
export function isBlocked(text) {
  const n = norm(text);
  return BLOCKED.some(w => n.includes(norm(w)));
}

// Detection de lien (anti-spam/scam) : http(s), www, ou un domaine courant.
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|fr|io|gg|xyz|ru|tk|info|me|co)\b)/i;
export function hasLink(text) { return LINK_RE.test(String(text || '')); }

// Raison de rejet d'un message (ou null si OK). Le flood est gere cote route (historique).
export function chatReject(text) {
  if (isBlocked(text)) return 'Message bloqué (langage inapproprié).';
  if (hasLink(text)) return 'Les liens ne sont pas autorisés dans le chat.';
  return null;
}
