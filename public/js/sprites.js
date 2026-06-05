// ============================================================
//  Generateur de sprites SVG "badass" (original, dessine par code).
//  Aura lumineuse, yeux fendus brillants, crocs, cornes & pics dorsaux
//  sur les formes evoluees, palette sombre/intense, contours marques.
//  API publique : creatureSVG(creature, size).
//  Pour passer a de l'art image plus tard : remplacer le corps ici.
// ============================================================

let UID = 0;

// Version des images : a incrementer quand des sprites sont regeneres,
// pour forcer le navigateur a recharger (cache-busting).
const SPRITE_VER = 5;

// Especes disposant d'une VRAIE image (fichier public/sprites/<id>.png).
// Des qu'une image est prete, on ajoute l'id ici -> elle remplace le sprite SVG.
export const ART = new Set([
  // ex : 'flammkit', 'pyrokit', 'infernaught', ...
]);

// Renvoie l'image si elle existe pour cette espece, sinon le sprite SVG dessine.
// hasArt est fourni par le serveur (scan auto de public/sprites/) ; ART est un
// surcharge manuelle optionnelle cote client.
// Teinte chromatique (shiny) : derivee de la LIGNEE pour rester coherente entre
// les evolutions d'une meme lignee. 40..320deg (evite ~0 = pas de decalage visible).
function shinyHueDeg(key) {
  let h = 0;
  const s = String(key || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 40 + (h % 281);
}

export function creatureVisual(creature, size = 80) {
  const id = creature && creature.species;
  if (id && (creature.hasArt || ART.has(id))) {
    let extra = '';
    if (creature.variant === 1) {
      const deg = shinyHueDeg(creature.line || id);
      extra = ` style="filter:hue-rotate(${deg}deg) saturate(1.45) brightness(1.06) drop-shadow(0 0 6px rgba(255,230,120,.65));"`;
    }
    return `<img class="sprite art${creature.variant === 1 ? ' shiny-art' : ''}" src="sprites/${id}.png?v=${SPRITE_VER}"${extra} width="${size}" height="${size}" alt="${creature.speciesName || ''}" loading="lazy">`;
  }
  return creatureSVG(creature, size);
}

function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
function hexToRgb(h) { h = h.replace('#', ''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
function rgbToHex([r,g,b]) { return '#' + [r,g,b].map(v=>clamp(v).toString(16).padStart(2,'0')).join(''); }
function shade(hex, p) { const [r,g,b]=hexToRgb(hex); const t=p<0?0:255; const a=Math.abs(p); return rgbToHex([r+(t-r)*a,g+(t-g)*a,b+(t-b)*a]); }

// Couleur de lueur (yeux + aura) par type
const GLOW = { Feu: '#ffce3a', Eau: '#79e9ff', Plante: '#b4ff57' };

// --- Yeux menacants : amande fendue, lueur, sourcils agressifs ---
function badEyes(cx, y, gap, r, glow, u) {
  const x1 = cx - gap, x2 = cx + gap;
  const almond = (x) =>
    `M${x-r} ${y} Q${x} ${y-r*1.15} ${x+r} ${y-r*0.15} Q${x} ${y+r*0.55} ${x-r} ${y} Z`;
  const eye = (x) => `
    <g filter="url(#glow${u})"><path d="${almond(x)}" fill="${glow}"/></g>
    <path d="${almond(x)}" fill="${glow}"/>
    <rect x="${x-1.1}" y="${y-r*0.95}" width="2.2" height="${r*1.6}" rx="1" fill="#160b11"/>`;
  const brows = `
    <path d="M${x1-r-1} ${y-r} L${x1+r+1} ${y-0.5}" stroke="#160b11" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M${x2+r+1} ${y-r} L${x2-r-1} ${y-0.5}" stroke="#160b11" stroke-width="3.4" stroke-linecap="round"/>`;
  return eye(x1) + eye(x2) + brows;
}

function fangs(cx, y) {
  return `<path d="M${cx-6} ${y} l2.2 5.5 l2.2 -5.5 Z" fill="#fff"/>
          <path d="M${cx+1.6} ${y} l2.2 5.5 l2.2 -5.5 Z" fill="#fff"/>`;
}

function horns(cx, topY, col, outline) {
  return `
    <path d="M${cx-11} ${topY} q-8 -12 0 -24 q3 11 9 18 Z" fill="${col}" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M${cx+11} ${topY} q8 -12 0 -24 q-3 11 -9 18 Z" fill="${col}" stroke="${outline}" stroke-width="1.5" stroke-linejoin="round"/>`;
}

function backSpikes(col, outline) {
  const tri = (x, y, h) => `<path d="M${x-5} ${y} L${x} ${y-h} L${x+5} ${y} Z" fill="${col}" stroke="${outline}" stroke-width="1" stroke-linejoin="round"/>`;
  return tri(40, 34, 10) + tri(50, 28, 14) + tri(60, 34, 10);
}

// --- Accents par type, derriere le corps ---
function backAccent(type, tier, P, glow) {
  if (type === 'Eau') { // nageoires-lames
    return `
      <path d="M50 24 L70 8 L62 30 Z" fill="${P.light}" stroke="${P.outline}" stroke-width="1.5"/>
      <path d="M76 62 L98 50 L80 70 Z" fill="${P.light}" stroke="${P.outline}" stroke-width="1.5"/>`;
  }
  if (type === 'Feu' && tier >= 3) { // ailes de dragon
    return `
      <path d="M30 50 Q2 30 4 10 Q26 24 40 48 Z" fill="${P.deep}" stroke="${P.outline}" stroke-width="1.5"/>
      <path d="M70 50 Q98 30 96 10 Q74 24 60 48 Z" fill="${P.deep}" stroke="${P.outline}" stroke-width="1.5"/>`;
  }
  if (type === 'Plante' && tier >= 2) { // grandes feuilles-lames
    return `
      <path d="M26 48 L2 30 L8 54 Z" fill="#3fae4a" stroke="${shade('#2f7d33',-0.3)}" stroke-width="1.5"/>
      <path d="M74 48 L98 30 L92 54 Z" fill="#3fae4a" stroke="${shade('#2f7d33',-0.3)}" stroke-width="1.5"/>`;
  }
  return '';
}

// --- Accents devant (crete de feu, feuille, etc.) ---
function frontAccent(type, tier, P, glow, u) {
  let m = '';
  if (type === 'Feu') {
    const flame = (x, s) => `<path d="M${x} ${30-s} Q${x-4} ${42-s} ${x-2} 44 Q${x} 36 ${x+2} 44 Q${x+4} ${42-s} ${x} ${30-s} Z" fill="url(#fl${u})"/>`;
    m += flame(40, 7) + flame(50, 13) + flame(60, 7);
    m += `<path d="M75 70 q19 1 18 -17 q-5 11 -13 8 q7 -10 -6 -10 Z" fill="url(#fl${u})" stroke="${P.outline}" stroke-width="0.8"/>`;
  } else if (type === 'Plante') {
    m += `<path d="M50 30 q-2 -19 15 -25 q-4 17 -15 25" fill="#57c460" stroke="${shade('#2f7d33',-0.3)}" stroke-width="1.5"/>`;
    m += `<path d="M50 30 q4 -14 -12 -18 q3 12 12 18" fill="#76d27f" stroke="${shade('#2f7d33',-0.3)}" stroke-width="1.5"/>`;
  } else if (type === 'Eau') {
    m += `<circle cx="33" cy="62" r="3.5" fill="${glow}" opacity=".6"/><circle cx="67" cy="62" r="3.5" fill="${glow}" opacity=".6"/>`;
  }
  return m;
}

function bodyMarkup(shape, P) {
  const fill = `url(#bd${P.u})`, o = P.outline, sw = 2.5;
  switch (shape) {
    case 'beast':
      return `
        <path d="M74 66 q22 -3 16 -25 q-3 14 -16 14 Z" fill="${fill}" stroke="${o}" stroke-width="2"/>
        <path d="M30 80 l-3 8 M40 84 l-1 7 M60 84 l1 7 M70 80 l3 8" stroke="${P.deep}" stroke-width="3" stroke-linecap="round"/>
        <path d="M30 38 L20 12 L46 30 Z" fill="${fill}" stroke="${o}" stroke-width="2"/>
        <path d="M70 38 L80 12 L54 30 Z" fill="${fill}" stroke="${o}" stroke-width="2"/>
        <ellipse cx="50" cy="58" rx="28" ry="27" fill="${fill}" stroke="${o}" stroke-width="${sw}"/>
        <ellipse cx="50" cy="68" rx="14" ry="13" fill="${P.belly}" opacity=".35"/>`;
    case 'blob':
      return `
        <path d="M50 14 C24 22 20 56 24 68 C28 88 72 88 76 68 C80 56 76 22 50 14 Z" fill="${fill}" stroke="${o}" stroke-width="${sw}"/>
        <ellipse cx="50" cy="72" rx="17" ry="12" fill="${P.belly}" opacity=".3"/>`;
    case 'sprout':
      return `
        <path d="M32 82 l-2 8 M50 86 l0 7 M68 82 l2 8" stroke="${P.deep}" stroke-width="3" stroke-linecap="round"/>
        <ellipse cx="50" cy="60" rx="28" ry="26" fill="${fill}" stroke="${o}" stroke-width="${sw}"/>
        <ellipse cx="50" cy="70" rx="14" ry="12" fill="${P.belly}" opacity=".3"/>`;
    case 'serpent':
      return `
        <path d="M48 86 Q22 80 28 58 Q33 42 50 42 Q72 42 72 28" fill="none" stroke="${P.deep}" stroke-width="16" stroke-linecap="round"/>
        <path d="M48 86 Q22 80 28 58 Q33 42 50 42 Q72 42 72 28" fill="none" stroke="${fill}" stroke-width="11" stroke-linecap="round"/>
        <circle cx="64" cy="34" r="21" fill="${fill}" stroke="${o}" stroke-width="${sw}"/>`;
    case 'dino':
      return `
        <path d="M30 86 L28 68 M50 90 L50 68" stroke="${P.deep}" stroke-width="10" stroke-linecap="round"/>
        <path d="M70 78 q24 -2 22 -22 q-4 13 -16 11 Z" fill="${fill}" stroke="${o}" stroke-width="2"/>
        <ellipse cx="52" cy="60" rx="32" ry="25" fill="${fill}" stroke="${o}" stroke-width="${sw}"/>
        <circle cx="28" cy="46" r="16" fill="${fill}" stroke="${o}" stroke-width="${sw}"/>
        <path d="M14 50 q-6 2 -8 8 q8 -1 11 -3 Z" fill="${P.deep}"/>
        <ellipse cx="54" cy="66" rx="16" ry="12" fill="${P.belly}" opacity=".3"/>`;
    default:
      return `<circle cx="50" cy="56" r="30" fill="${fill}" stroke="${o}" stroke-width="${sw}"/>`;
  }
}

function eyeSpot(shape) {
  switch (shape) {
    case 'serpent': return { x: 64, y: 32, gap: 9, r: 5 };
    case 'dino':    return { x: 28, y: 44, gap: 8, r: 4.6 };
    case 'blob':    return { x: 50, y: 52, gap: 12, r: 6 };
    default:        return { x: 50, y: 54, gap: 13, r: 5.6 };
  }
}
function mouthSpot(shape) {
  switch (shape) {
    case 'serpent': return { x: 64, y: 44 };
    case 'dino':    return { x: 26, y: 56 };
    default:        return { x: 50, y: 68 };
  }
}

function sparkles() {
  const star = (x,y,s) => `<path d="M${x} ${y-s} L${x+s*0.3} ${y-s*0.3} L${x+s} ${y} L${x+s*0.3} ${y+s*0.3} L${x} ${y+s} L${x-s*0.3} ${y+s*0.3} L${x-s} ${y} L${x-s*0.3} ${y-s*0.3} Z" fill="#fff6c4"/>`;
  return star(18,22,6) + star(84,26,4.5) + star(82,74,5);
}

export function creatureSVG(creature, size = 80) {
  const u = ++UID;
  const color = creature.color || '#888';
  const type = creature.type || '';
  const rarity = creature.rarity || 1;
  const shape = creature.shape || 'blob';
  const tier = rarity <= 1 ? 1 : rarity <= 2 ? 2 : 3;
  const shiny = creature.variant === 1;
  const glow = GLOW[type] || '#ffe169';

  const P = {
    u, main: color,
    deep: shade(color, -0.5),
    outline: shade(color, -0.74),
    light: shade(color, 0.4),
    belly: shade(color, 0.55),
  };

  const defs = `<defs>
    <radialGradient id="bd${u}" cx="40%" cy="30%" r="80%">
      <stop offset="0%" stop-color="${P.light}"/>
      <stop offset="50%" stop-color="${P.main}"/>
      <stop offset="100%" stop-color="${P.deep}"/>
    </radialGradient>
    <radialGradient id="aura${u}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${glow}" stop-opacity="0.5"/>
      <stop offset="70%" stop-color="${glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fl${u}" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#ff6a1f"/><stop offset="55%" stop-color="#ffae2b"/><stop offset="100%" stop-color="#ffe773"/>
    </linearGradient>
    <filter id="glow${u}" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;

  const e = eyeSpot(shape);
  const mo = mouthSpot(shape);
  const headTop = shape === 'serpent' ? 16 : shape === 'dino' ? 32 : 32;
  const headCx = shape === 'serpent' ? 64 : shape === 'dino' ? 28 : 50;

  const shadow = `<ellipse cx="50" cy="92" rx="27" ry="6" fill="#000" opacity=".22"/>`;
  const aura = `<ellipse cx="50" cy="52" rx="50" ry="48" fill="url(#aura${u})"/>`;
  const ring = shiny ? `<rect x="2.5" y="2.5" width="95" height="95" rx="16" fill="none" stroke="#ffd34d" stroke-width="3"/>` : '';

  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="sprite">
    ${defs}${ring}${aura}${shadow}
    ${backAccent(type, tier, P, glow)}
    ${tier >= 2 ? backSpikes(P.deep, P.outline) : ''}
    ${tier >= 3 ? horns(headCx, headTop, P.deep, P.outline) : ''}
    ${bodyMarkup(shape, P)}
    ${frontAccent(type, tier, P, glow, u)}
    ${tier >= 2 ? fangs(mo.x, mo.y) : ''}
    ${badEyes(e.x, e.y, e.gap, e.r, glow, u)}
    ${shiny ? sparkles() : ''}
  </svg>`;
}
