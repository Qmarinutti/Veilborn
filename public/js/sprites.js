// ============================================================
//  Generateur de sprites SVG (100% original, dessine par code).
//  Une seule fonction publique : creatureSVG(creature, size).
//  Pour passer a de l'art IA/PNG plus tard : il suffit de remplacer
//  le contenu de creatureSVG (ex. renvoyer une <img src=...>).
// ============================================================

// --- Utilitaires couleur ---
function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
}
// pct > 0 eclaircit, pct < 0 assombrit
function shade(hex, pct) {
  const [r, g, b] = hexToRgb(hex);
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct);
  return rgbToHex([r + (t - r) * p, g + (t - g) * p, b + (t - b) * p]);
}

// --- Yeux reutilisables ---
function eyes(cx, y, gap = 13, r = 6) {
  const x1 = cx - gap, x2 = cx + gap;
  const eye = (x) => `
    <circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/>
    <circle cx="${x}" cy="${y + 1}" r="${r * 0.5}" fill="#222"/>
    <circle cx="${x - 1.5}" cy="${y - 1.5}" r="${r * 0.22}" fill="#fff"/>`;
  return eye(x1) + eye(x2);
}
function smile(cx, y, w = 8) {
  return `<path d="M${cx - w} ${y} Q${cx} ${y + 6} ${cx + w} ${y}" stroke="#3a2a2a" stroke-width="2" fill="none" stroke-linecap="round"/>`;
}

