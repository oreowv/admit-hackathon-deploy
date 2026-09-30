import type { Point } from "./types";
import { dist, palmCenter, palmSize } from "./geometry";

export type Role = "neck" | "strum";
export type Assigned = { neck?: Point[]; strum?: Point[] };
// Where a palm is along the dombyra (nut 0 → bridge 1) and the point that splits neck from body there.
export type Place = { along: (p: { x: number; y: number }) => number; split: number };

type Track = { x: number; y: number; t: number };

export type RoleOptions = {
  lostMs: number; // a hand unseen this long has left the camera: its role is free again
  maxJump: number; // farther than this from where a role's hand was last seen = a different hand
  dupe: number; // two detections whose palms are closer than this many palm sizes are one hand seen twice
};

export const DEFAULT_ROLE_OPTIONS: RoleOptions = { lostMs: 400, maxJump: 0.35, dupe: 0.6 };

// Which detected hand is the neck (left) hand and which the strum (right) hand.
// Roles are sticky: a hand keeps its role while it stays tracked, wherever it moves on screen; nothing
// re-sorts by position. A hand that appears takes the role that's free. Only when no hand is tracked is
// a new hand classified, by where it is on the dombyra: along the neck = neck hand, over the body = strum
// hand (screen side if no instrument is given). MediaPipe's left/right label isn't used: it's trained on
// palms and flips for the back of a hand, which is how a strumming hand is usually seen.
export class RoleAssigner {
  private last: Partial<Record<Role, Track>> = {};

  constructor(private opts: RoleOptions = DEFAULT_ROLE_OPTIONS) {}

  assign(hands: Point[][], t: number, place?: Place): Assigned {
    const cands = this.dedupe(
      hands.map((points) => ({ points, palm: palmCenter(points) })),
    ).slice(0, 2);
    const tracked = (r: Role) => {
      const l = this.last[r];
      return l && t - l.t <= this.opts.lostMs ? l : undefined;
    };

    // 1. Hands still being tracked keep their role: nearest match first, within maxJump.
    const role = new Map<number, Role>();
    const pairs: { c: number; r: Role; d: number }[] = [];
    cands.forEach((c, i) => {
      for (const r of ["neck", "strum"] as Role[]) {
        const l = tracked(r);
        if (l) pairs.push({ c: i, r, d: dist(c.palm, l) });
      }
    });
    for (const p of pairs.sort((a, b) => a.d - b.d)) {
      if (p.d > this.opts.maxJump || role.has(p.c) || [...role.values()].includes(p.r)) continue;
      role.set(p.c, p.r);
    }

    // 2. New hands take the free role(s).
    const fresh = cands.map((_, i) => i).filter((i) => !role.has(i));
    const free = (["neck", "strum"] as Role[]).filter((r) => ![...role.values()].includes(r));
    if (fresh.length === 1 && free.length === 1) {
      role.set(fresh[0], free[0]);
    } else if (fresh.length === 1) {
      role.set(fresh[0], this.classify(cands[fresh[0]].palm, place));
    } else if (fresh.length === 2) {
      // Two new hands at once: the one nearer the head of the dombyra is the neck hand.
      const [a, b] = fresh;
      const at = (i: number) => (place ? place.along(cands[i].palm) : cands[i].palm.x);
      const aIsNeck = at(a) <= at(b);
      role.set(a, aIsNeck ? "neck" : "strum");
      role.set(b, aIsNeck ? "strum" : "neck");
    }

    const out: Assigned = {};
    for (const [i, r] of role) {
      out[r] = cands[i].points;
      this.last[r] = { x: cands[i].palm.x, y: cands[i].palm.y, t };
    }
    return out;
  }

  reset(): void {
    this.last = {};
  }

  private classify(palm: { x: number; y: number }, place?: Place): Role {
    if (place) return place.along(palm) < place.split ? "neck" : "strum";
    return palm.x < 0.5 ? "neck" : "strum";
  }

  // MediaPipe sometimes reports one hand twice, almost on top of itself: keep the first.
  private dedupe<T extends { points: Point[]; palm: { x: number; y: number } }>(cands: T[]): T[] {
    const kept: T[] = [];
    for (const c of cands) {
      const size = palmSize(c.points);
      if (!kept.some((k) => dist(k.palm, c.palm) < this.opts.dupe * Math.max(size, palmSize(k.points)))) kept.push(c);
    }
    return kept;
  }
}
