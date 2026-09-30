import { describe, expect, it } from "vitest";
import { OneEuroFilter } from "../src/p1/oneEuro";
import { RoleAssigner } from "../src/p1/roles";
import { FretTracker } from "../src/p1/fret";
import { MuteDetector, curledFingers, isFist } from "../src/p1/mute";
import { P1Engine } from "../src/p1/engine";
import { cloneInstrument, DEFAULT_INSTRUMENT } from "../src/config";
import {
  FRETS,
  fretWires,
  fromNeck,
  gripPoint,
  handlePoint,
  layout,
  stringLine,
  toNeck,
  type Layout,
} from "../src/instrument";
import { isPinch } from "../src/p1/grab";
import { palmCenter, palmSize } from "../src/p1/geometry";
import { makeHand, raw } from "./helpers";

const ASPECT = 16 / 9;
const fretMid = (L: Layout, k: number) => (L.wires[k - 1] + L.wires[k]) / 2;
const followEngine = () => new P1Engine({ aspect: ASPECT, instrument: { ...DEFAULT_INSTRUMENT, followHand: true } });

// A hand whose grip point (where the neck lies in it) sits at neck coords (u, v).
function handAt(L: Layout, u: number, v = 0, fist = false) {
  const p = fromNeck(u, v, L);
  const off = gripPoint(makeHand(0, 0, fist));
  return makeHand(p.x - off.x, p.y - off.y, fist);
}

// Strum hand with its index tip at `at`; with `pinch` the thumb tip touches it there.
function strumHandAt(at: { x: number; y: number }, pinch: boolean) {
  const h = makeHand(0, 0);
  const tip = h[8];
  if (pinch) h[4] = { ...tip };
  return h.map((p) => ({ x: p.x + at.x - tip.x, y: p.y + at.y - tip.y, z: 0 }));
}
const pinchHandAt = (at: { x: number; y: number }) => strumHandAt(at, true);
const openHandAt = (at: { x: number; y: number }) => strumHandAt(at, false);

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

describe("Instrument geometry", () => {
  const L = layout(DEFAULT_INSTRUMENT, ASPECT);

  it("round-trips neck coords", () => {
    const q = toNeck(fromNeck(0.3, 0.02, L), L);
    expect(q.u).toBeCloseTo(0.3, 5);
    expect(q.v).toBeCloseTo(0.02, 5);
  });

  it("real spacing: frets narrow towards the body, last wire at fretsEnd", () => {
    const w = fretWires({ ...DEFAULT_INSTRUMENT, fretTaper: 1 });
    const width = (k: number) => w[k] - w[k - 1];
    for (let k = 2; k <= FRETS; k++) expect(width(k)).toBeLessThan(width(k - 1)); // chromatic: steadily narrower
    expect(FRETS).toBe(12);
    expect(w[FRETS]).toBeCloseTo(DEFAULT_INSTRUMENT.fretsEnd);
  });

  it("by default all frets are the same width", () => {
    const w = fretWires(DEFAULT_INSTRUMENT);
    for (let k = 1; k <= FRETS; k++) expect(w[k] - w[k - 1]).toBeCloseTo(DEFAULT_INSTRUMENT.fretsEnd / FRETS, 10);
  });

  it("strings spread towards the bridge", () => {
    const [a0, a1] = stringLine(0, L);
    const [b0, b1] = stringLine(1, L);
    expect(toNeck(b1, L).v - toNeck(a1, L).v).toBeGreaterThan(toNeck(b0, L).v - toNeck(a0, L).v);
  });
});

