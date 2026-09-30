import type { HandData, HandFrame } from "./types";
import type { InstrumentConfig } from "../config";
import { FRETS, TAIL_U, gripPoint, handlePoint, layout, pinchPoint, stringOffset, turnPoint } from "../instrument";
import { HAND_CONNECTIONS, dist } from "./geometry";

const COLORS = { neck: "#22d3ee", strum: "#fb923c", active: "rgba(34,211,238,0.5)", hold: "#38bdf8", mute: "#ef4444" };
// Flat, light instrument in the site's palette: white body and neck, sky-blue head, gold details.
const LOOK = {
  body: "rgba(255,255,255,0.9)",
  neck: "rgba(255,255,255,0.94)",
  line: "#ddd1c3",
  sky: "#0a9bbd",
  gold: "#d9a21b",
  ink: "#2b2521",
  muted: "#7f746a",
};

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: HandFrame | undefined,
  video: HTMLVideoElement | null,
  instrument: InstrumentConfig,
  only?: 0 | 1, // the one string being played; the other is drawn switched off
  target?: { string: 0 | 1; fret: number }, // learning mode: the note to play now
): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);

  if (video && video.readyState >= 2) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
  }

  drawInstrument(ctx, instrument, frame, w, h, only, target);
  if (!frame) return;
  if (frame.neck) drawHand(ctx, frame.neck, COLORS.neck, w, h);
  if (frame.strum) drawHand(ctx, frame.strum, COLORS.strum, w, h);
  if (frame.neck) drawGrip(ctx, frame, w, h);
  if (frame.placing) drawHandle(ctx, instrument, frame, w, h);
  if (frame.palmsHold) for (const hand of [frame.neck, frame.strum]) if (hand) drawHold(ctx, hand, frame.palmsHold, w, h);
}

