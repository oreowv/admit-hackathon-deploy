import { describe, expect, it } from "vitest";
import { OneEuroFilter } from "../src/p1/oneEuro";
import { RoleAssigner } from "../src/p1/roles";
import { FretTracker, DEFAULT_FRET_ZONE, fretPosition } from "../src/p1/fret";
import { MuteDetector, curledFingers } from "../src/p1/mute";
import { P1Engine } from "../src/p1/engine";
import { makeHand, raw } from "./helpers";

describe("OneEuroFilter", () => {
  it("damps jitter around a still point", () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 2 });
    let maxDev = 0;
    for (let i = 0; i < 120; i++) {
      const y = f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i * 33);
      if (i > 10) maxDev = Math.max(maxDev, Math.abs(y - 0.5));
    }
    expect(maxDev).toBeLessThan(0.004);
  });

  it("follows a fast move with little lag", () => {
    const f = new OneEuroFilter({ minCutoff: 2, beta: 8 });
    for (let i = 0; i < 10; i++) f.filter(0.2, i * 33);
    let y = 0;
    for (let i = 10; i < 16; i++) y = f.filter(0.2 + (i - 9) * 0.1, i * 33); // 3 units/s
    expect(0.8 - y).toBeLessThan(0.06);
  });
});

describe("RoleAssigner", () => {
  it("left-of-screen hand is neck", () => {
    const r = new RoleAssigner();
    const a = makeHand(0.7, 0.5);
    const b = makeHand(0.2, 0.5);
    const out = r.assign([a, b], 0);
    expect(out.neck).toBe(b);
    expect(out.strum).toBe(a);
  });

  it("keeps identity when MediaPipe swaps hand order", () => {
    const r = new RoleAssigner();
    const n = makeHand(0.2, 0.5);
    const s = makeHand(0.7, 0.5);
    r.assign([n, s], 0);
    const out = r.assign([s, n], 33);
    expect(out.neck).toBe(n);
  });

  it("a single returning hand keeps its role even across the midline", () => {
    const r = new RoleAssigner();
    r.assign([makeHand(0.2, 0.5), makeHand(0.55, 0.5)], 0);
    const strumOnly = makeHand(0.45, 0.5); // left of midline, but near last strum spot
    const out = r.assign([strumOnly], 33);
    expect(out.strum).toBe(strumOnly);
    expect(out.neck).toBeUndefined();
  });

  it("with no memory a single hand is decided by side", () => {
    const r = new RoleAssigner();
    expect(r.assign([makeHand(0.8, 0.5)], 0).strum).toBeDefined();
    const r2 = new RoleAssigner();
    expect(r2.assign([makeHand(0.2, 0.5)], 0).neck).toBeDefined();
  });
});

describe("FretTracker", () => {
  const zone = { ...DEFAULT_FRET_ZONE, x0: 0, x1: 0.6, frets: 6, hysteresis: 0.3 }; // 0.1 per fret
  it("maps x to 1..6 and 0 outside", () => {
    const f = new FretTracker(zone);
    expect(f.update({ x: 0.05, y: 0.5 })).toBe(1);
    expect(f.update({ x: 0.55, y: 0.5 })).toBe(6);
    expect(f.update({ x: 0.9, y: 0.5 })).toBe(0);
    expect(f.update(undefined)).toBe(0);
  });

  it("does not flicker on a border", () => {
    const f = new FretTracker(zone);
    f.update({ x: 0.25, y: 0.5 }); // fret 3
    const seen = new Set<number>();
    for (const x of [0.3, 0.301, 0.299, 0.305, 0.295, 0.32]) seen.add(f.update({ x, y: 0.5 }));
    expect([...seen]).toEqual([3]);
    expect(f.update({ x: 0.34, y: 0.5 })).toBe(4); // clearly past the band
  });

  it("reversed direction", () => {
    expect(fretPosition(0.05, { ...zone, reversed: true })).toBeCloseTo(5.5);
  });
});

describe("Mute", () => {
  it("counts curled fingers", () => {
    expect(curledFingers(makeHand(0.3, 0.5, false))).toBe(0);
    expect(curledFingers(makeHand(0.3, 0.5, true))).toBe(4);
  });

  it("is debounced", () => {
    const m = new MuteDetector(4);
    const fist = makeHand(0.3, 0.5, true);
    expect([1, 2, 3].map(() => m.update(fist))).toEqual([false, false, false]);
    expect(m.update(fist)).toBe(true);
    expect(m.update(makeHand(0.3, 0.5, false))).toBe(true); // one open frame is not enough
    expect(m.update(undefined)).toBe(false); // hand gone → not muted
  });
});

describe("P1Engine", () => {
  it("mirrors, assigns roles and fills the contract", () => {
    const e = new P1Engine({ aspect: 1 });
    let f = e.process([], 0);
    for (let i = 0; i < 6; i++) {
      // neck at screen x≈0.15 (fret 2: zone 0.04..0.46, 0.07 per fret), fist; strum at 0.75
      f = e.process([raw(makeHand(0.75, 0.5)), raw(makeHand(0.15, 0.5, true))], i * 33);
    }
    expect(f.neck?.palm.x).toBeCloseTo(0.15, 2);
    expect(f.strum?.palm.x).toBeCloseTo(0.75, 2);
    expect(f.neck?.points).toHaveLength(21);
    expect(f.strum?.size).toBeCloseTo(0.1, 2);
    expect(f.fret).toBe(2);
    expect(f.muted).toBe(true);
  });

  it("drops the strum hand to undefined when it leaves", () => {
    const e = new P1Engine();
    e.process([raw(makeHand(0.2, 0.5)), raw(makeHand(0.7, 0.5))], 0);
    const f = e.process([raw(makeHand(0.2, 0.5))], 33);
    expect(f.strum).toBeUndefined();
    expect(f.neck).toBeDefined();
  });

  it("keeps t strictly increasing", () => {
    const e = new P1Engine();
    const a = e.process([], 100);
    const b = e.process([], 100);
    expect(b.t).toBeGreaterThan(a.t);
  });
});
