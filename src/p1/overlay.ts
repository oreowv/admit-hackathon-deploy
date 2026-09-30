import type { HandData, HandFrame } from "./types";
import type { FretZone } from "./fret";
import { HAND_CONNECTIONS } from "./geometry";

const COLORS = { neck: "#22d3ee", strum: "#fb923c", zone: "rgba(255,255,255,0.25)", active: "rgba(34,211,238,0.28)" };

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: HandFrame | undefined,
  video: HTMLVideoElement | null,
  zone: FretZone,
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

  drawZone(ctx, zone, frame?.fret ?? 0, w, h);
  if (!frame) return;
  if (frame.neck) drawHand(ctx, frame.neck, COLORS.neck, w, h, frame.muted ? "MUTE" : `лад ${frame.fret}`);
  if (frame.strum) drawHand(ctx, frame.strum, COLORS.strum, w, h, `size ${frame.strum.size.toFixed(2)}`);
}

function drawZone(ctx: CanvasRenderingContext2D, z: FretZone, fret: number, w: number, h: number): void {
  const x0 = z.x0 * w;
  const x1 = z.x1 * w;
  const y0 = z.y0 * h;
  const y1 = z.y1 * h;
  const fw = (x1 - x0) / z.frets;
  ctx.lineWidth = 1;
  ctx.font = `${Math.round(h * 0.03)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  for (let i = 0; i < z.frets; i++) {
    const n = z.reversed ? z.frets - i : i + 1;
    const x = x0 + i * fw;
    if (n === fret) {
      ctx.fillStyle = COLORS.active;
      ctx.fillRect(x, y0, fw, y1 - y0);
    }
    ctx.strokeStyle = COLORS.zone;
    ctx.strokeRect(x, y0, fw, y1 - y0);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(String(n), x + fw / 2, y0 - 6);
  }
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
