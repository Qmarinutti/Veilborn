// =====================================================================
//  Rend les sprites transparents : enleve le fond (pastel) par
//  propagation depuis les bords, qui s'arrete sur les contours du Glump.
//  Lit/ecrit public/sprites/*.png (les fichiers deviennent de vrais PNG RGBA).
//  Usage : node tools/transparent.mjs
// =====================================================================
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, '..', 'public', 'sprites');
const THRESH = 90; // distance couleur (Manhattan) max pour "meme fond"

function decode(buf) {
  // PNG deja transparent -> on saute ; sinon JPEG.
  if (buf[0] === 0x89 && buf[1] === 0x50) return null;
  return jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
}

function removeBg(img) {
  const { width: w, height: h, data } = img;
  const N = w * h;

  // Couleur de fond de reference = moyenne de 4 patchs de coins (12x12).
  let rr = 0, gg = 0, bb = 0, cnt = 0;
  const corners = [[0, 0], [w - 12, 0], [0, h - 12], [w - 12, h - 12]];
  for (const [cx, cy] of corners) {
    for (let y = cy; y < cy + 12; y++) for (let x = cx; x < cx + 12; x++) {
      const i = (y * w + x) * 4; rr += data[i]; gg += data[i + 1]; bb += data[i + 2]; cnt++;
    }
  }
  rr /= cnt; gg /= cnt; bb /= cnt;
  const LOCAL = 26;   // pas max entre voisins (suit un degrade doux)
  const GLOBAL = 135; // ecart max au fond de reference (n'entre pas dans le sujet sature)
  const distRef = (i) => Math.abs(data[i * 4] - rr) + Math.abs(data[i * 4 + 1] - gg) + Math.abs(data[i * 4 + 2] - bb);

  const bg = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0, tail = 0;
  const seed = (i) => { if (!bg[i] && distRef(i) <= GLOBAL) { bg[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const i = queue[head++];
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const x = i % w, y = (i / w) | 0;
    const nbrs = [];
    if (x > 0) nbrs.push(i - 1);
    if (x < w - 1) nbrs.push(i + 1);
    if (y > 0) nbrs.push(i - w);
    if (y < h - 1) nbrs.push(i + w);
    for (const j of nbrs) {
      if (bg[j]) continue;
      const local = Math.abs(data[j * 4] - r) + Math.abs(data[j * 4 + 1] - g) + Math.abs(data[j * 4 + 2] - b);
      if (local <= LOCAL && distRef(j) <= GLOBAL) { bg[j] = 1; queue[tail++] = j; }
    }
  }

  let removed = 0;
  for (let i = 0; i < N; i++) if (bg[i]) { data[i * 4 + 3] = 0; removed++; }
  return removed / N;
}

const files = readdirSync(DIR).filter(f => f.endsWith('.png'));
let done = 0, skipped = 0, suspect = 0;
for (const f of files) {
  const path = join(DIR, f);
  const buf = readFileSync(path);
  const img = decode(buf);
  if (!img) { skipped++; continue; }
  const ratio = removeBg(img);
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  writeFileSync(path, PNG.sync.write(png));
  done++;
  // Si on a enleve quasiment tout (>97%) ou presque rien (<8%), c'est louche.
  if (ratio > 0.97 || ratio < 0.08) { suspect++; console.log(`  ? ${f} : ${(ratio * 100).toFixed(0)}% enleve (a verifier)`); }
  if (done % 40 === 0) console.log(`  ... ${done}/${files.length}`);
}
console.log(`\n  Termine : ${done} detoures, ${skipped} deja PNG, ${suspect} a verifier.\n`);
