// ============================================================
//  Generateur de sprites SVG (original, dessine par code).
//  Plus stylise : degrades, ombrage, contours, accents par type,
//  yeux feroces + cornes/pics sur les formes evoluees (rarete elevee).
//  API publique unique : creatureSVG(creature, size).
//  Pour passer a de l'art image plus tard : remplacer le corps de
//  creatureSVG par <img src=...>.
// ============================================================

let UID = 0;

// --- Couleur ---
function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
function hexToRgb(hex) { const h = hex.replace('#', ''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
function rgbToHex([r,g,b]) { return '#' + [r,g,b].map(v=>clamp(v).toString(16).padStart(2,'0')).join(''); }
function shade(hex, p) { const [r,g,b]=hexToRgb(hex); const t=p<0?0:255; const a=Math.abs(p); return rgbToHex([r+(t-r)*a,g+(t-g)*a,b+(t-b)*a]); }

// --- Yeux (mignons ou feroces) ---
function eyes(cx, y, gap, r, fierce) {
  const x1 = cx - gap, x2 = cx + gap;
  const eye = (x) => `
    <ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r*1.15}" fill="#fff"/>
    <circle cx="${x}" cy="${y + r*0.3}" r="${r*0.55}" fill="#171720"/>
    <circle cx="${x - r*0.35}" cy="${y - r*0.35}" r="${r*0.26}" fill="#fff"/>`;
  let brows = '';
  if (fierce) brows = `
    <path d="M${x1-r-1} ${y-r-1} L${x1+r} ${y-r*0.1}" stroke="#241616" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M${x2+r+1} ${y-r-1} L${x2-r} ${y-r*0.1}" stroke="#241616" stroke-width="3.2" stroke-linecap="round"/>`;
  return eye(x1) + eye(x2) + brows;
}

// --- Accents par type, derriere le corps (ailes/nageoires/queues) ---
function backAccent(type, color, tier, P) {
  if (type === 'Eau') {
    // nageoire dorsale + queue palmee
    return `
      <path d="M50 22 Q58 8 70 14 Q60 22 56 34 Z" fill="${P.light}" opacity=".85" stroke="${P.outline}" stroke-width="1.5"/>
      <path d="M74 64 Q96 56 94 40 Q82 50 70 56 Z" fill="${P.light}" opacity=".8" stroke="${P.outline}" stroke-width="1.5"/>`;
  }
  if (type === 'Plante' && tier >= 2) {
    return `
      <path d="M24 50 Q4 44 8 26 Q24 34 34 50 Z" fill="#4fbf57" stroke="${shade('#2f7d33',-0.2)}" stroke-width="1.5"/>
      <path d="M76 50 Q96 44 92 26 Q76 34 66 50 Z" fill="#4fbf57" stroke="${shade('#2f7d33',-0.2)}" stroke-width="1.5"/>`;
  }
  if (type === 'Feu' && tier >= 3) {
    // grandes ailes sombres facon dragon
    return `
      <path d="M28 52 Q2 36 6 18 Q26 30 38 50 Z" fill="${P.dark}" stroke="${P.outline}" stroke-width="1.5"/>
      <path d="M72 52 Q98 36 94 18 Q74 30 62 50 Z" fill="${P.dark}" stroke="${P.outline}" stroke-width="1.5"/>`;
  }
  return '';
}

// --- Accents par type, devant/au-dessus (crinieres, feuilles, cornes) ---
function frontAccent(type, color, tier, P) {
  let m = '';
  if (type === 'Feu') {
    // crete de flammes sur la tete
    const flame = (x, s) => `<path d="M${x} ${30-s} Q${x-4} ${42-s} ${x-2} ${44}
      Q${x} ${36} ${x+2} ${44} Q${x+4} ${42-s} ${x} ${30-s} Z" fill="url(#fl${P.u})"/>`;
    m += flame(38, 6) + flame(50, 12) + flame(62, 6);
    // queue de flamme
    m += `<path d="M76 70 q18 2 18 -16 q-4 10 -12 8 q6 -10 -6 -10 Z" fill="url(#fl${P.u})" stroke="${P.outline}" stroke-width="1"/>`;
    if (tier >= 3) m += `<path d="M34 30 L28 12 L42 26 Z M66 30 L72 12 L58 26 Z" fill="${P.light}" stroke="${P.outline}" stroke-width="1.5"/>`;
  }
  if (type === 'Plante') {
    // pousse / feuille sur la tete
    m += `<path d="M50 30 q-2 -18 14 -24 q-4 16 -14 24" fill="#62c96a" stroke="${shade('#2f7d33',-0.25)}" stroke-width="1.5"/>`;
    m += `<path d="M50 30 q3 -13 -11 -17 q3 11 11 17" fill="#7ed884" stroke="${shade('#2f7d33',-0.25)}" stroke-width="1.5"/>`;
    if (tier >= 3) m += `<circle cx="34" cy="40" r="4" fill="#ff7eb3"/><circle cx="66" cy="40" r="4" fill="#ffd34d"/>`;
  }
  if (type === 'Eau') {
    m += `<circle cx="34" cy="62" r="3.5" fill="${P.belly}" opacity=".8"/><circle cx="66" cy="62" r="3.5" fill="${P.belly}" opacity=".8"/>`;
    if (tier >= 3) m += `<path d="M36 30 L31 16 L44 28 Z M64 30 L69 16 L56 28 Z" fill="${P.light}" stroke="${P.outline}" stroke-width="1.5"/>`;
  }
  return m;
}

// --- Silhouettes ---
function bodyMarkup(shape, P) {
  const fill = `url(#bd${P.u})`;
  switch (shape) {
    case 'beast':
      return `
        <path d="M74 66 q22 -4 16 -24 q-3 13 -16 13 Z" fill="${fill}" stroke="${P.outline}" stroke-width="2"/>
        <ellipse cx="36" cy="86" rx="8" ry="5" fill="${P.dark}"/><ellipse cx="64" cy="86" rx="8" ry="5" fill="${P.dark}"/>
        <path d="M30 38 L22 14 L45 31 Z" fill="${fill}" stroke="${P.outline}" stroke-width="2"/>
        <path d="M70 38 L78 14 L55 31 Z" fill="${fill}" stroke="${P.outline}" stroke-width="2"/>
        <ellipse cx="50" cy="58" rx="28" ry="27" fill="${fill}" stroke="${P.outline}" stroke-width="2.5"/>
        <ellipse cx="50" cy="67" rx="15" ry="14" fill="${P.belly}" opacity=".55"/>`;
    case 'blob':
      return `
        <path d="M50 16 C26 24 22 56 25 67 C28 86 72 86 75 67 C78 56 74 24 50 16 Z" fill="${fill}" stroke="${P.outline}" stroke-width="2.5"/>
        <ellipse cx="50" cy="70" rx="18" ry="13" fill="${P.belly}" opacity=".55"/>
        <circle cx="31" cy="56" r="4" fill="${P.light}" opacity=".8"/><circle cx="69" cy="56" r="4" fill="${P.light}" opacity=".8"/>`;
    case 'sprout':
      return `
        <ellipse cx="36" cy="86" rx="7" ry="4" fill="${P.dark}"/><ellipse cx="64" cy="86" rx="7" ry="4" fill="${P.dark}"/>
        <ellipse cx="50" cy="60" rx="28" ry="26" fill="${fill}" stroke="${P.outline}" stroke-width="2.5"/>
        <ellipse cx="50" cy="68" rx="15" ry="13" fill="${P.belly}" opacity=".55"/>`;
    case 'serpent':
      return `
        <path d="M50 84 Q26 80 30 60 Q34 44 50 44 Q70 44 70 30" fill="none" stroke="${P.dark}" stroke-width="15" stroke-linecap="round"/>
        <path d="M50 84 Q26 80 30 60 Q34 44 50 44 Q70 44 70 30" fill="none" stroke="${fill}" stroke-width="11" stroke-linecap="round"/>
        <circle cx="62" cy="36" r="20" fill="${fill}" stroke="${P.outline}" stroke-width="2.5"/>
        <ellipse cx="62" cy="42" rx="11" ry="9" fill="${P.belly}" opacity=".5"/>`;
    case 'dino':
      return `
        <path d="M40 38 L46 24 L52 38 M52 36 L60 22 L68 40 M66 42 L77 30 L84 48" fill="${P.light}" stroke="${P.outline}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M30 86 L30 70 M48 88 L48 70" stroke="${P.dark}" stroke-width="9" stroke-linecap="round"/>
        <ellipse cx="52" cy="60" rx="32" ry="25" fill="${fill}" stroke="${P.outline}" stroke-width="2.5"/>
        <circle cx="28" cy="48" r="15" fill="${fill}" stroke="${P.outline}" stroke-width="2.5"/>
        <ellipse cx="56" cy="66" rx="17" ry="13" fill="${P.belly}" opacity=".5"/>`;
    default:
      return `<circle cx="50" cy="56" r="30" fill="${fill}" stroke="${P.outline}" stroke-width="2.5"/>`;
  }
}

// position des yeux selon la silhouette
function eyeSpot(shape) {
  switch (shape) {
    case 'serpent': return { x: 62, y: 34, gap: 8, r: 5 };
    case 'dino':    return { x: 28, y: 46, gap: 8, r: 4.5 };
    case 'blob':    return { x: 50, y: 50, gap: 12, r: 6.5 };
    default:        return { x: 50, y: 53, gap: 13, r: 6 };
  }
}

function sparkles() {
  const star = (x, y, s) => `<path d="M${x} ${y-s} L${x+s*0.3} ${y-s*0.3} L${x+s} ${y} L${x+s*0.3} ${y+s*0.3} L${x} ${y+s} L${x-s*0.3} ${y+s*0.3} L${x-s} ${y} L${x-s*0.3} ${y-s*0.3} Z" fill="#fff6c4"/>`;
  return star(20, 24, 6) + star(82, 28, 4.5) + star(80, 72, 5);
}

// --- API publique ---
export function creatureSVG(creature, size = 80) {
  const u = ++UID;
  const color = creature.color || '#888';
  const type = creature.type || '';
  const rarity = creature.rarity || 1;
  const shape = creature.shape || 'blob';
  const tier = rarity <= 1 ? 1 : rarity <= 2 ? 2 : 3;
  const fierce = rarity >= 3;
  const shiny = creature.variant === 1;

  const P = {
    u,
    main: color,
    dark: shade(color, -0.4),
    outline: shade(color, -0.62),
    light: shade(color, 0.42),
    belly: shade(color, 0.62),
  };

  const defs = `<defs>
    <radialGradient id="bd${u}" cx="40%" cy="32%" r="78%">
      <stop offset="0%" stop-color="${P.light}"/>
      <stop offset="55%" stop-color="${P.main}"/>
      <stop offset="100%" stop-color="${P.dark}"/>
    </radialGradient>
    <linearGradient id="fl${u}" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#ff7a2c"/><stop offset="60%" stop-color="#ffb02e"/><stop offset="100%" stop-color="#ffe773"/>
    </linearGradient>
  </defs>`;

  const e = eyeSpot(shape);
  const shadow = `<ellipse cx="50" cy="91" rx="27" ry="6" fill="#000" opacity=".2"/>`;
  const ring = shiny ? `<rect x="2.5" y="2.5" width="95" height="95" rx="16" fill="none" stroke="#ffd34d" stroke-width="3"/>` : '';

  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="sprite">
    ${defs}${ring}${shadow}
    ${backAccent(type, color, tier, P)}
    ${bodyMarkup(shape, P)}
    ${frontAccent(type, color, tier, P)}
    ${eyes(e.x, e.y, e.gap, e.r, fierce)}
    ${shiny ? sparkles() : ''}
  </svg>`;
}
