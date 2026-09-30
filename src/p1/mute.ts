import type { Point } from "./types";
import { dist, WRIST } from "./geometry";

const TIPS = [8, 12, 16, 20];
const PIPS = [6, 10, 14, 18];

// A finger is curled when its tip is closer to the wrist than its middle joint.
export function curledFingers(points: Point[], aspect = 1): number {
  const w = points[WRIST];
  let n = 0;
  for (let i = 0; i < TIPS.length; i++) {
    if (dist(points[TIPS[i]], w, aspect) < dist(points[PIPS[i]], w, aspect)) n++;
  }
  return n;
}

export function isFist(points: Point[], aspect = 1): boolean {
  return curledFingers(points, aspect) >= 3;
}

// Debounced: the state flips only after the new pose holds for `framesToSwitch` frames.
export class MuteDetector {
  private state = false;
  private streak = 0;

  constructor(private framesToSwitch = 4) {}

  get value(): boolean {
    return this.state;
  }

  update(points: Point[] | undefined, aspect = 1): boolean {
    if (!points) {
      this.streak = 0;
      return (this.state = false);
    }
    const raw = isFist(points, aspect);
    if (raw === this.state) {
      this.streak = 0;
    } else if (++this.streak >= this.framesToSwitch) {
      this.state = raw;
      this.streak = 0;
    }
    return this.state;
  }

  reset(): void {
    this.state = false;
    this.streak = 0;
  }
}
