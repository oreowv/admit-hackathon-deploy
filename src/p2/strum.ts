import type { HandFrame } from "../p1/types";
import { DEFAULT_STRUM, DEFAULT_TUNING, type InstrumentConfig, type StrumConfig, type TuningName, type Vec } from "../config";
import { layout, stringOffset, toNeck } from "../instrument";
import { midiFor } from "./notes";
import type { Dir, GestureEvent, StringId } from "./types";

// The pick: the end of the index finger (between its last joint and the tip). On a dombyra the strike is
// the index fingernail, and in a wrist flick the fingertip travels much further than the knuckle, so it
// reliably crosses both strings. Averaging with the last joint takes the edge off fingertip jitter.
export function pickPoint(points: Vec[]): Vec {
  return { x: (points[7].x + points[8].x) / 2, y: (points[7].y + points[8].y) / 2 };
}

type Sample = { t: number; u: number; v: number };
type Crossing = { string: StringId; t: number; u: number; speed: number; dir: Dir };
type Reject = { string: StringId; t: number; reason: "slow" | "short" | "zone" | "repeat" };

// Per string: which side the pick is on and where it last crossed the string line.
type StringState = {
  side: -1 | 0 | 1; // -1 above, 1 below, 0 not known yet. Flips only once the pick is `margin` past the line
  zero?: Omit<Crossing, "string">; // last sign change of the pick's distance to the line, interpolated
  lastPluck: number;
};

type Group = { dir: Dir; strings: StringId[]; t: number; vel: number; speed: number; fret: number };

// HandFrames → pluck / strum / mute events.
// Works in neck coords (see instrument.ts), so it follows wherever the dombyra is placed and tilted.
// Each string has its own crossing detector with hysteresis (jitter around a string never sounds) and
// sub-frame timing (the exact moment between two frames the line was crossed). A string sounds as soon as
// it's crossed; crossings of one sweep are grouped into a single strum event with the strings it hit.
export class StrumDetector {
  only?: StringId; // play just this string; the other is ignored entirely. undefined = both
  tuning: TuningName = DEFAULT_TUNING;
  private prev?: Sample;
  private history: Sample[] = []; // pick samples of the last travelMs
  private strings: StringState[] = [newString(), newString()];
  private group?: Group;
  private wasMuted = false;

  constructor(
    private cfg: InstrumentConfig,
    private opts: StrumConfig = DEFAULT_STRUM,
  ) {}

  push(frame: HandFrame, aspect: number): GestureEvent[] {
    const out: GestureEvent[] = [];
    if (frame.muted && !this.wasMuted) out.push({ type: "mute", t: frame.t });
    this.wasMuted = frame.muted;

    // Positioning the dombyra: never strum.
    if (frame.placing) {
      this.lose(out);
      return out;
    }
    // Hand gone. Fast strums blur the hand and the tracker drops it for a frame or two: keep the stroke,
    // it's matched up when the hand is back. A longer loss starts over.
    if (!frame.strum) {
      if (this.prev && frame.t - this.prev.t > this.opts.maxGapMs) this.lose(out);
      else if (this.group && frame.t - this.group.t > this.opts.groupMs) this.flush(out);
      return out;
    }

    const { u, v } = toNeck(pickPoint(frame.strum.points), layout(this.cfg, aspect, frame.pose));
    const cur = { t: frame.t, u, v };
    if (this.prev && cur.t - this.prev.t > this.opts.maxGapMs) this.lose(out); // too long: never strum across it
    this.history = this.history.filter((s) => s.t >= cur.t - this.opts.travelMs);
    this.history.push(cur);
    const results = ([0, 1] as const)
      .filter((i) => this.only === undefined || i === this.only)
      .flatMap((i) => this.track(i, cur) ?? []);
    this.prev = cur;
    for (const r of results.sort((a, b) => a.t - b.t)) {
      if ("reason" in r) out.push({ type: "reject", ...r });
      else this.pluck(r, frame, out);
    }
    if (this.group && frame.t - this.group.t > this.opts.groupMs) this.flush(out);
    return out;
  }

  reset(): void {
    this.prev = this.group = undefined;
    this.history = [];
    this.strings = [newString(), newString()];
    this.wasMuted = false;
  }

