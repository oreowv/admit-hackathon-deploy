import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cloneInstrument, DEFAULT_STRUM, type InstrumentPose } from "../src/config";
import { fromNeck, layout, stringOffset } from "../src/instrument";
import { palmCenter, palmSize } from "../src/p1/geometry";
import { parseRecording } from "../src/p1/replay";
import type { HandFrame } from "../src/p1/types";
import { StrumDetector, pickPoint } from "../src/p2/strum";
import { midiFor, noteName } from "../src/p2/notes";
import type { GestureEvent } from "../src/p2/types";
import { makeHand } from "./helpers";

const ASPECT = 16 / 9;
const U = 0.8; // over the body, in the strum zone
const cfg = cloneInstrument();
const off = (i: 0 | 1, u = U) => stringOffset(i, u, cfg);

// A frame whose strum-hand pick sits at neck coords (u, v).
function frameAt(t: number, v: number | undefined, u = U, extra: Partial<HandFrame> = {}): HandFrame {
  if (v === undefined) return { t, fret: 0, muted: false, ...extra };
  const L = layout(cfg, ASPECT, extra.pose);
  const p = fromNeck(u, v, L);
  const h0 = makeHand(0, 0);
  const pk = pickPoint(h0);
  const points = h0.map((q) => ({ x: q.x + p.x - pk.x, y: q.y + p.y - pk.y, z: 0 }));
  return { t, strum: { points, palm: palmCenter(points), size: palmSize(points, ASPECT) }, fret: 2, muted: false, ...extra };
}

// Feeds frames at 30 fps moving the pick linearly from v0 to v1, then holds still long enough for the strum to close.
function sweep(d: StrumDetector, t0: number, v0: number, v1: number, ms: number, opts: { u?: number; noise?: number; extra?: Partial<HandFrame> } = {}) {
  const out: GestureEvent[] = [];
  const rnd = lcg(7);
  const n = Math.max(1, Math.round(ms / 33));
  for (let k = 0; k <= n; k++) {
    const v = v0 + ((v1 - v0) * k) / n + (opts.noise ? (rnd() - 0.5) * 2 * opts.noise : 0);
    out.push(...d.push(frameAt(t0 + (k * ms) / n, v, opts.u, opts.extra), ASPECT));
  }
  for (let k = 1; k <= 6; k++) out.push(...d.push(frameAt(t0 + ms + k * 33, v1, opts.u, opts.extra), ASPECT));
  return out;
}

const of = <T extends GestureEvent["type"]>(evs: GestureEvent[], type: T) =>
  evs.filter((e): e is Extract<GestureEvent, { type: T }> => e.type === type);

function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

