import type { Point } from "./types";
import { cloneInstrument, type InstrumentConfig, type InstrumentPose, type Vec } from "../config";
import { FRETS, fretAt, gripPoint, layout, toNeck, type Layout } from "../instrument";

// Which fret the neck hand holds: its grip point projected onto the drawn neck. Sticky around the
// current fret (hysteresis) and debounced (switchFrames) so it doesn't flicker on a fret wire.
export class FretTracker {
  private current = 0;
  private pending = 0;
  private streak = 0;

  constructor(public cfg: InstrumentConfig = cloneInstrument()) {}

  get value(): number {
    return this.current;
  }

  update(points: Point[] | undefined, aspect: number, pose: InstrumentPose = this.cfg): number {
    if (!points) {
      this.streak = 0;
      return (this.current = 0);
    }
    const raw = this.rawFret(layout(this.cfg, aspect, pose), gripPoint(points, this.cfg.gripLift));
    if (raw === this.current) {
      this.streak = 0;
    } else {
      if (raw !== this.pending) {
        this.pending = raw;
        this.streak = 0;
      }
      if (++this.streak >= this.cfg.switchFrames) {
        this.current = raw;
        this.streak = 0;
      }
    }
    return this.current;
  }

  reset(): void {
    this.current = this.pending = this.streak = 0;
  }

  private rawFret(L: Layout, grip: Vec): number {
    const { u, v } = toNeck(grip, L);
    const band = this.cfg.neckWidth / 2 + this.cfg.grip;
    const c = this.current;
    if (c > 0) {
      // Sticky margin on each side, sized by the narrower of the two frets it borders, so a wide fret
      // doesn't swallow half of a narrow neighbour (e.g. fret 2 next to the half-step fret 3).
      const width = (k: number) => (k >= 1 && k <= FRETS ? L.wires[k] - L.wires[k - 1] : Infinity);
      const lo = this.cfg.hysteresis * Math.min(width(c), width(c - 1));
      const hi = this.cfg.hysteresis * Math.min(width(c), width(c + 1));
      if (Math.abs(v) <= band * 1.25 && u >= L.wires[c - 1] - lo && u < L.wires[c] + hi) return c;
    }
    return Math.abs(v) <= band ? fretAt(u, L.wires) : 0;
  }
}