describe("FretTracker", () => {
  const cfg = cloneInstrument();
  const L = layout(cfg, ASPECT);
  const hold = (f: FretTracker, hand: ReturnType<typeof makeHand>, n = 3) => {
    let r = 0;
    for (let i = 0; i < n; i++) r = f.update(hand, ASPECT);
    return r;
  };

  it("maps the fingertip on the neck to frets 1..6", () => {
    for (let k = 1; k <= FRETS; k++) expect(hold(new FretTracker(cfg), handAt(L, fretMid(L, k)))).toBe(k);
  });

  it("is 0 off the neck, on the head, over the body, or with no hand", () => {
    const f = new FretTracker(cfg);
    expect(hold(f, handAt(L, fretMid(L, 3), 0.2))).toBe(0);
    expect(hold(f, handAt(L, -0.03))).toBe(0);
    expect(hold(f, handAt(L, 0.7))).toBe(0);
    expect(hold(f, handAt(L, (cfg.fretsEnd + cfg.neckEnd) / 2))).toBe(0); // plain neck past fret 6
    hold(f, handAt(L, fretMid(L, 3)));
    expect(f.update(undefined, ASPECT)).toBe(0);
  });

  it("does not flicker on a fret wire", () => {
    const f = new FretTracker(cfg);
    hold(f, handAt(L, fretMid(L, 3)));
    const wire = L.wires[3];
    const seen = new Set<number>();
    for (const d of [0, 0.002, -0.002, 0.004, -0.001, 0.003]) seen.add(f.update(handAt(L, wire + d), ASPECT));
    expect([...seen]).toEqual([3]);
    expect(hold(f, handAt(L, fretMid(L, 4)))).toBe(4);
  });

  it("switches on the first frame past the line by default", () => {
    const f = new FretTracker(cfg);
    hold(f, handAt(L, fretMid(L, 4)));
    const w = L.wires[4] - L.wires[3];
    expect(f.update(handAt(L, L.wires[4] + w * (cfg.hysteresis + 0.05)), ASPECT)).toBe(5); // just past the margin
  });

  it("with switchFrames > 1 a new fret must hold that long", () => {
    const f = new FretTracker({ ...cloneInstrument(), switchFrames: 2 });
    hold(f, handAt(L, fretMid(L, 2)));
    expect(f.update(handAt(L, fretMid(L, 5)), ASPECT)).toBe(2);
    expect(f.update(handAt(L, fretMid(L, 5)), ASPECT)).toBe(5);
  });
});