describe("StrumDetector", () => {
  it("a down sweep plucks top then bottom string and is one strum over both", () => {
    const d = new StrumDetector(cfg);
    const evs = sweep(d, 1000, -0.1, 0.1, 200);
    expect(of(evs, "pluck").map((e) => e.string)).toEqual([0, 1]);
    const strums = of(evs, "strum");
    expect(strums).toHaveLength(1);
    expect(strums[0]).toMatchObject({ dir: "down", strings: [0, 1], fret: 2 });
  });

  it("marks the first string of each sweep (where the strum's finger hit goes)", () => {
    const d = new StrumDetector(cfg);
    const evs = [...sweep(d, 0, -0.1, 0.1, 200), ...sweep(d, 500, 0.1, -0.1, 200)];
    expect(of(evs, "pluck").map((e) => [e.string, e.first])).toEqual([
      [0, true],
      [1, false],
      [1, true],
      [0, false],
    ]);
  });

  it("crossing times are exact to the millisecond, between frames", () => {
    const d = new StrumDetector(cfg);
    const [p0, p1] = of(sweep(d, 1000, -0.1, 0.1, 200), "pluck");
    // Linear motion: v(t) = -0.1 + 0.2 * (t - 1000) / 200
    const at = (v: number) => 1000 + ((v + 0.1) / 0.2) * 200;
    expect(p0.t).toBeCloseTo(at(off(0)), 0);
    expect(p1.t).toBeCloseTo(at(off(1)), 0);
  });

  it("an up sweep plucks bottom then top", () => {
    const d = new StrumDetector(cfg);
    const evs = sweep(d, 0, 0.1, -0.1, 200);
    expect(of(evs, "strum")[0]).toMatchObject({ dir: "up", strings: [1, 0] });
  });

  it("a sweep that stops between the strings is a single-string strum", () => {
    const d = new StrumDetector(cfg);
    const evs = sweep(d, 0, -0.1, (off(0) + off(1)) / 2, 150);
    expect(of(evs, "pluck").map((e) => e.string)).toEqual([0]);
    expect(of(evs, "strum")[0]).toMatchObject({ dir: "down", strings: [0] });
  });

  it("the bottom string alone from below is a single-string up strum", () => {
    const d = new StrumDetector(cfg);
    const evs = sweep(d, 0, 0.1, (off(0) + off(1)) / 2, 150);
    expect(of(evs, "strum")[0]).toMatchObject({ dir: "up", strings: [1] });
  });

  it("a very fast sweep crossing both strings within one frame still gets both, in order, at full velocity", () => {
    const d = new StrumDetector(cfg);
    const evs = sweep(d, 0, -0.1, 0.1, 33);
    const plucks = of(evs, "pluck");
    expect(plucks.map((e) => e.string)).toEqual([0, 1]);
    expect(plucks[0].t).toBeLessThan(plucks[1].t);
    expect(plucks[0].vel).toBe(1);
    expect(of(evs, "strum")).toHaveLength(1);
  });

  it("stays exact with tracking noise: still one pluck per string", () => {
    const d = new StrumDetector(cfg);
    const evs = sweep(d, 0, -0.12, 0.12, 250, { noise: 0.004 });
    expect(of(evs, "pluck").map((e) => e.string)).toEqual([0, 1]);
    expect(of(evs, "strum")).toHaveLength(1);
  });

  it("jitter around a string never sounds", () => {
    const d = new StrumDetector(cfg);
    const evs: GestureEvent[] = [];
    for (let k = 0; k < 60; k++) evs.push(...d.push(frameAt(k * 33, off(0) + (k % 2 ? 0.004 : -0.004)), ASPECT));
    expect(of(evs, "pluck")).toHaveLength(0);
  });

  it("a slow drift across the strings is not a strum", () => {
    const d = new StrumDetector(cfg);
    const evs = sweep(d, 0, -0.1, 0.1, 2000); // 0.1 frame heights / s
    expect(of(evs, "pluck")).toHaveLength(0);
  });

  it("crossings over the frets (outside the strum zone) don't count", () => {
    const d = new StrumDetector(cfg);
    expect(of(sweep(d, 0, -0.1, 0.1, 200, { u: 0.3 }), "pluck")).toHaveLength(0);
  });

  it("a fast strum still counts when the tracker drops the blurred hand for a frame or two", () => {
    const d = new StrumDetector(cfg);
    const evs = [
      ...d.push(frameAt(0, -0.1), ASPECT),
      ...d.push(frameAt(33, undefined), ASPECT),
      ...d.push(frameAt(66, undefined), ASPECT),
      ...d.push(frameAt(99, 0.1), ASPECT),
      ...d.push(frameAt(132, 0.1), ASPECT),
    ];
    expect(of(evs, "pluck").map((e) => e.string)).toEqual([0, 1]);
    expect(of(evs, "strum")).toHaveLength(1);
  });

  it("but never strums across a long loss of the hand", () => {
    const d = new StrumDetector(cfg);
    const evs = [...d.push(frameAt(0, -0.1), ASPECT)];
    for (let t = 33; t <= 400; t += 33) evs.push(...d.push(frameAt(t, undefined), ASPECT));
    evs.push(...d.push(frameAt(433, 0.1), ASPECT), ...d.push(frameAt(466, 0.1), ASPECT));
    expect(of(evs, "pluck")).toHaveLength(0);
  });

  it("a wrist flick counts: only the fingertip crosses the strings, the knuckles stay put", () => {
    const d = new StrumDetector(cfg);
    const L = layout(cfg, ASPECT);
    const evs: GestureEvent[] = [];
    const reach = (Math.abs(off(0)) + DEFAULT_STRUM.margin) * 1.6; // fingertip swing just past both strings
    for (let k = 0; k <= 6; k++) {
      const tip = fromNeck(U, -reach + (2 * reach * k) / 6, L);
      const rest = fromNeck(U + 0.05, 0.12, L); // palm and knuckles, still
      const points = makeHand(0, 0).map((_, j) => (j === 7 || j === 8 ? { ...tip, z: 0 } : { ...rest, z: 0 }));
      evs.push(...d.push({ t: k * 20, strum: { points, palm: rest, size: 0.1 }, fret: 0, muted: false }, ASPECT));
    }
    expect(of(evs, "pluck").map((e) => e.string)).toEqual([0, 1]);
  });

  it("says why a crossing didn't count", () => {
    const slow = sweep(new StrumDetector(cfg), 0, -0.1, 0.1, 3000);
    expect(of(slow, "reject").map((e) => e.reason)).toEqual(["slow", "slow"]);
    const zone = sweep(new StrumDetector(cfg), 0, -0.1, 0.1, 200, { u: 0.3 });
    expect(of(zone, "reject").map((e) => e.reason)).toEqual(["zone", "zone"]);
  });

  it("is silent while the player is placing the dombyra", () => {
    const d = new StrumDetector(cfg);
    expect(of(sweep(d, 0, -0.1, 0.1, 200, { extra: { placing: true } }), "pluck")).toHaveLength(0);
  });

  it("down then up are two strums", () => {
    const d = new StrumDetector(cfg);
    const evs = [...sweep(d, 0, -0.1, 0.1, 200), ...sweep(d, 500, 0.1, -0.1, 200)];
    expect(of(evs, "strum").map((e) => e.dir)).toEqual(["down", "up"]);
    expect(of(evs, "pluck")).toHaveLength(4);
  });

  it("faster strums are louder; slow ones are flagged weak", () => {
    const vel = (ms: number) => {
      const evs = sweep(new StrumDetector(cfg), 0, -0.1, 0.1, ms);
      return { vel: of(evs, "strum")[0].vel, weak: of(evs, "technique").some((e) => e.issue === "weak") };
    };
    const slow = vel(400); // 0.5 frame heights / s
    const fast = vel(80); // 2.5
    expect(fast.vel).toBeGreaterThan(slow.vel);
    expect(slow.weak).toBe(true);
    expect(fast.weak).toBe(false);
  });

  it("follows the dombyra wherever it is placed and tilted", () => {
    const pose: InstrumentPose = { angle: 40, pivot: { x: 0.55, y: 0.5 } };
    const d = new StrumDetector(cfg);
    const evs = sweep(d, 0, -0.1, 0.1, 200, { extra: { pose } });
    expect(of(evs, "strum")[0]).toMatchObject({ dir: "down", strings: [0, 1] });
  });

  it("reports the fret and mute state on each pluck; mute fires once on the fist", () => {
    const d = new StrumDetector(cfg);
    const evs = sweep(d, 0, -0.1, 0.1, 200, { extra: { fret: 4, muted: true } });
    expect(of(evs, "mute")).toHaveLength(1);
    expect(of(evs, "pluck").every((e) => e.fret === 4 && e.muted)).toBe(true);
  });

  it("only the upper string: a sweep over both plays just the top, as an immediate one-string strum", () => {
    const d = new StrumDetector(cfg);
    d.only = 0;
    const evs: GestureEvent[] = [];
    // Collect frame by frame to check the strum closes on the frame of the pluck, without waiting.
    const n = 6;
    let strumFrame = -1;
    let pluckFrame = -1;
    for (let k = 0; k <= n; k++) {
      const got = d.push(frameAt((k * 200) / n, -0.1 + (0.2 * k) / n), ASPECT);
      if (got.some((e) => e.type === "pluck") && pluckFrame < 0) pluckFrame = k;
      if (got.some((e) => e.type === "strum") && strumFrame < 0) strumFrame = k;
      evs.push(...got);
    }
    expect(of(evs, "pluck").map((e) => e.string)).toEqual([0]);
    expect(of(evs, "strum")).toHaveLength(1);
    expect(of(evs, "strum")[0]).toMatchObject({ dir: "down", strings: [0] });
    expect(strumFrame).toBe(pluckFrame);
  });

  it("only the lower string: both directions play just the bottom", () => {
    const d = new StrumDetector(cfg);
    d.only = 1;
    const evs = [...sweep(d, 0, -0.1, 0.1, 200), ...sweep(d, 500, 0.1, -0.1, 200)];
    expect(of(evs, "pluck").map((e) => e.string)).toEqual([1, 1]);
    expect(of(evs, "strum").map((e) => [e.dir, e.strings])).toEqual([
      ["down", [1]],
      ["up", [1]],
    ]);
  });

  it("switching back to both strings plays both again", () => {
    const d = new StrumDetector(cfg);
    d.only = 1;
    sweep(d, 0, -0.1, 0.1, 200);
    d.only = undefined;
    const evs = sweep(d, 500, 0.1, -0.1, 200);
    expect(of(evs, "strum")[0]).toMatchObject({ dir: "up", strings: [1, 0] });
  });

  it("the same string can't double-trigger inside the refractory window", () => {
    const d = new StrumDetector(cfg);
    const evs: GestureEvent[] = [];
    // Big, fast back-and-forth across string 0 only, faster than the refractory time.
    const vs = [-0.05, 0.005, -0.05, 0.005];
    vs.forEach((v, k) => evs.push(...d.push(frameAt(k * 20, v + off(0)), ASPECT)));
    expect(of(evs, "pluck").length).toBeLessThanOrEqual(2);
    expect(DEFAULT_STRUM.refractoryMs).toBeGreaterThan(20);
  });
});

