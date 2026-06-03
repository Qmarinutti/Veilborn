// =====================================================================
//  Genere ~300 Glumps procedurale : ecrit tools/glumps.txt (pour le jeu)
//  et tools/descriptions.txt (brief par monstre pour faire les sprites).
//  Usage :  node tools/make300.mjs   puis   npm run gen
// =====================================================================
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = 300;

// 14 types + ambiance pour les descriptions
const TYPES = {
  Feu:      { roots: ['Pyro','Embr','Cinder','Blaz','Ignis','Scorch','Magma','Ashen','Flare','Vulcan','Pyra','Brimst'], adj: 'de feu',     feat: 'flammes vives, braises rougeoyantes', col: 'orange et rouge ardent' },
  Eau:      { roots: ['Aqua','Tidal','Hydro','Marin','Wav','Coral','Nautil','Brine','Mer','Onde','Naia','Pelag'],        adj: "d'eau",     feat: 'nageoires, motifs aquatiques, gouttes', col: 'bleu et turquoise' },
  Plante:   { roots: ['Flor','Verd','Sprout','Thorn','Leaf','Myco','Bramb','Petal','Sylv','Root','Folia','Sporel'],     adj: 'de plante', feat: 'feuilles, vrilles, fleurs', col: 'vert vif' },
  Foudre:   { roots: ['Volt','Spark','Zap','Thund','Amper','Static','Bolt','Galvan','Joule','Tesl','Ohmn','Fulgur'],    adj: 'de foudre', feat: 'eclairs, etincelles, energie crepitante', col: 'jaune electrique' },
  Roche:    { roots: ['Crag','Bould','Terra','Granit','Rock','Geo','Stalag','Pebbl','Basalt','Mont','Slate','Quarz'],   adj: 'de roche',  feat: 'plaques rocheuses, cristaux mineraux', col: 'brun et gris pierre' },
  Glace:    { roots: ['Frost','Glaci','Cryo','Borea','Rime','Shiver','Hail','Permaf','Icel','Snow','Niv','Gelid'],      adj: 'de glace',  feat: 'cristaux de glace, givre, eclats gelis', col: 'bleu glacial clair' },
  Ombre:    { roots: ['Shade','Noct','Umbr','Dusk','Gloom','Wraith','Murk','Eclips','Nyx','Vesper','Sombr','Tenebr'],   adj: "d'ombre",   feat: 'volutes d ombre, yeux luisants', col: 'violet sombre et noir' },
  Lumiere:  { roots: ['Lumi','Sol','Radian','Aurel','Gleam','Halo','Lux','Dawn','Photon','Celest','Clari','Phos'],      adj: 'de lumiere',feat: 'halo lumineux, plumes brillantes', col: 'dore et blanc eclatant' },
  Mystique: { roots: ['Psy','Myst','Oracl','Astra','Esper','Rune','Arcan','Enigm','Aether','Sage','Visio','Numen'],    adj: 'mystique',  feat: 'runes flottantes, gemmes, aura magique', col: 'rose et violet iridescent' },
  Acier:    { roots: ['Cog','Ferro','Titan','Chrom','Steel','Iron','Magn','Plate','Gear','Forge','Rivet','Alloy'],     adj: "d'acier",   feat: 'plaques metalliques, rivets, articulations', col: 'argent et acier bleute' },
  Poison:   { roots: ['Venom','Toxi','Mala','Sept','Viru','Acid','Bane','Noxi','Sludge','Spor','Mias','Putr'],         adj: 'de poison', feat: 'crachats acides, bulles toxiques', col: 'violet et vert venimeux' },
  Vent:     { roots: ['Zephyr','Gust','Aero','Cyclon','Galew','Strato','Breez','Tempes','Skye','Aquilon','Vol','Buran'],adj: 'de vent',   feat: 'ailes, tourbillons d air', col: 'blanc et cyan leger' },
  Insecte:  { roots: ['Chitin','Larv','Manti','Beetl','Scarab','Vespi','Arac','Crawl','Hive','Stag','Mandi','Apid'],   adj: 'insecte',   feat: 'carapace, pinces, antennes', col: 'vert et brun chitineux' },
  Dragon:   { roots: ['Drake','Wyver','Draco','Ryu','Saur','Brood','Grim','Dragn','Nidh','Bahas','Fafn','Smaug'],      adj: 'dragon',    feat: 'ecailles, cornes, ailes membraneuses', col: 'violet profond et reflets' },
};

// Termes anglais propres pour les prompts de sprites : [type, features, couleurs]
const EN = {
  Feu:      ['fire',     'bright flames and glowing embers',        'orange and fiery red'],
  Eau:      ['water',    'fins, water motifs and droplets',         'blue and turquoise'],
  Plante:   ['grass',    'leaves, vines and flowers',               'vivid green'],
  Foudre:   ['electric', 'lightning bolts and crackling sparks',    'electric yellow'],
  Roche:    ['rock',     'rocky plates and mineral crystals',       'brown and stone-grey'],
  Glace:    ['ice',      'ice crystals, frost and frozen shards',   'pale glacial blue'],
  Ombre:    ['dark',     'wisps of shadow and glowing eyes',        'dark purple and black'],
  Lumiere:  ['light',    'glowing halo and shining feathers',       'gold and radiant white'],
  Mystique: ['psychic',  'floating runes, gems and a magic aura',   'iridescent pink and purple'],
  Acier:    ['steel',    'metal plates, rivets and joints',         'silver and steel-blue'],
  Poison:   ['poison',   'acid spit and toxic bubbles',             'purple and venomous green'],
  Vent:     ['wind',     'wings and swirling air currents',         'white and light cyan'],
  Insecte:  ['bug',      'carapace, pincers and antennae',          'green and chitin-brown'],
  Dragon:   ['dragon',   'scales, horns and membranous wings',      'deep purple with sheen'],
};