  // Hand lost for good: close the strum, forget where the pick was.
  private lose(out: GestureEvent[]): void {
    this.flush(out);
    this.prev = undefined;
    this.history = [];
    for (const s of this.strings) {
      s.side = 0;
      s.zero = undefined;
    }
  }

  // Signed distance of the pick from string i (> 0 below it), frame heights.
  private dist(i: StringId, s: Sample): number {
    return s.v - stringOffset(i, s.u, this.cfg);
  }

  private track(i: StringId, cur: Sample): Crossing | Reject | undefined {
    const st = this.strings[i];
    const d = this.dist(i, cur);
    if (this.prev) {
      const dp = this.dist(i, this.prev);
      if (Math.sign(dp) !== Math.sign(d) && dp !== d) {
        const k = dp / (dp - d); // where between the two frames the line was crossed
        const dt = Math.max(cur.t - this.prev.t, 1);
        st.zero = {
          t: this.prev.t + k * dt,
          u: this.prev.u + k * (cur.u - this.prev.u),
          speed: Math.abs(d - dp) / (dt / 1000),
          dir: d > dp ? "down" : "up",
        };
      }
    }

    const m = this.opts.margin;
    const side = d > m ? 1 : d < -m ? -1 : 0;
    if (side === 0) return undefined; // inside the jitter band: undecided
    const was = st.side;
    st.side = side;
    if (was === 0 || was === side) return undefined;

    // Clearly moved to the other side: a crossing, if it was a real, fast enough one past the frets.
    // Rejections say why, so misses can be seen on screen and tuned.
    const z = st.zero;
    st.zero = undefined;
    if (!z || z.dir !== (side === 1 ? "down" : "up")) return undefined;
    if (z.speed < this.opts.minSpeed) return { string: i, t: z.t, reason: "slow" };
    if (this.travel(z.dir, cur) < this.opts.minTravel) return { string: i, t: z.t, reason: "short" };
    if (z.u < this.opts.zone[0] || z.u > this.opts.zone[1]) return { string: i, t: z.t, reason: "zone" };
    if (z.t - st.lastPluck < this.opts.refractoryMs) return { string: i, t: z.t, reason: "repeat" };
    st.lastPluck = z.t;
    return { string: i, ...z };
  }

  // How far the pick has moved in `dir` within the last travelMs: a real stroke covers ground,
  // a hand resting on a string only trembles back and forth.
  private travel(dir: Dir, cur: Sample): number {
    let best = 0;
    for (const s of this.history) best = Math.max(best, dir === "down" ? cur.v - s.v : s.v - cur.v);
    return best;
  }

  private pluck(h: Crossing, frame: HandFrame, out: GestureEvent[]): void {
    const vel = this.velocity(h.speed);
    const g = this.group;
    if (g && (g.dir !== h.dir || g.strings.includes(h.string) || h.t - g.t > this.opts.groupMs)) this.flush(out);
    if (this.group) {
      this.group.strings.push(h.string);
      this.group.vel = Math.max(this.group.vel, vel);
      this.group.speed = Math.max(this.group.speed, h.speed);
    } else {
      this.group = { dir: h.dir, strings: [h.string], t: h.t, vel, speed: h.speed, fret: frame.fret };
    }
    const first = this.group.strings.length === 1;
    const midi = midiFor(h.string, frame.fret, this.tuning);
    out.push({ type: "pluck", string: h.string, fret: frame.fret, midi, vel, muted: frame.muted, first, t: h.t });
    // Every playable string hit: nothing left to wait for.
    if (this.group.strings.length === (this.only === undefined ? 2 : 1)) this.flush(out);
  }

  private flush(out: GestureEvent[]): void {
    const g = this.group;
    if (!g) return;
    this.group = undefined;
    out.push({ type: "strum", dir: g.dir, strings: g.strings, vel: g.vel, speed: g.speed, fret: g.fret, t: g.t });
    if (g.speed < this.opts.weakSpeed) out.push({ type: "technique", issue: "weak", t: g.t });
  }

  // Speed → 0.2..1: even a gentle strum is audible, a fast one is full volume.
  private velocity(speed: number): number {
    const { minSpeed, fullSpeed } = this.opts;
    return 0.2 + 0.8 * Math.min(1, Math.max(0, (speed - minSpeed) / (fullSpeed - minSpeed)));
  }
}

function newString(): StringState {
  return { side: 0, lastPluck: -Infinity };
}
