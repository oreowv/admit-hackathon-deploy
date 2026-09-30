import type { InstrumentConfig, Vec } from "../config";

// Tilts the neck so it points at the neck hand, turning around the strum point on the body.
// Like holding a real dombyra: the neck follows the left hand, the fret is still how far the hand
// is from the body, and the strings under the strum hand barely move.
// The deadband is a distance from the neck line, not an angle: an angle would turn the neck more and
// more for the same wobble as the hand slides towards the body (up the frets). This way sliding along
// the neck never turns it; only moving the hand off the neck does, and then just enough to follow it.
const RAD = Math.PI / 180;

export class NeckAim {
  private angle?: number;
  private target?: number;
  private lastT?: number;

  constructor(private cfg: InstrumentConfig) {}

  get value(): number {
    return this.angle ?? this.cfg.angle;
  }

  update(grip: Vec | undefined, t: number, aspect: number): number {
    const dt = this.lastT === undefined ? 0 : t - this.lastT;
    this.lastT = t;
    if (!this.cfg.followHand) return (this.angle = this.cfg.angle);
    if (!grip) return this.value; // hand lost: hold the last tilt
    const dx = (this.cfg.pivot.x - grip.x) * aspect;
    if (dx <= 0) return this.value; // hand past the body

    const dy = this.cfg.pivot.y - grip.y;
    const r = Math.hypot(dx, dy); // grip → pivot, frame heights
    const toHand = Math.atan2(dy, dx) / RAD; // the tilt that points the neck straight at the grip
    const db = this.cfg.aimDeadband;
    if (this.target === undefined) {
      this.target = toHand;
    } else if (r > db) {
      const off = r * Math.sin((toHand - this.target) * RAD); // grip's distance from the neck line
      if (Math.abs(off) > db) this.target = toHand - Math.asin((Math.sign(off) * db) / r) / RAD;
    }
    this.target = Math.min(this.cfg.maxAngle, Math.max(this.cfg.minAngle, this.target));

    if (this.angle === undefined) return (this.angle = this.target);
    return (this.angle += (this.target - this.angle) * (1 - Math.exp(-dt / this.cfg.aimSmoothing)));
  }

  reset(): void {
    this.angle = this.target = this.lastT = undefined;
  }
}