describe("Mute", () => {
  it("counts curled fingers", () => {
    expect(curledFingers(makeHand(0.3, 0.5, false))).toBe(0);
    expect(curledFingers(makeHand(0.3, 0.5, true))).toBe(4);
  });

  it("a hand holding the neck (fingers curled, tips out past the knuckles) is not a fist", () => {
    const s = 0.1;
    const grip = makeHand(0.3, 0.5);
    // Tips curled back below their middle joints (cy - 0.4s), but still above the knuckles (cy).
    for (const tip of [8, 12, 16, 20]) grip[tip] = { ...grip[tip], y: 0.5 - 0.2 * s };
    expect(curledFingers(grip)).toBe(0);
    expect(isFist(grip)).toBe(false);
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
    const e = new P1Engine({ aspect: ASPECT });
    const L = layout(e.fret.cfg, ASPECT);
    const neck = handAt(L, fretMid(L, 2), 0, true); // palm on fret 2, fingers folded
    let f = e.process([], 0);
    for (let i = 0; i < 6; i++) {
      f = e.process([raw(makeHand(0.75, 0.5)), raw(neck)], i * 33);
    }
    expect(f.neck?.palm.x).toBeCloseTo(neck[9].x, 1);
    expect(f.strum?.palm.x).toBeCloseTo(0.75, 2);
    expect(f.neck?.points).toHaveLength(21);
    expect(f.strum?.size).toBeCloseTo(0.1, 2);
    expect(f.fret).toBe(2);
    expect(f.muted).toBe(false); // folded fingers on a fret = pressing it, not muting
  });

  it("mutes only on a fist away from the frets", () => {
    const e = new P1Engine({ aspect: ASPECT });
    const L = layout(e.fret.cfg, ASPECT);
    const strum = raw(makeHand(0.85, 0.7));
    let t = 0;
    const hold = (hand: ReturnType<typeof makeHand>) => {
      let f = e.process([raw(hand), strum], (t += 33));
      for (let i = 0; i < 6; i++) f = e.process([raw(hand), strum], (t += 33));
      return f;
    };
    expect(hold(handAt(L, fretMid(L, 5), 0, true))).toMatchObject({ fret: 5, muted: false });
    expect(hold(handAt(L, fretMid(L, 5), 0.25, true))).toMatchObject({ fret: 0, muted: true }); // fist off the neck
    expect(hold(handAt(L, fretMid(L, 5), 0.25, false))).toMatchObject({ fret: 0, muted: false }); // open hand off the neck
  });

  it("tilts the neck towards the neck hand; fret is still the distance along it", () => {
    const e = followEngine();
    const L30 = layout(e.fret.cfg, ASPECT, { angle: 30, pivot: e.fret.cfg.pivot });
    const neck = handAt(L30, fretMid(L30, 3));
    let f = e.process([], 0);
    for (let i = 1; i < 10; i++) f = e.process([raw(neck), raw(makeHand(0.75, 0.6))], i * 33);
    expect(f.pose?.angle).toBeCloseTo(30, 1);
    expect(f.fret).toBe(3);
  });

  it("clamps the tilt and holds it while the neck hand is lost", () => {
    const e = followEngine();
    const cfg = e.fret.cfg;
    const steep = handAt(layout(cfg, ASPECT, { angle: 80, pivot: cfg.pivot }), 0.3);
    const strum = makeHand(0.9, 0.7);
    let f = e.process([raw(steep), raw(strum)], 0);
    expect(f.pose?.angle).toBeCloseTo(cfg.maxAngle, 5);
    f = e.process([raw(strum)], 33);
    expect(f.neck).toBeUndefined();
    expect(f.pose?.angle).toBeCloseTo(cfg.maxAngle, 5);
  });

  it("ignores small wobbles of the neck hand, follows bigger moves", () => {
    const e = followEngine();
    const cfg = e.fret.cfg;
    const L = layout(cfg, ASPECT);
    const u = fretMid(L, 3);
    const at = (v: number) => raw(handAt(L, u, v)); // v: distance off the starting neck line
    const strum = raw(makeHand(0.85, 0.7));
    let t = 0;
    let f = e.process([at(0), strum], t);
    for (let i = 0; i < 20; i++) f = e.process([at(-0.03), strum], (t += 33));
    expect(f.pose?.angle).toBeCloseTo(cfg.angle, 5); // within the deadband
    for (let i = 0; i < 40; i++) f = e.process([at(-0.15), strum], (t += 33));
    expect(f.pose!.angle).toBeGreaterThan(cfg.angle); // hand moved up: head turns up after it…
    const grip = gripPoint(handAt(L, u, -0.15));
    expect(toNeck(grip, layout(cfg, ASPECT, f.pose)).v).toBeCloseTo(-cfg.aimDeadband, 2); // …just enough
  });

  it("sliding from fret 1 to 6 with a slightly off hand does not turn the neck", () => {
    const e = followEngine();
    const L = layout(e.fret.cfg, ASPECT);
    const strum = raw(makeHand(0.85, 0.7));
    let t = 0;
    let f = e.process([raw(handAt(L, fretMid(L, 1))), strum], t);
    const seen: number[] = [];
    for (let k = 1; k <= FRETS; k++) {
      const off = k % 2 ? 0.03 : -0.03; // hand wobbles up and down while sliding
      for (let i = 0; i < 10; i++) f = e.process([raw(handAt(L, fretMid(L, k), off)), strum], (t += 33));
      expect(f.pose?.angle).toBeCloseTo(e.fret.cfg.angle, 5);
      seen.push(f.fret);
    }
    expect(seen).toEqual(Array.from({ length: FRETS }, (_, k) => k + 1));
  });

  describe("placing mode", () => {
    const move = { x: -0.1, y: -0.05 };

    function setup() {
      const e = new P1Engine({ aspect: ASPECT });
      const L = layout(e.fret.cfg, ASPECT);
      const neck = raw(handAt(L, fretMid(L, 3)));
      const tail = handlePoint(L);
      let t = 0;
      const step = (strum: ReturnType<typeof makeHand>, n = 8) => {
        let f = e.process([neck, raw(strum)], (t += 33));
        for (let i = 1; i < n; i++) f = e.process([neck, raw(strum)], (t += 33));
        return f;
      };
      return { e, L, step, tail, to: { x: tail.x + move.x, y: tail.y + move.y }, start: { ...e.fret.cfg.pivot } };
    }

    it("a pinch on the tail drags the dombyra; it stays where released and after locking", () => {
      const { e, step, tail, to, start } = setup();
      e.grab.enabled = true;
      let f = step(pinchHandAt(tail));
      expect(f.placing).toBe(true);
      expect(f.dragging).toBe(true);

      f = step(pinchHandAt(to), 20); // let the strum smoothing settle
      expect(f.pose?.pivot.x).toBeCloseTo(start.x + move.x, 2);
      expect(f.pose?.pivot.y).toBeCloseTo(start.y + move.y, 2);

      f = step(openHandAt(to)); // release
      expect(f.dragging).toBe(false);
      expect(f.pose?.pivot.x).toBeCloseTo(start.x + move.x, 2);

      e.grab.enabled = false; // lock
      f = step(pinchHandAt(tail));
      expect(f.placing).toBe(false);
      expect(f.dragging).toBe(false);
      expect(f.pose?.pivot.x).toBeCloseTo(start.x + move.x, 2);
    });

    it("a pinch away from the tail does not grab", () => {
      const { e, L, step, start } = setup();
      e.grab.enabled = true;
      const f = step(pinchHandAt(fromNeck(0.8, 0.1, L))); // over the strings
      expect(f.dragging).toBe(false);
      expect(f.pose?.pivot).toEqual(start);
    });

    it("outside placing mode a pinch on the tail does nothing", () => {
      const { step, tail, to, start } = setup();
      step(pinchHandAt(tail));
      const f = step(pinchHandAt(to));
      expect(f.dragging).toBe(false);
      expect(f.pose?.pivot).toEqual(start);
    });
  });

  it("by default the neck stays at its set tilt wherever the left hand goes", () => {
    const e = new P1Engine({ aspect: ASPECT });
    const cfg = e.fret.cfg;
    const L = layout(cfg, ASPECT);
    let f = e.process([], 0);
    for (let i = 1; i < 10; i++) f = e.process([raw(handAt(L, fretMid(L, 2), -0.2)), raw(makeHand(0.85, 0.7))], i * 33);
    expect(f.pose?.angle).toBe(cfg.angle);
  });

  it("placing mode: a left-hand pinch turns the neck like a dial; it stays after release", () => {
    const e = new P1Engine({ aspect: ASPECT });
    const cfg = e.fret.cfg;
    e.grab.enabled = true;
    const strum = raw(openHandAt({ x: 0.85, y: 0.8 }));
    // Left palm at a given bearing around the pivot, 0.5 frame heights away.
    const leftAt = (deg: number, pinch: boolean) => {
      const a = (deg * Math.PI) / 180;
      const palm = { x: cfg.pivot.x - (0.5 * Math.cos(a)) / ASPECT, y: cfg.pivot.y - 0.5 * Math.sin(a) };
      const h = strumHandAt({ x: 0, y: 0 }, pinch);
      const c = palmCenter(h);
      return raw(h.map((p) => ({ ...p, x: p.x + palm.x - c.x, y: p.y + palm.y - c.y })));
    };
    let t = 0;
    const run = (hand: ReturnType<typeof raw>, n = 20) => {
      let f = e.process([hand, strum], (t += 33));
      for (let i = 1; i < n; i++) f = e.process([hand, strum], (t += 33));
      return f;
    };

    run(leftAt(30, true)); // pinch: starts the twist, no jump
    expect(cfg.angle).toBeCloseTo(15, 1);
    let f = run(leftAt(40, true)); // swing the palm 10° up
    expect(f.dragging).toBe(true);
    expect(f.pose?.angle).toBeCloseTo(25, 0);
    f = run(leftAt(40, false)); // release
    expect(f.dragging).toBe(false);
    expect(f.pose?.angle).toBeCloseTo(25, 0);
  });

  it("the fret is read at the palm center (the dot drawn on the hand), steady when the fingers curl", () => {
    const open = makeHand(0.3, 0.5);
    const fist = makeHand(0.3, 0.5, true);
    expect(gripPoint(open)).toEqual(palmCenter(open));
    expect(gripPoint(fist)).toEqual(gripPoint(open));
  });

  it("pinch uses depth: tips that only overlap on screen are not a pinch", () => {
    const pts = openHandAt({ x: 0.75, y: 0.5 });
    pts[4] = { ...pts[8], z: pts[8].z + 0.1 };
    const hand = { points: pts, palm: palmCenter(pts), size: palmSize(pts, ASPECT) };
    expect(isPinch(hand, ASPECT, 0.4)).toBe(false);
    pts[4] = { ...pts[8] };
    expect(isPinch(hand, ASPECT, 0.4)).toBe(true);
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
