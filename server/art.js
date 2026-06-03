// Detection automatique des images de Glumps : scanne public/sprites/*.png.
// Deposer "monid.png" suffit pour que l'image s'affiche (aucune edition de code).
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPRITES_DIR = join(__dirname, '..', 'public', 'sprites');

let cache = new Set();
let lastScan = 0;

// Renvoie l'ensemble des ids ayant une image (re-scan au plus toutes les 3s).
export function artSet() {
  const now = Date.now();
  if (now - lastScan > 3000) {
    try {
      cache = new Set(
        readdirSync(SPRITES_DIR)
          .filter(f => f.toLowerCase().endsWith('.png'))
          .map(f => f.slice(0, -4))
      );
    } catch {
      cache = new Set();
    }
    lastScan = now;
  }
  return cache;
}

export function hasArt(speciesId) {
  return artSet().has(speciesId);
}
