import { FRET_SEMITONES, type InstrumentConfig, type InstrumentPose, type Vec } from "./config";

export const FRETS = FRET_SEMITONES.length - 1;
export const TAIL_U = 1.08; // far end of the body, where the grab handle is

// The instrument placed on screen. Neck coords: u runs from 0 at the nut to 1 at the bridge,
// v is the signed distance from the centre line in frame heights (> 0 is below it).
export type Layout = {
  cfg: InstrumentConfig;
  aspect: number; // frame width / height
  nut: Vec; // 0..1 screen coords
  dir: Vec; // unit vector nut → bridge, aspect-corrected
  normal: Vec; // unit vector across the strings, pointing down
  length: number; // nut → bridge, frame heights
  wires: number[]; // u of the nut and each fret wire: wires[0] = 0, wires[FRETS] = cfg.fretsEnd
};

// `pose` is the live one from HandFrame.pose; it defaults to the fixed tilt and position in the config.
export function layout(cfg: InstrumentConfig, aspect: number, pose: InstrumentPose = cfg): Layout {
  const { angle, pivot } = pose;
  const a = (angle * Math.PI) / 180;
  const dir = { x: Math.cos(a), y: Math.sin(a) };
  const length = cfg.length * aspect;
  const back = cfg.pivotU * length; // pivot → nut
  const nut = { x: pivot.x - (dir.x * back) / aspect, y: pivot.y - dir.y * back };
  return { cfg, aspect, nut, dir, normal: { x: -dir.y, y: dir.x }, length, wires: fretWires(cfg) };
}

export function toNeck(p: Vec, L: Layout): { u: number; v: number } {
  const dx = (p.x - L.nut.x) * L.aspect;
  const dy = p.y - L.nut.y;
  return { u: (dx * L.dir.x + dy * L.dir.y) / L.length, v: dx * L.normal.x + dy * L.normal.y };
}

export function fromNeck(u: number, v: number, L: Layout): Vec {
  return {
    x: L.nut.x + (L.dir.x * u * L.length + L.normal.x * v) / L.aspect,
    y: L.nut.y + L.dir.y * u * L.length + L.normal.y * v,
  };
}

// Offset of string i (0 = top, 1 = bottom) from the centre line at u, frame heights.
export function stringOffset(i: 0 | 1, u: number, cfg: InstrumentConfig): number {
  const gap = cfg.stringGapNut + (cfg.stringGapBridge - cfg.stringGapNut) * u;
  return (i === 0 ? -gap : gap) / 2;
}

// String i as a nut → bridge segment in screen coords; the strum detector tests crossings against it.
export function stringLine(i: 0 | 1, L: Layout): [Vec, Vec] {
  return [fromNeck(0, stringOffset(i, 0, L.cfg), L), fromNeck(1, stringOffset(i, 1, L.cfg), L)];
}

// u of each fret wire. On a real instrument the wire for s semitones sits at 1 - 2^(-s/12) of the
// scale; that is rescaled to end at fretsEnd and blended with equal widths by fretTaper.
export function fretWires(cfg: InstrumentConfig): number[] {
  const real = (s: number) => 1 - 2 ** (-s / 12);
  const last = real(FRET_SEMITONES[FRETS]);
  return FRET_SEMITONES.map((s, k) => (cfg.fretTaper * (real(s) / last) + (1 - cfg.fretTaper) * (k / FRETS)) * cfg.fretsEnd);
}

// Fret k covers wires[k-1]..wires[k] (the finger sits just behind wire k); 0 off the fretted part.
export function fretAt(u: number, wires: number[]): number {
  if (u < 0 || u >= wires[FRETS]) return 0;
  let k = 1;
  while (u >= wires[k]) k++;
  return k;
}

const PALM = [0, 5, 9, 13, 17]; // wrist + knuckles

// Where the neck hand holds the neck: the palm center, the big dot drawn on the hand. Built only from
// wrist and knuckles, which barely move when the wrist turns or the fingers curl, so the fret is steady.
export function gripPoint(points: Vec[]): Vec {
  let x = 0;
  let y = 0;
  for (const i of PALM) {
    x += points[i].x;
    y += points[i].y;
  }
  return { x: x / PALM.length, y: y / PALM.length };
}

// Where the strum hand pinches: between the thumb and index fingertips.
export function pinchPoint(points: Vec[]): Vec {
  return { x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2 };
}

// Grab handle for placing mode: the tail of the body.
export function handlePoint(L: Layout): Vec {
  return fromNeck(TAIL_U, 0, L);
}
