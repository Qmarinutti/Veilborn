// ============================================================
//  Audio Veilborn — 100% synthetise (WebAudio), aucun fichier.
//  - SFX : click, success, error, nav (blips courts).
//  - Musique d'ambiance : pad + arpege pentatonique, boucle douce.
//  - Reglages persistes (localStorage) : sons on/off, musique on/off.
//  L'AudioContext ne demarre qu'apres la 1ere interaction (politique navigateur).
// ============================================================

const LS_SFX = 'veilborn_sfx';
const LS_MUS = 'veilborn_music';

let ctx = null;
let master = null;        // gain global SFX
let musicGain = null;     // gain musique
let musicTimer = null;
let started = false;

const state = {
  sfx: localStorage.getItem(LS_SFX) !== '0',     // defaut ON
  music: localStorage.getItem(LS_MUS) !== '0',   // defaut ON
};

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.0; musicGain.connect(ctx.destination);
  return ctx;
}

// ---------- SFX ----------
function blip(freq, dur, type = 'triangle', vol = 0.25, slideTo = null) {
  if (!state.sfx || !ensureCtx() || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  click() { blip(420, 0.10, 'triangle', 0.22, 520); },
  nav()   { blip(300, 0.08, 'sine', 0.16, 360); },
  success() { blip(523, 0.10, 'triangle', 0.22); setTimeout(() => blip(784, 0.16, 'triangle', 0.22), 90); },
  error() { blip(220, 0.20, 'sawtooth', 0.18, 140); },
  pop()   { blip(660, 0.09, 'sine', 0.20, 880); },
};

// ---------- Musique d'ambiance (generative) ----------
// Progression douce vi-IV-I-V en Do (La min / Fa / Do / Sol). Gamme penta pour l'arpege.
const N = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi -> Hz
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const PENTA = [60, 62, 64, 67, 69, 72, 74, 76]; // Do penta majeure
let chordIdx = 0;
let arpStep = 0;

function padChord(notes, when, dur) {
  notes.forEach((m, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1400;
    o.type = i === 0 ? 'sine' : 'triangle';
    o.frequency.value = N(m) / (i === 0 ? 2 : 1); // basse a l'octave en-dessous
    o.detune.value = (i - 1) * 4;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.09, when + 0.8);   // attaque lente
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur); // relache
    o.connect(f); f.connect(g); g.connect(musicGain);
    o.start(when); o.stop(when + dur + 0.1);
  });
}

function arpNote(midi, when) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = N(midi);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.06, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);
  o.connect(g); g.connect(musicGain);
  o.start(when); o.stop(when + 0.55);
}

let nextTime = 0;
const BEAT = 0.5;          // 120 BPM croche
const BAR = BEAT * 8;      // 4 temps
function scheduler() {
  if (!ctx) return;
  while (nextTime < ctx.currentTime + 0.4) {
    if (arpStep % 8 === 0) {
      padChord(CHORDS[chordIdx], nextTime, BAR);
      chordIdx = (chordIdx + 1) % CHORDS.length;
    }
    // arpege : une note penta sur deux croches, motif doux
    if (arpStep % 2 === 0) {
      const m = PENTA[(arpStep / 2 + chordIdx * 2) % PENTA.length];
      arpNote(m, nextTime);
    }
    arpStep = (arpStep + 1) % 64;
    nextTime += BEAT;
  }
}

function startMusic() {
  if (!ensureCtx() || musicTimer) return;
  nextTime = ctx.currentTime + 0.1;
  arpStep = 0; chordIdx = 0;
  musicTimer = setInterval(scheduler, 120);
  // fondu d'entree
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
  musicGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2.5);
}
function stopMusic() {
  if (!ctx) return;
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
  musicGain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 0.8);
  clearInterval(musicTimer); musicTimer = null;
}

// ---------- Demarrage au 1er geste utilisateur ----------
export function initAudioOnGesture() {
  if (started) return;
  started = true;
  const kick = () => {
    ensureCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (state.music) startMusic();
    window.removeEventListener('pointerdown', kick);
    window.removeEventListener('keydown', kick);
  };
  window.addEventListener('pointerdown', kick, { once: false });
  window.addEventListener('keydown', kick, { once: false });
}

// ---------- Reglages ----------
export const audioSettings = {
  get sfx() { return state.sfx; },
  get music() { return state.music; },
  toggleSfx() {
    state.sfx = !state.sfx;
    localStorage.setItem(LS_SFX, state.sfx ? '1' : '0');
    if (state.sfx) sfx.click();
    return state.sfx;
  },
  toggleMusic() {
    state.music = !state.music;
    localStorage.setItem(LS_MUS, state.music ? '1' : '0');
    if (state.music) { ensureCtx(); if (ctx && ctx.state === 'suspended') ctx.resume(); startMusic(); }
    else stopMusic();
    return state.music;
  },
};
