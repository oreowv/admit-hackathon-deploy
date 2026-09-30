// Synthetic HandFrame recording so P2 can start before real camera recordings exist.
// Neck hand slides across frets 1→6 and makes a fist every few seconds;
// strum hand swings up/down with varying speed, weak strums, and leaves the frame for 2 s.
import { writeFileSync } from "node:fs";

const FPS = 30;
const DURATION = 20_000;
const round = (n) => Math.round(n * 1e5) / 1e5;

function hand(cx, cy, fist = false, s = 0.1) {
  const pts = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  pts[0] = { x: cx, y: cy + s, z: 0 };
  [-0.3, -0.1, 0.1, 0.3].forEach((c, i) => {
    const mcp = 5 + i * 4;
    const x = cx + c * s;
    pts[mcp] = { x, y: cy, z: 0 };
    pts[mcp + 1] = { x, y: cy - 0.4 * s, z: 0 };
    pts[mcp + 2] = { x, y: fist ? cy + 0.1 * s : cy - 0.7 * s, z: 0 };
    pts[mcp + 3] = { x, y: fist ? cy + 0.3 * s : cy - 0.9 * s, z: 0 };
  });
  for (let i = 1; i <= 4; i++) pts[i] = { x: cx - 0.5 * s, y: cy + 0.5 * s - i * 0.1 * s, z: 0 };
  return {
    points: pts.map((p) => ({ x: round(p.x), y: round(p.y), z: 0 })),
    palm: { x: round(cx), y: round(cy + 0.2 * s) },
    size: round(s),
  };
}

const frames = [];
for (let t = 0; t <= DURATION; t += 1000 / FPS) {
  const sec = t / 1000;
  const fret = 1 + (Math.floor(sec / 1.5) % 6);
  const muted = sec % 5 > 4.2;
  const neckX = 0.04 + (fret - 0.5) * 0.07;

  // strum: slow (0–6 s), fast (6–12 s), weak/short (12–16 s), gone (16–18 s), far/small (18–20 s)
  let strum;
  if (sec < 16 || sec >= 18) {
    const [freq, amp, size] = sec < 6 ? [1, 0.18, 0.1] : sec < 12 ? [3, 0.18, 0.1] : sec < 16 ? [2, 0.05, 0.1] : [2, 0.1, 0.045];
    strum = hand(0.72, 0.55 + amp * Math.sin(2 * Math.PI * freq * sec), false, size);
  }
  frames.push({
    t: round(t),
    neck: hand(neckX, 0.5, muted),
    ...(strum && { strum }),
    fret,
    muted,
  });
}

const rec = { version: 1, createdAt: new Date().toISOString(), label: "synthetic-demo", width: 1280, height: 720, frames };
writeFileSync(new URL("../recordings/synthetic-demo.json", import.meta.url), JSON.stringify(rec));
console.log(`${frames.length} frames → recordings/synthetic-demo.json`);
