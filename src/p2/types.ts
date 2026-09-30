// What P2 derives from HandFrames. Audio, effects, the lesson judge and the coach all consume these.

export type StringId = 0 | 1; // 0 = top (bass, D), 1 = bottom (G)
export type Dir = "down" | "up"; // down = towards the bottom string on screen

export type GestureEvent =
  // One string sounded: fired the moment the pick crosses it, so audio has no extra latency.
  // `first`: the first string of a sweep, i.e. the start of a strum (audio adds the finger's hit there).
  // `midi`: the note it plays, from string, fret and the current tuning.
  | { type: "pluck"; string: StringId; fret: number; midi: number; vel: number; muted: boolean; first: boolean; t: number }
  // One sweep of the strum hand: the strings it hit, in order. [0] or [1] = single string, [0, 1] / [1, 0] = both.
  | { type: "strum"; dir: Dir; strings: StringId[]; vel: number; speed: number; fret: number; muted: boolean; t: number }
  | { type: "mute"; t: number }
  // A string line was crossed but it didn't count, and why: too slow, outside the strum zone, or a repeat.
  | { type: "reject"; string: StringId; reason: "slow" | "zone" | "repeat"; t: number }
  | { type: "technique"; issue: "weak" | "partial" | "handLost" | "tooFar" | "offNeck"; t: number };
