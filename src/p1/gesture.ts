import type { HandData, Point } from "./types";
import { dist, WRIST } from "./geometry";

const TIPS = [8, 12, 16, 20];
const PIPS = [6, 10, 14, 18];

// All four fingers straight: every tip clearly farther from the wrist than its middle joint.
export function isOpen(points: Point[], aspect = 1): boolean {
  const w = points[WRIST];
  return TIPS.every((tip, i) => dist(points[tip], w, aspect) > dist(points[PIPS[i]], w, aspect) * 1.15);
}

// Both open palms held still in front of the camera for holdMs → one toggle (move mode on/off).
// Holding still keeps it from firing while strumming; after it fires, the pose must be dropped
// before it can fire again.
export class PalmsToggle {
  private since?: number;
  private anchor?: { n: { x: number; y: number }; s: { x: number; y: number } };
  private fired = false;

  constructor(
    private holdMs = 1000,
    private maxDrift = 0.05, // how far (frame heights) either palm may move during the hold
  ) {}

  // progress 0..1 while holding; toggle is true on the one frame the hold completes.
  update(neck: HandData | undefined, strum: HandData | undefined, t: number, aspect: number): { progress: number; toggle: boolean } {
    if (!neck || !strum || !isOpen(neck.points, aspect) || !isOpen(strum.points, aspect)) {
      this.since = this.anchor = undefined;
      this.fired = false;
      return { progress: 0, toggle: false };
    }
    if (this.fired) return { progress: 0, toggle: false };
    const drift = this.anchor
      ? Math.max(dist(neck.palm, this.anchor.n, aspect), dist(strum.palm, this.anchor.s, aspect))
      : Infinity;
    if (this.since === undefined || drift > this.maxDrift) {
      this.since = t;
      this.anchor = { n: { ...neck.palm }, s: { ...strum.palm } };
    }
    const progress = Math.min(1, (t - this.since) / this.holdMs);
    if (progress < 1) return { progress, toggle: false };
    this.fired = true;
    return { progress: 1, toggle: true };
  }

  reset(): void {
    this.since = this.anchor = undefined;
    this.fired = false;
  }
}