// Drawn in a local frame along the strings: x = px from the nut, y = px across (down).
function drawInstrument(
  ctx: CanvasRenderingContext2D,
  cfg: InstrumentConfig,
  frame: HandFrame | undefined,
  w: number,
  h: number,
  only?: 0 | 1,
  target?: { string: 0 | 1; fret: number },
): void {
  const L = layout(cfg, w / h, frame?.pose);
  const len = L.length * h;
  const px = (u: number) => u * len;
  const half = (cfg.neckWidth / 2) * h;
  const bw = (cfg.bodyWidth / 2) * h;
  const neckEnd = px(cfg.neckEnd);
  const n = cfg.neckEnd;
  const widest = px((n + TAIL_U) / 2 + 0.03);

  ctx.save();
  ctx.translate(L.nut.x * w, L.nut.y * h);
  ctx.rotate(Math.atan2(L.dir.y, L.dir.x));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Pear-shaped body: a white card with a soft shadow, gold rosette.
  const body = new Path2D();
  body.moveTo(neckEnd, -half);
  body.bezierCurveTo(px(n + 0.04), -half, px(n + 0.07), -bw, widest, -bw);
  body.bezierCurveTo(px(0.98), -bw, px(TAIL_U), -bw * 0.6, px(TAIL_U), 0);
  body.bezierCurveTo(px(TAIL_U), bw * 0.6, px(0.98), bw, widest, bw);
  body.bezierCurveTo(px(n + 0.07), bw, px(n + 0.04), half, neckEnd, half);
  body.closePath();
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = LOOK.body;
  ctx.fill(body);
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = LOOK.line;
  ctx.lineWidth = 1.5;
  ctx.stroke(body);
  ctx.strokeStyle = LOOK.gold;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px(n + 0.11), 0, bw * 0.34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(px(n + 0.11), 0, bw * 0.24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Neck: a white rounded bar; head: a sky-blue cap with gold pegs.
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = LOOK.neck;
  ctx.beginPath();
  ctx.roundRect(0, -half, neckEnd + 6, half * 2, half * 0.45);
  ctx.fill();
  ctx.fillStyle = LOOK.sky;
  ctx.beginPath();
  ctx.roundRect(px(-0.085), -half * 0.9, px(0.085) + 4, half * 1.8, half * 0.6);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = LOOK.gold;
  for (const [u, side] of [[-0.025, -1], [-0.06, 1]] as const) {
    ctx.beginPath();
    ctx.arc(px(u), side * half * 1.2, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Active fret, fret lines, and small numbers above the neck.
  const fret = frame?.fret ?? 0;
  if (fret > 0) {
    ctx.fillStyle = "rgba(10,155,189,0.22)";
    ctx.fillRect(px(L.wires[fret - 1]), -half, px(L.wires[fret] - L.wires[fret - 1]), half * 2);
  }
  ctx.font = `700 ${Math.round(h * 0.022)}px Manrope, system-ui, sans-serif`;
  ctx.textAlign = "center";
  for (let k = 0; k <= FRETS; k++) {
    const x = px(L.wires[k]);
    ctx.strokeStyle = k === 0 ? LOOK.ink : LOOK.line;
    ctx.lineWidth = k === 0 ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(x, -half + 3);
    ctx.lineTo(x, half - 3);
    ctx.stroke();
    if (k > 0) {
      const mx = px((L.wires[k - 1] + L.wires[k]) / 2);
      if (k === fret) {
        ctx.fillStyle = LOOK.sky;
        ctx.beginPath();
        ctx.arc(mx, -half - 12, h * 0.019, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
      }
      ctx.textBaseline = "middle";
      ctx.fillText(String(k), mx, -half - 12);
    }
  }

  // Learning mode: the fret to hold (gold frame) and the string to strike (gold).
  if (target) {
    ctx.strokeStyle = LOOK.gold;
    ctx.lineWidth = 3.5;
    if (target.fret > 0) {
      const x0 = px(L.wires[target.fret - 1]);
      ctx.beginPath();
      ctx.roundRect(x0 + 1, -half - 2, px(L.wires[target.fret]) - x0 - 2, half * 2 + 4, 6);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, stringOffset(target.string, 0, cfg) * h);
    ctx.lineTo(len, stringOffset(target.string, 1, cfg) * h);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Bridge (gold) and the two strings in ink (the top one is the thicker bass string).
  ctx.fillStyle = LOOK.gold;
  ctx.beginPath();
  ctx.roundRect(len - 4, -cfg.stringGapBridge * h * 0.9, 8, cfg.stringGapBridge * h * 1.8, 4);
  ctx.fill();
  ctx.strokeStyle = LOOK.ink;
  for (const i of [0, 1] as const) {
    const off = only !== undefined && i !== only;
    ctx.globalAlpha = off ? 0.25 : 0.9;
    ctx.setLineDash(off ? [8, 8] : []);
    ctx.lineWidth = i === 0 ? 2.6 : 1.8;
    ctx.beginPath();
    ctx.moveTo(0, stringOffset(i, 0, cfg) * h);
    ctx.lineTo(len, stringOffset(i, 1, cfg) * h);
    ctx.stroke();
  }
  ctx.restore();
}

// Placing mode: two rings. Middle of the body (✥): right-hand pinch moves the dombyra. Middle of the neck
// (⟲): left-hand pinch turns it. Each is dashed when idle, white when its hand's pinch is over it, and
// solid in the hand's color while in use.
function drawHandle(ctx: CanvasRenderingContext2D, cfg: InstrumentConfig, frame: HandFrame, w: number, h: number): void {
  const L = layout(cfg, w / h, frame.pose);
  const moving = !!frame.dragging && !frame.turning;
  drawRing(ctx, handlePoint(L), "✥", COLORS.strum, frame.strum, moving, cfg, w, h);
  drawRing(ctx, turnPoint(L), "⟲", COLORS.neck, frame.neck, !!frame.turning, cfg, w, h);
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  c: { x: number; y: number },
  icon: string,
  color: string,
  hand: HandData | undefined,
  active: boolean,
  cfg: InstrumentConfig,
  w: number,
  h: number,
): void {
  const hover = !!hand && dist(pinchPoint(hand.points), c, w / h) <= cfg.grabRadius;
  const r = cfg.grabRadius * h;
  ctx.save();
  ctx.fillStyle = active ? color : "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.arc(c.x * w, c.y * h, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.setLineDash(active || hover ? [] : [6, 6]);
  ctx.strokeStyle = active ? "#fff" : hover ? "#fff" : color;
  ctx.lineWidth = active ? 5 : hover ? 4 : 3;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(r * 0.9)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(icon, c.x * w, c.y * h);
  ctx.restore();
}

// Ring around the palm dot: the point fret detection uses. Blue on a fret, white off the frets; a pill
// above the hand shows the fret (or MUTE).
function drawGrip(ctx: CanvasRenderingContext2D, frame: HandFrame, w: number, h: number): void {
  const hand = frame.neck!;
  const g = gripPoint(hand.points);
  ctx.save();
  ctx.strokeStyle = frame.fret > 0 ? COLORS.neck : "#fff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(g.x * w, g.y * h, 15, 0, Math.PI * 2);
  ctx.stroke();

  const label = frame.muted ? "MUTE" : frame.fret > 0 ? `лад ${frame.fret}` : "открытая";
  ctx.font = `700 ${Math.round(h * 0.026)}px Manrope, system-ui, sans-serif`;
  const tw = ctx.measureText(label).width;
  const top = Math.min(...hand.points.map((p) => p.y)) * h - 16;
  const x = hand.palm.x * w;
  const ph = h * 0.042;
  ctx.fillStyle = frame.muted ? COLORS.mute : "rgba(255,255,255,0.95)";
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.roundRect(x - tw / 2 - 12, top - ph, tw + 24, ph, ph / 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = frame.muted ? "#fff" : "#0e7490";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, top - ph / 2);
  ctx.restore();
}

// Filling ring around a palm while both open palms are held (the move-mode gesture).
function drawHold(ctx: CanvasRenderingContext2D, hand: HandData, progress: number, w: number, h: number): void {
  const r = Math.max(28, hand.size * h * 0.9);
  const x = hand.palm.x * w;
  const y = hand.palm.y * h;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = COLORS.hold;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Hand skeleton: rounded bones with a dark outline so they read on any background, white joints,
// bigger fingertips, and a palm dot in the hand's color.
const FINGERTIPS = new Set([4, 8, 12, 16, 20]);

function drawHand(ctx: CanvasRenderingContext2D, hand: HandData, color: string, w: number, h: number): void {
  const p = hand.points;
  const bones = new Path2D();
  for (const [a, b] of HAND_CONNECTIONS) {
    bones.moveTo(p[a].x * w, p[a].y * h);
    bones.lineTo(p[b].x * w, p[b].y * h);
  }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 8;
  ctx.stroke(bones);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke(bones);
  p.forEach((q, i) => {
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(q.x * w, q.y * h, FINGERTIPS.has(i) ? 5.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.fillStyle = color;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(hand.palm.x * w, hand.palm.y * h, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
