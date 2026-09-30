// Turns recordings of single plucked notes into the sampler's files:
//   node scripts/prepare-samples.mjs <dir-with-wavs> [maxCents=15] [seconds=4]
// For each 16-bit PCM WAV: detects the pitch (YIN), cuts the silence before the attack (so notes sound
// the instant a string is crossed), trims to `seconds` with a fade-out, normalizes the level, and writes
// public/samples/<Note>.wav plus public/samples/manifest.json for audio.ts. Notes more than maxCents off
// pitch are skipped; if two files give the same note, the better-tuned one wins.
// Phone recordings (m4a/mp3) on macOS: afconvert -f WAVE -d LEI16@44100 -c 1 in.m4a out.wav
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const OUT = new URL("../public/samples/", import.meta.url);
const FADE_S = 0.4;
const PEAK = 0.89;

function readWav(file) {
  const b = readFileSync(file);
  let o = 12;
  let rate = 44100;
  while (o < b.length) {
    const id = b.toString("ascii", o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === "fmt ") {
      if (b.readUInt16LE(o + 8) !== 1 || b.readUInt16LE(o + 10) !== 1 || b.readUInt16LE(o + 22) !== 16) {
        throw new Error(`${file}: need 16-bit mono PCM WAV`);
      }
      rate = b.readUInt32LE(o + 12);
    }
    if (id === "data") {
      const data = new Float32Array(size / 2);
      for (let i = 0; i < data.length; i++) data[i] = b.readInt16LE(o + 8 + i * 2) / 32768;
      return { data, rate };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error(`${file}: no data chunk`);
}

function writeWav(url, data, rate) {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + data.length * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  writeFileSync(url, b);
}

// YIN fundamental estimate on a 4096-sample window starting at `start`.
function pitch(x, rate, start) {
  const N = 4096;
  const maxLag = Math.floor(rate / 60);
  const minLag = Math.floor(rate / 1000);
  const cm = new Float64Array(maxLag + 2);
  let run = 0;
  cm[0] = 1;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i < N; i++) {
      const e = x[start + i] - x[start + i + lag];
      s += e * e;
    }
    run += s;
    cm[lag] = (s * lag) / run;
  }
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (cm[lag] < 0.12) {
      while (lag < maxLag && cm[lag + 1] < cm[lag]) lag++;
      best = lag;
      break;
    }
  }
  if (best < 0) {
    let m = Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) if (cm[lag] < m) (m = cm[lag]), (best = lag);
  }
  const [a, b, c] = [cm[best - 1], cm[best], cm[best + 1]];
  return rate / (best + (a - c) / (2 * (a - 2 * b + c)));
}

const [dir, maxCentsArg, secondsArg] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node scripts/prepare-samples.mjs <dir-with-wavs> [maxCents=15] [seconds=4]");
  process.exit(1);
}
const maxCents = Number(maxCentsArg ?? 15);
const LENGTH_S = Number(secondsArg ?? 4);
const best = new Map(); // note → { cents, data, rate, file }

for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".wav")).sort()) {
  const { data, rate } = readWav(join(dir, file));
  let peak = 0;
  let peakAt = 0;
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > peak) (peak = Math.abs(data[i])), (peakAt = i);
  let onset = 0;
  while (onset < peakAt && Math.abs(data[onset]) < peak * 0.03) onset++;
  const hz = pitch(data, rate, Math.min(peakAt + Math.floor(rate * 0.08), data.length - 8192));
  const midi = 69 + 12 * Math.log2(hz / 440);
  const note = Math.round(midi);
  const cents = Math.round((midi - note) * 100);
  const name = `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
  const ok = Math.abs(cents) <= maxCents;
  console.log(`${file.padEnd(16)} ${hz.toFixed(1).padStart(6)} Hz  ${name.padEnd(3)} ${String(cents).padStart(4)} cents  ${ok ? "" : "skipped: out of tune"}`);
  if (!ok || (best.has(name) && Math.abs(best.get(name).cents) <= Math.abs(cents))) continue;

  // From 2 ms before the attack, LENGTH_S long, faded out, normalized.
  const start = Math.max(0, onset - Math.floor(rate * 0.002));
  const out = data.slice(start, start + Math.floor(rate * LENGTH_S));
  const fade = Math.floor(rate * FADE_S);
  for (let i = 0; i < fade && i < out.length; i++) out[out.length - 1 - i] *= i / fade;
  const gain = PEAK / peak;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  best.set(name, { cents, data: out, rate, file });
}

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".wav")) rmSync(new URL(f, OUT)); // replace the old set
const notes = {};
for (const [name, s] of best) {
  const fileName = `${name.replace("#", "s")}.wav`;
  writeWav(new URL(fileName, OUT), s.data, s.rate);
  notes[name] = fileName;
}
writeFileSync(new URL("manifest.json", OUT), JSON.stringify({ notes }, null, 2) + "\n");
console.log(`\n${best.size} notes → public/samples/: ${Object.keys(notes).join(", ")}`);
