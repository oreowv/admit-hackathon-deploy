import type { HandData } from "./types";
import type { InstrumentConfig, Vec } from "../config";
import { dist } from "./geometry";
import { handlePoint, layout, pinchPoint } from "../instrument";

const DEG = 180 / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Placing mode (toggled by a button on the page):
//  - the right hand pinches the tail of the body and drags the dombyra;
//  - the left hand pinches anywhere and turns the neck around the body, like a dial.
// Releasing leaves it where it is; the button then locks it. Outside placing mode pinches do nothing,
// so pinches while playing never move it.
export class Placement {
  enabled = false;
  private right: Pinch;
  private left: Pinch;
  private offset?: Vec; // pivot − right palm, while moving
  private twist?: { from: number; angle: number }; // left palm bearing and neck tilt when the twist began

  constructor(private cfg: InstrumentConfig) {
    this.right = new Pinch(cfg);
    this.left = new Pinch(cfg);
  }

  // Moving or turning right now.
  get dragging(): boolean {
    return this.offset !== undefined || this.twist !== undefined;
  }

  // Moves cfg.pivot and turns cfg.angle. `angle` is the current tilt, to find the tail.
  update(neck: HandData | undefined, strum: HandData | undefined, angle: number, aspect: number): boolean {
    if (!this.enabled) {
      this.reset();
      return false;
    }
    this.move(strum, angle, aspect);
    this.turn(neck, aspect);
    return this.dragging;
  }

  reset(): void {
    this.right.reset();
    this.left.reset();
    this.offset = this.twist = undefined;
  }

  // Follows the palm, not the fingertips: opening the fingers to let go doesn't shift anything,
  // so the dombyra stays exactly where it was released.
  private move(hand: HandData | undefined, angle: number, aspect: number): void {
    const started = hand ? this.right.update(hand, aspect) : this.right.reset();
    if (!hand || !this.right.pinched) {
      this.offset = undefined;
      return;
    }
    const pivot = this.cfg.pivot;
    if (started) {
      const tail = handlePoint(layout(this.cfg, aspect, { angle, pivot }));
      if (dist(pinchPoint(hand.points), tail, aspect) <= this.cfg.grabRadius) {
        this.offset = { x: pivot.x - hand.palm.x, y: pivot.y - hand.palm.y };
      }
    }
    if (this.offset) {
      pivot.x = clamp(hand.palm.x + this.offset.x, 0.05, 0.95);
      pivot.y = clamp(hand.palm.y + this.offset.y, 0.05, 0.95);
    }
  }

  // The neck turns by as much as the left palm swings around the body: relative, so it never jumps.
  private turn(hand: HandData | undefined, aspect: number): void {
    const started = hand ? this.left.update(hand, aspect) : this.left.reset();
    if (!hand || !this.left.pinched) {
      this.twist = undefined;
      return;
    }
    const bearing = this.bearing(hand.palm, aspect);
    if (started) this.twist = { from: bearing, angle: this.cfg.angle };
    if (this.twist) {
      this.cfg.angle = clamp(this.twist.angle + bearing - this.twist.from, this.cfg.minAngle, this.cfg.maxAngle);
    }
  }

  // Direction from a point to the pivot, in the same degrees as the neck tilt.
  private bearing(p: Vec, aspect: number): number {
    return Math.atan2(this.cfg.pivot.y - p.y, (this.cfg.pivot.x - p.x) * aspect) * DEG;
  }
}

// One hand's thumb–index pinch: closes below pinchOn, opens above pinchOff, each after pinchFrames frames.
class Pinch {
  pinched = false;
  private streak = 0;

  constructor(private cfg: InstrumentConfig) {}

  // True on the frame the pinch closes.
  update(hand: HandData, aspect: number): boolean {
    const raw = isPinch(hand, aspect, this.pinched ? this.cfg.pinchOff : this.cfg.pinchOn);
    if (raw === this.pinched) {
      this.streak = 0;
      return false;
    }
    if (++this.streak < this.cfg.pinchFrames) return false;
    this.pinched = raw;
    this.streak = 0;
    return raw;
  }

  reset(): false {
    this.pinched = false;
    this.streak = 0;
    return false;
  }
}

// Thumb and index tips touching. Uses depth too (MediaPipe z has roughly the scale of x), so tips that
// only overlap on screen don't count, and measures in palm sizes so it works near and far from the camera.
export function isPinch(hand: HandData, aspect: number, threshold: number): boolean {
  const a = hand.points[4];
  const b = hand.points[8];
  const gap = Math.hypot((a.x - b.x) * aspect, a.y - b.y, (a.z - b.z) * aspect);
  return gap < threshold * hand.size;
}