const SUF1 = ['kit','ling','pup','let','mite','bud','ette','in','o','y'];
const SUF2 = ['claw','fang','maw','wing','horn','back','jaw','tail','crest','paw'];
const SUF3 = ['naught','thron','zar','rex','khan','mancer','lord','goth','drake','titan','arch','myr'];

const STAGE_WORD = ['petit bebe mignon', 'forme adolescente plus agile et feroce', 'forme finale grande et puissante (badass)'];
const STAGE_DEMEAN = ['curieux et amical', 'confiant et combatif', 'imposant et menacant'];

// PRNG deterministe pour rester reproductible d'une execution a l'autre.
let seed = 1337;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function slug(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

const usedIds = new Set();
function uniqueName(root, suf) {
  let base = cap(root) + suf;
  let id = slug(base), n = 1;
  while (usedIds.has(id)) { base = cap(root) + suf + n; id = slug(base); n++; }
  usedIds.add(id);
  return base;
}

// --- Starters fixes (ids deja utilises par les comptes existants) ---
const lines = [];
function addStarter(type, names) {
  names.forEach(n => usedIds.add(slug(n)));
  lines.push({ type, names, starter: true });
}
addStarter('Feu', ['Flammkit', 'Pyrokit', 'Infernaught']);
addStarter('Eau', ['Aquolet', 'Tidolet', 'Leviaqua']);
addStarter('Plante', ['Sprouty', 'Floracub', 'Verdantaur']);

// --- Generation procedurale jusqu'a TARGET ---
const typeKeys = Object.keys(TYPES);
let count = lines.reduce((s, l) => s + l.names.length, 0);
let ti = 0;
while (count < TARGET) {
  const type = typeKeys[ti % typeKeys.length]; ti++;
  const root = pick(TYPES[type].roots);
  const roll = rnd();
  const len = count > TARGET - 3 ? (TARGET - count) // ajuste la fin pile a 300
            : roll < 0.62 ? 3 : roll < 0.85 ? 2 : 1;
  const sufs = [SUF1, SUF2, SUF3];
  const names = [];
  for (let i = 0; i < len; i++) {
    const sufArr = sufs[Math.min(i, 2)];
    names.push(uniqueName(root, pick(sufArr)));
  }
  lines.push({ type, names, single: len === 1 });
  count += len;
}

// --- Ecrit glumps.txt ---
let txt = `# Genere par tools/make300.mjs (${count} Glumps). Edite librement puis 'npm run gen'.\n`;
txt += `# Format : Type | Nom1 > Nom2 > Nom3   ( * = starter , Nom:rarete = rarete forcee )\n\n`;
for (const l of lines) {
  const chain = l.names.map((n, i) => {
    // legendaire solo -> rarete 5 ; final de chaine longue garde la rampe auto
    if (l.single) return `${n}:5`;
    return n;
  }).join(' > ');
  txt += `${l.starter ? '* ' : ''}${l.type.padEnd(9)}| ${chain}\n`;
}
writeFileSync(join(__dirname, 'glumps.txt'), txt, 'utf8');

// --- Ecrit descriptions.txt (brief pour les sprites) ---
let desc = `============================================================\n`;
desc += `  VEILBORN - ${count} GLUMPS - BRIEF SPRITES\n`;
desc += `  Pour chaque monstre : depose une image  public/sprites/<id>.png\n`;
desc += `  (l'<id> est indique entre crochets ; il s'affiche tout seul.)\n`;
desc += `============================================================\n\n`;

const STYLE = 'style mascotte de jeu, cel-shading, contours nets, eclairage de bord, couleurs vives, corps entier, centre, fond transparent, sans texte';
let idx = 0;
for (const l of lines) {
  const T = TYPES[l.type];
  l.names.forEach((name, i) => {
    idx++;
    const id = slug(name);
    const stageIdx = l.single ? 2 : i;
    const stage = l.single ? 'legendaire majestueux et imposant' : STAGE_WORD[Math.min(stageIdx, 2)];
    const demean = l.single ? 'fier et legendaire' : STAGE_DEMEAN[Math.min(stageIdx, 2)];
    const evoInfo = l.single ? 'legendaire solo' : `stade ${i + 1}/${l.names.length}`;
    const [enType, enFeat, enCol] = EN[l.type] || ['', '', ''];
    const enStage = l.single ? 'majestic legendary, powerful and imposing'
      : i === 0 ? 'small cute baby' : stageIdx >= 2 ? 'large powerful and badass' : 'agile and fierce';
    desc += `${String(idx).padStart(3, '0')}. [${id}.png]  ${name}  -  ${l.type} (${evoInfo})\n`;
    desc += `     EN: ${name}: a ${enStage} ${enType}-type monster, ${enCol}, ${enFeat}, stylized game mascot, cel-shading, bold clean outlines, rim lighting, vibrant colors, full body, centered, transparent background, no text.\n`;
    desc += `     FR: ${name}, Glump ${T.adj} - ${stage}, ${demean} ; ${T.feat} ; couleurs ${T.col}.\n\n`;
  });
}
writeFileSync(join(__dirname, 'descriptions.txt'), desc, 'utf8');

console.log(`\n  OK : ${count} Glumps (${lines.length} lignees)\n  -> tools/glumps.txt\n  -> tools/descriptions.txt\n  Lance maintenant :  npm run gen\n`);
