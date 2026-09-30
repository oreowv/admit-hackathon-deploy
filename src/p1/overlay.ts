import type { HandData, HandFrame } from "./types";
import type { InstrumentConfig } from "../config";
import { FRETS, TAIL_U, fromNeck, gripPoint, handlePoint, layout, pinchPoint, stringOffset } from "../instrument";
import { HAND_CONNECTIONS, dist } from "./geometry";

const COLORS = { neck: "#22d3ee", strum: "#fb923c", active: "rgba(34,211,238,0.45)" };
const WOOD = {
  head: "rgba(92,54,24,0.8)",
  neck: "rgba(122,74,34,0.6)",
  body: "rgba(168,108,52,0.45)",
  edge: "rgba(255,222,176,0.55)",
  wire: "rgba(235,235,235,0.75)",
  string: "rgba(250,245,232,0.95)",
};

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: HandFrame | undefined,
  video: HTMLVideoElement | null,
  instrument: InstrumentConfig,
  only?: 0 | 1, // the one string being played; the other is drawn switched off
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

  drawInstrument(ctx, instrument, frame, w, h, only);
  if (!frame) return;
  if (frame.neck) drawHand(ctx, frame.neck, COLORS.neck, w, h, frame.muted ? "MUTE" : `лад ${frame.fret}`);
  if (frame.strum) drawHand(ctx, frame.strum, COLORS.strum, w, h, `size ${frame.strum.size.toFixed(2)}`);
  if (frame.neck) drawGrip(ctx, frame, instrument, w, h);
  if (frame.placing) drawHandle(ctx, instrument, frame, w, h);
}

// Drawn in a local frame along the strings: x = px from the nut, y = px across (down).
function drawInstrument(
  ctx: CanvasRenderingContext2D,
  cfg: InstrumentConfig,
  frame: HandFrame | undefined,
  w: number,
  h: number,
  only?: 0 | 1,
): void {
  const L = layout(cfg, w / h, frame?.pose);
  const len = L.length * h;
  const px = (u: number) => u * len;
  const half = (cfg.neckWidth / 2) * h;
  const bw = (cfg.bodyWidth / 2) * h;
  const neckEnd = px(cfg.neckEnd);

  ctx.save();
  ctx.translate(L.nut.x * w, L.nut.y * h);
  ctx.rotate(Math.atan2(L.dir.y, L.dir.x));
  ctx.lineWidth = 2;
  ctx.strokeStyle = WOOD.edge;

  // Pear-shaped body: narrow where the neck joins, widest near the bridge.
  const n = cfg.neckEnd;
  const widest = px((n + TAIL_U) / 2 + 0.03);
  ctx.fillStyle = WOOD.body;
  ctx.beginPath();
  ctx.moveTo(neckEnd, -half);
  ctx.bezierCurveTo(px(n + 0.04), -half, px(n + 0.07), -bw, widest, -bw);
  ctx.bezierCurveTo(px(0.98), -bw, px(TAIL_U), -bw * 0.6, px(TAIL_U), 0);
  ctx.bezierCurveTo(px(TAIL_U), bw * 0.6, px(0.98), bw, widest, bw);
  ctx.bezierCurveTo(px(n + 0.07), bw, px(n + 0.04), half, neckEnd, half);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Head with two tuning pegs, then the neck.
  ctx.fillStyle = WOOD.head;
  ctx.fillRect(px(-0.08), -half * 0.8, px(0.08), half * 1.6);
  for (const u of [-0.025, -0.06]) {
    ctx.beginPath();
    ctx.arc(px(u), -half * 1.15, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = WOOD.neck;
  ctx.fillRect(0, -half, neckEnd, half * 2);
  ctx.strokeRect(0, -half, neckEnd, half * 2);

  // Active fret, fret wires and numbers.
  const fret = frame?.fret ?? 0;
  if (fret > 0) {
    ctx.fillStyle = COLORS.active;
    ctx.fillRect(px(L.wires[fret - 1]), -half, px(L.wires[fret] - L.wires[fret - 1]), half * 2);
  }
  ctx.strokeStyle = WOOD.wire;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = `${Math.round(h * 0.028)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  for (let k = 0; k <= FRETS; k++) {
    ctx.lineWidth = k === 0 ? 5 : 2; // the nut is thicker
    ctx.beginPath();
    ctx.moveTo(px(L.wires[k]), -half);
    ctx.lineTo(px(L.wires[k]), half);
    ctx.stroke();
    if (k > 0) ctx.fillText(String(k), px((L.wires[k - 1] + L.wires[k]) / 2), -half - 8);
  }

  // Bridge and the two strings (the top one is the thicker bass string).
  ctx.fillStyle = WOOD.head;
  ctx.fillRect(len - 4, -cfg.stringGapBridge * h, 8, cfg.stringGapBridge * h * 2);
  ctx.strokeStyle = WOOD.string;
  for (const i of [0, 1] as const) {
    const off = only !== undefined && i !== only;
    ctx.globalAlpha = off ? 0.25 : 1;
    ctx.setLineDash(off ? [8, 8] : []);
    ctx.lineWidth = i === 0 ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(0, stringOffset(i, 0, cfg) * h);
    ctx.lineTo(len, stringOffset(i, 1, cfg) * h);
    ctx.stroke();
  }
  ctx.restore();
}

// Placing mode: grab ring on the tail (dashed when idle, white when the right pinch is over it, solid
// orange while dragging) and a turn mark at the head for the left-hand twist.
function drawHandle(ctx: CanvasRenderingContext2D, cfg: InstrumentConfig, frame: HandFrame, w: number, h: number): void {
  const L = layout(cfg, w / h, frame.pose);
  const head = fromNeck(-0.05, -cfg.neckWidth * 1.5, L);
  ctx.fillStyle = COLORS.neck;
  ctx.font = `bold ${Math.round(h * 0.06)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("⟲", head.x * w, head.y * h);

  const c = handlePoint(L);
  const dragging = !!frame.dragging;
  const hover = !!frame.strum && dist(pinchPoint(frame.strum.points), c, w / h) <= cfg.grabRadius;
  ctx.save();
  ctx.setLineDash(dragging ? [] : [6, 6]);
  ctx.strokeStyle = dragging ? COLORS.strum : hover ? "#fff" : "rgba(255,255,255,0.6)";
  ctx.lineWidth = dragging ? 5 : hover ? 3 : 2;
  ctx.beginPath();
  ctx.arc(c.x * w, c.y * h, cfg.grabRadius * h, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// The point fret detection uses, so the player sees where the system thinks they hold the neck.
function drawGrip(ctx: CanvasRenderingContext2D, frame: HandFrame, cfg: InstrumentConfig, w: number, h: number): void {
  const g = gripPoint(frame.neck!.points, cfg.gripLift, layout(cfg, w / h, frame.pose));
  ctx.strokeStyle = frame.fret > 0 ? COLORS.neck : "#fff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(g.x * w, g.y * h, 14, 0, Math.PI * 2);
  ctx.stroke();
}

function drawHand(ctx: CanvasRenderingContext2D, hand: HandData, color: string, w: number, h: number, label: string): void {
  const p = hand.points;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(p[a].x * w, p[a].y * h);
    ctx.lineTo(p[b].x * w, p[b].y * h);
  }
  ctx.stroke();
  ctx.fillStyle = "#fff";
  for (const q of p) {
    ctx.beginPath();
    ctx.arc(q.x * w, q.y * h, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(hand.palm.x * w, hand.palm.y * h, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `bold ${Math.round(h * 0.035)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(label, hand.palm.x * w, hand.palm.y * h - hand.size * h * 1.4);
}