// --- Silhouettes (dans un viewBox 0 0 100 100) ---
function shapeMarkup(shape, color) {
  const dark = shade(color, -0.35);
  const light = shade(color, 0.3);
  const belly = shade(color, 0.55);

  switch (shape) {
    case 'beast': // bestiole a oreilles + queue + pattes
      return `
        <path d="M50 86 q-18 4 -20 -6 M50 86 q18 4 20 -6" stroke="${dark}" stroke-width="6" fill="none" stroke-linecap="round"/>
        <path d="M28 40 L20 18 L40 32 Z" fill="${color}" stroke="${dark}" stroke-width="2"/>
        <path d="M72 40 L80 18 L60 32 Z" fill="${color}" stroke="${dark}" stroke-width="2"/>
        <path d="M78 70 q18 -2 14 -18 q-2 10 -14 8 Z" fill="${color}" stroke="${dark}" stroke-width="2"/>
        <ellipse cx="50" cy="58" rx="28" ry="26" fill="${color}" stroke="${dark}" stroke-width="2.5"/>
        <ellipse cx="50" cy="66" rx="14" ry="13" fill="${belly}"/>
        ${eyes(50, 52)} ${smile(50, 66)}`;

    case 'blob': // goutte ronde toute mignonne
      return `
        <path d="M50 16 C24 24 22 56 24 66 C26 84 74 84 76 66 C78 56 76 24 50 16 Z"
              fill="${color}" stroke="${dark}" stroke-width="2.5"/>
        <ellipse cx="50" cy="70" rx="18" ry="12" fill="${belly}" opacity=".7"/>
        ${eyes(50, 50)} ${smile(50, 64)}
        <circle cx="30" cy="58" r="4" fill="${light}" opacity=".8"/>
        <circle cx="70" cy="58" r="4" fill="${light}" opacity=".8"/>`;

    case 'sprout': // graine ronde + pousse
      return `
        <path d="M50 30 q-2 -16 12 -22 q-4 14 -12 22" fill="#4caf50" stroke="${shade('#4caf50',-0.3)}" stroke-width="2"/>
        <path d="M50 30 q2 -12 -10 -16 q2 10 10 16" fill="#69c46e" stroke="${shade('#4caf50',-0.3)}" stroke-width="2"/>
        <ellipse cx="50" cy="60" rx="28" ry="26" fill="${color}" stroke="${dark}" stroke-width="2.5"/>
        <ellipse cx="50" cy="66" rx="15" ry="13" fill="${belly}"/>
        ${eyes(50, 56)} ${smile(50, 70)}`;

    case 'rock': // golem rocheux anguleux
      return `
        <path d="M50 18 L80 38 L74 76 L26 76 L20 38 Z" fill="${color}" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>
        <path d="M50 18 L80 38 L62 44 Z" fill="${light}" opacity=".5"/>
        <path d="M26 76 L20 38 L40 46 Z" fill="${dark}" opacity=".3"/>
        ${eyes(50, 52, 12, 5)} ${smile(50, 66, 7)}`;

    case 'ghost': // fantome flottant
      return `
        <path d="M24 56 C24 28 76 28 76 56 L76 80 Q70 72 64 80 Q58 72 52 80 Q46 72 40 80 Q34 72 28 80 Q24 72 24 64 Z"
              fill="${color}" stroke="${dark}" stroke-width="2.5" opacity=".92"/>
        ${eyes(50, 50, 12, 6)}
        <ellipse cx="50" cy="64" rx="5" ry="7" fill="#2a1f3a"/>`;

    case 'bird': // oiseau a ailes
      return `
        <path d="M26 58 Q4 50 10 38 Q24 44 34 54 Z" fill="${color}" stroke="${dark}" stroke-width="2"/>
        <path d="M74 58 Q96 50 90 38 Q76 44 66 54 Z" fill="${color}" stroke="${dark}" stroke-width="2"/>
        <ellipse cx="50" cy="58" rx="22" ry="24" fill="${color}" stroke="${dark}" stroke-width="2.5"/>
        <ellipse cx="50" cy="64" rx="12" ry="13" fill="${belly}"/>
        <path d="M44 36 L50 24 L56 36 Z" fill="${light}"/>
        <path d="M50 52 L60 56 L50 60 Z" fill="#f2a93a" stroke="${dark}" stroke-width="1"/>
        ${eyes(50, 46, 10, 5)}`;

    case 'dino': // gros saurien a pics
      return `
        <path d="M40 40 L46 26 L52 40 M52 38 L60 24 L66 40 M64 42 L74 32 L80 46"
              fill="${light}" stroke="${dark}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M30 84 L30 72 M46 86 L46 72" stroke="${dark}" stroke-width="7" stroke-linecap="round"/>
        <ellipse cx="50" cy="60" rx="32" ry="24" fill="${color}" stroke="${dark}" stroke-width="2.5"/>
        <circle cx="28" cy="50" r="13" fill="${color}" stroke="${dark}" stroke-width="2.5"/>
        <ellipse cx="56" cy="66" rx="16" ry="12" fill="${belly}" opacity=".7"/>
        ${eyes(26, 48, 7, 4)} ${smile(24, 56, 5)}`;

    case 'fairy': // creature feerique a ailes arrondies
      return `
        <ellipse cx="26" cy="52" rx="16" ry="22" fill="${light}" stroke="${dark}" stroke-width="2" opacity=".75" transform="rotate(-18 26 52)"/>
        <ellipse cx="74" cy="52" rx="16" ry="22" fill="${light}" stroke="${dark}" stroke-width="2" opacity=".75" transform="rotate(18 74 52)"/>
        <path d="M44 30 Q50 14 56 30" stroke="${dark}" stroke-width="2" fill="none"/>
        <circle cx="44" cy="28" r="3" fill="${light}"/><circle cx="56" cy="28" r="3" fill="${light}"/>
        <ellipse cx="50" cy="58" rx="22" ry="24" fill="${color}" stroke="${dark}" stroke-width="2.5"/>
        <ellipse cx="50" cy="64" rx="12" ry="13" fill="${belly}"/>
        ${eyes(50, 52, 11, 6)} ${smile(50, 68)}`;

    default:
      return `<circle cx="50" cy="56" r="30" fill="${color}" stroke="${dark}" stroke-width="2.5"/>${eyes(50, 50)}${smile(50, 64)}`;
  }
}

// --- Etoiles de scintillement pour les shiny ---
function sparkles() {
  const star = (x, y, s) =>
    `<path d="M${x} ${y - s} L${x + s * 0.3} ${y - s * 0.3} L${x + s} ${y} L${x + s * 0.3} ${y + s * 0.3} L${x} ${y + s} L${x - s * 0.3} ${y + s * 0.3} L${x - s} ${y} L${x - s * 0.3} ${y - s * 0.3} Z" fill="#fff8c4"/>`;
  return star(20, 24, 6) + star(82, 30, 4) + star(78, 74, 5);
}

// --- API publique ---
export function creatureSVG(creature, size = 80) {
  const shiny = creature.variant === 1;
  const shadow = `<ellipse cx="50" cy="90" rx="26" ry="6" fill="#000" opacity=".18"/>`;
  const body = shapeMarkup(creature.shape || 'blob', creature.color || '#888');
  const glow = shiny
    ? `<rect x="2" y="2" width="96" height="96" rx="14" fill="none" stroke="#f2c037" stroke-width="3"/>`
    : '';
  const stars = shiny ? sparkles() : '';
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="sprite">
    ${glow}${shadow}${body}${stars}
  </svg>`;
}