describe("notes", () => {
  it("frets are semitones, one octave per string, in both traditional tunings", () => {
    expect(noteName(midiFor(0, 0, "D-G"))).toBe("D3");
    expect(noteName(midiFor(1, 0, "D-G"))).toBe("G3");
    expect(noteName(midiFor(0, 5, "D-G"))).toBe("G3"); // fret 5 on the D string = open G, like a guitar's 4th
    expect(noteName(midiFor(1, 12, "D-G"))).toBe("G4");
    expect(noteName(midiFor(0, 0, "D-A"))).toBe("D3");
    expect(noteName(midiFor(1, 0, "D-A"))).toBe("A3"); // bottom string a fifth up
    expect(noteName(midiFor(0, 7, "D-A"))).toBe("A3");
    expect(noteName(midiFor(1, 12, "D-A"))).toBe("A4");
  });

  it("plucks carry the note for the current tuning", () => {
    const d = new StrumDetector(cfg);
    d.tuning = "D-A";
    const a = of(sweep(d, 0, -0.1, 0.1, 200, { extra: { fret: 0 } }), "pluck").map((e) => noteName(e.midi));
    d.tuning = "D-G";
    const g = of(sweep(d, 500, 0.1, -0.1, 200, { extra: { fret: 0 } }), "pluck").map((e) => noteName(e.midi));
    expect(a).toEqual(["D3", "A3"]);
    expect(g).toEqual(["G3", "D3"]);
  });
});

describe("synthetic demo recording", () => {
  it("produces strums from the recorded strum hand", () => {
    const rec = parseRecording(readFileSync(new URL("../recordings/synthetic-demo.json", import.meta.url), "utf8"));
    const d = new StrumDetector(cloneInstrument());
    const strums = rec.frames.flatMap((f) => d.push(f, rec.width / rec.height)).filter((e) => e.type === "strum");
    expect(strums.length).toBeGreaterThan(5);
  });
});
