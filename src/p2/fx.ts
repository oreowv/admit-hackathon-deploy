import type { HandFrame } from "../p1/types";
import type { InstrumentConfig } from "../config";
import { fromNeck, layout, stringOffset } from "../instrument";
import { midiFor, noteName } from "./notes";
import { pickPoint } from "./strum";
import type { GestureEvent, StringId } from "./types";

const RING_MS = 700;
const COLOR = "#fde047";

// Strum feedback on the canvas: plucked strings vibrate and show their note, the pick point is marked,
// and the last strum is labelled (↓/↑ and which strings). Times are performance.now() at receipt.
export class StrumFx {
  private plucks: ({ at: number; vel: number; muted: boolean; note: string } | undefined)[] = [];
  private last?: { text: string; at: number };

  handle(ev: GestureEvent, now: number): void {
    if (ev.type === "pluck") {
      const note = noteName(midiFor(ev.string, ev.fret));
      this.plucks[ev.string] = { at: now, vel: ev.vel, muted: ev.muted, note };
    } else if (ev.type === "strum") {
      const which = ev.strings.length === 2 ? "обе струны" : `струна ${ev.strings[0] + 1}`;
      this.last = { text: `${ev.dir === "down" ? "↓" : "↑"} ${which}`, at: now };
    } else if (ev.type === "mute") {
      this.plucks = [];
    }
  }

  draw(ctx: CanvasRenderingContext2D, frame: HandFrame | undefined, cfg: InstrumentConfig, now: number): void {
    const { width: w, height: h } = ctx.canvas;
    const L = layout(cfg, w / h, frame?.pose);
    ctx.save();
    ctx.textAlign = "center";

    for (const i of [0, 1] as StringId[]) {
      const p = this.plucks[i];
      const age = p ? now - p.at : Infinity;
      if (!p || age > RING_MS) continue;
      const fade = Math.exp(-age / (p.muted ? 60 : 200));
      // Standing wave between nut and bridge, decaying.
      const amp = 0.012 * p.vel * fade * Math.cos(age * 0.12);
      ctx.strokeStyle = COLOR;
      ctx.globalAlpha = 0.4 + 0.6 * fade;
      ctx.lineWidth = i === 0 ? 3 : 2;
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const u = k / 48;
        const q = fromNeck(u, stringOffset(i, u, cfg) + amp * Math.sin(Math.PI * u), L);
        if (k === 0) ctx.moveTo(q.x * w, q.y * h);
        else ctx.lineTo(q.x * w, q.y * h);
      }
      ctx.stroke();
      // Note name just outside the string, over the body.
      const at = fromNeck(0.72, stringOffset(i, 0.72, cfg) + (i === 0 ? -0.045 : 0.06), L);
      ctx.fillStyle = COLOR;
      ctx.font = `bold ${Math.round(h * 0.035)}px system-ui, sans-serif`;
      ctx.fillText(p.muted ? "×" : p.note, at.x * w, at.y * h);
    }

    ctx.globalAlpha = 1;
    if (this.last && now - this.last.at < 900) {
      const at = fromNeck(0.95, -cfg.bodyWidth / 2 - 0.04, L);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.round(h * 0.04)}px system-ui, sans-serif`;
      ctx.fillText(this.last.text, at.x * w, at.y * h);
    }

    // The point the detector tracks, so the player sees what "hits" the strings.
    if (frame?.strum) {
      const pk = pickPoint(frame.strum.points);
      ctx.fillStyle = COLOR;
      ctx.beginPath();
      ctx.arc(pk.x * w, pk.y * h, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
