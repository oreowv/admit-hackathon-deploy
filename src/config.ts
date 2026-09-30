// Shared instrument geometry and tuning. Drawing, fret detection and strum detection all read
// from here, so what the player sees is exactly what gets detected.

export type Vec = { x: number; y: number };

// Where the instrument is this frame: its live tilt and position (both change while playing).
export type InstrumentPose = { angle: number; pivot: Vec };

export type InstrumentConfig = {
  pivot: Vec; // strum point on the body, 0..1 mirrored screen coords; the neck turns around it
  pivotU: number; // where the pivot sits along nut → bridge (0..1)
  angle: number; // degrees; > 0 tilts the head up-left and the body down-right. Set by the left-hand twist
  followHand: boolean; // instead, keep tilting the neck so it points at the neck hand
  minAngle: number; // tilt limits, degrees
  maxAngle: number;
  aimDeadband: number; // how far (frame heights) the hand may drift off the neck line before the neck turns
  aimSmoothing: number; // ms time constant of the tilt following the hand
  length: number; // nut → bridge, in frame widths
  fretsEnd: number; // last fret wire as a fraction of nut → bridge; plain neck (open strings) after it
  neckEnd: number; // the body starts here, fraction of nut → bridge
  neckWidth: number; // frame heights
  bodyWidth: number; // widest part of the body, frame heights
  grip: number; // how far (frame heights) past each edge of the neck the grip point still counts as on it
  stringGapNut: number; // distance between the 2 strings at the nut, frame heights
  stringGapBridge: number; // …and at the bridge: strings spread towards the body like on a real dombyra
  fretTaper: number; // 0 = equal fret widths, 1 = real spacing (frets narrow towards the body)
  hysteresis: number; // fraction of the current fret's width the grip point may drift past before it leaves
  switchFrames: number; // a new fret must hold this many frames before it is reported
  pinchOn: number; // thumb–index tip distance, in palm sizes, below which the strum hand pinches
  pinchOff: number; // …and above which the pinch opens again
  pinchFrames: number; // pinch / release must hold this many frames
  grabRadius: number; // in placing mode, a right-hand pinch starting this close (frame heights) to the tail grabs it
  gripLift: number; // how far above the knuckles the neck lies in the hand, in palm lengths
};

export const DEFAULT_INSTRUMENT: InstrumentConfig = {
  pivot: { x: 0.65, y: 0.62 },
  pivotU: 0.8,
  angle: 15,
  followHand: false,
  minAngle: -15,
  maxAngle: 50,
  aimDeadband: 0.04,
  aimSmoothing: 150,
  length: 0.75,
  fretsEnd: 0.48, // frets sit up towards the head, clear of the strumming hand
  neckEnd: 0.58,
  neckWidth: 0.08,
  bodyWidth: 0.22,
  grip: 0.05,
  stringGapNut: 0.025,
  stringGapBridge: 0.04,
  fretTaper: 0, // equal widths: easiest to hit in the air
  hysteresis: 0.35,
  switchFrames: 2,
  pinchOn: 0.4,
  pinchOff: 0.6,
  pinchFrames: 2,
  grabRadius: 0.12,
  gripLift: 0.5,
};

export function cloneInstrument(cfg: InstrumentConfig = DEFAULT_INSTRUMENT): InstrumentConfig {
  return { ...cfg, pivot: { ...cfg.pivot } };
}

// Semitones above the open string for frets 0..6. The first dombyra frets are diatonic, so the steps
// are uneven (whole, whole, half, whole, whole, half) and so are the fret widths.
export const FRET_SEMITONES = [0, 2, 4, 5, 7, 9, 10];

// Open strings, top line first: tuned a fourth apart. MIDI numbers (D3 = 50, G3 = 55).
export const OPEN_STRINGS = [50, 55] as const;

// Strum detection. Speeds are across the strings, in frame heights per second.
export type StrumConfig = {
  zone: [number, number]; // part of nut → bridge where a crossing counts: over the body, not the frets
  margin: number; // frame heights the pick must be past a string before the crossing counts (anti-jitter)
  minSpeed: number; // slower crossings are a drifting hand, not a strum: silent
  weakSpeed: number; // below this a strum is flagged weak
  fullSpeed: number; // this speed and above plays at full velocity
  groupMs: number; // crossings in one direction within this window are one strum
  refractoryMs: number; // the same string can't sound twice within this
};

export const DEFAULT_STRUM: StrumConfig = {
  zone: [0.55, 1.05],
  margin: 0.006,
  minSpeed: 0.25,
  weakSpeed: 0.8,
  fullSpeed: 3,
  groupMs: 120,
  refractoryMs: 70,
};
