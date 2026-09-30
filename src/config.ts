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
};

export const DEFAULT_INSTRUMENT: InstrumentConfig = {
  pivot: { x: 0.7, y: 0.62 },
  pivotU: 0.8,
  angle: 15,
  followHand: false,
  minAngle: -15,
  maxAngle: 50,
  aimDeadband: 0.04,
  aimSmoothing: 150,
  length: 0.82,
  fretsEnd: 0.56, // 12 frets from the nut to here: long neck, small body, like a real dombyra
  neckEnd: 0.63,
  neckWidth: 0.08,
  bodyWidth: 0.22,
  grip: 0.05,
  stringGapNut: 0.025,
  stringGapBridge: 0.04,
  fretTaper: 0, // equal widths: easiest to hit in the air
  hysteresis: 0.15, // just past the line switches; enough to stop flicker when resting on a fret line
  switchFrames: 1,
  pinchOn: 0.4,
  pinchOff: 0.6,
  pinchFrames: 2,
  grabRadius: 0.12,
};

export function cloneInstrument(cfg: InstrumentConfig = DEFAULT_INSTRUMENT): InstrumentConfig {
  return { ...cfg, pivot: { ...cfg.pivot } };
}

// Semitones above the open string for frets 0..12: chromatic like a guitar, one octave per string.
export const FRET_SEMITONES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Open strings, top line first, as MIDI numbers (D3 = 50). The two traditional dombyra tunings.
export const TUNINGS = {
  "D-A": [50, 57], // a fifth: brighter bottom string
  "D-G": [50, 55], // a fourth
} as const;
export type TuningName = keyof typeof TUNINGS;
export const DEFAULT_TUNING: TuningName = "D-A";

// Strum detection. Speeds are across the strings, in frame heights per second.
export type StrumConfig = {
  zone: [number, number]; // part of nut → bridge where a crossing counts: anywhere past the frets
  margin: number; // frame heights the pick must be past a string before the crossing counts (anti-jitter)
  minSpeed: number; // slower crossings are a drifting hand, not a strum: silent
  bridgeMs: number; // tracking dropouts up to this long (motion blur on fast strums) are bridged, not reset
  weakSpeed: number; // below this a strum is flagged weak
  fullSpeed: number; // this speed and above plays at full velocity
  groupMs: number; // crossings in one direction within this window are one strum
  refractoryMs: number; // the same string can't sound twice within this
};

export const DEFAULT_STRUM: StrumConfig = {
  zone: [0.56, 1.2], // from the last fret (fretsEnd) to past the tail
  margin: 0.005,
  minSpeed: 0.15,
  bridgeMs: 150,
  weakSpeed: 0.8,
  fullSpeed: 3,
  groupMs: 120,
  refractoryMs: 70,
};
