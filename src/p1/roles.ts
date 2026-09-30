import type { Point } from "./types";
import { dist, palmCenter } from "./geometry";

export type Role = "neck" | "strum";
export type Assigned = { neck?: Point[]; strum?: Point[] };

type Last = { x: number; y: number; t: number };

export type RoleOptions = {
  memoryMs: number; // how long a lost hand's last position is still trusted
  maxJump: number; // single hand farther than this from the remembered one → decide by side
  crossMargin: number; // neck may sit this far right of strum before we re-sort by x
};

export const DEFAULT_ROLE_OPTIONS: RoleOptions = { memoryMs: 400, maxJump: 0.35, crossMargin: 0.15 };

// Left of screen = neck, right = strum. MediaPipe's handedness label is ignored on purpose:
// with a mirrored selfie view it flips unpredictably. Identity is kept by nearest-previous-position.
export class RoleAssigner {
  private last: Partial<Record<Role, Last>> = {};

  constructor(private opts: RoleOptions = DEFAULT_ROLE_OPTIONS) {}

  assign(hands: Point[][], t: number): Assigned {
    const palms = hands.slice(0, 2).map(palmCenter);
    const recent = (r: Role) => {
      const l = this.last[r];
      return l && t - l.t <= this.opts.memoryMs ? l : undefined;
    };
    const out: Assigned = {};

    if (palms.length >= 2) {
      const n = recent("neck");
      const s = recent("strum");
      let neckIdx: number;
      if (n || s) {
        const cost = (ni: number) =>
          (n ? dist(palms[ni], n) : 0) + (s ? dist(palms[1 - ni], s) : 0);
        neckIdx = cost(0) <= cost(1) ? 0 : 1;
        if (palms[neckIdx].x > palms[1 - neckIdx].x + this.opts.crossMargin) {
          neckIdx = palms[0].x <= palms[1].x ? 0 : 1;
        }
      } else {
        neckIdx = palms[0].x <= palms[1].x ? 0 : 1;
      }
      out.neck = hands[neckIdx];
      out.strum = hands[1 - neckIdx];
      this.remember("neck", palms[neckIdx], t);
      this.remember("strum", palms[1 - neckIdx], t);
    } else if (palms.length === 1) {
      const p = palms[0];
      let role: Role | undefined;
      let best = this.opts.maxJump;
      for (const r of ["neck", "strum"] as Role[]) {
        const l = recent(r);
        if (l && dist(p, l) < best) {
          best = dist(p, l);
          role = r;
        }
      }
      role ??= p.x < 0.5 ? "neck" : "strum";
      out[role] = hands[0];
      this.remember(role, p, t);
    }
    return out;
  }

  reset(): void {
    this.last = {};
  }

  private remember(role: Role, p: { x: number; y: number }, t: number): void {
    this.last[role] = { x: p.x, y: p.y, t };
  }
}
