// Contract between P1 (perception) and P2 (strum + sound). Do not change without telling P2.
import type { InstrumentPose } from "../config";

export type Point = { x: number; y: number; z: number };

export type HandData = {
  points: Point[]; // 21 smoothed landmarks, 0..1 screen coords, already mirrored
  palm: { x: number; y: number }; // avg of wrist + finger bases (0, 5, 9, 13, 17)
  size: number; // wrist → middle-finger base distance, in units of frame height
};

export type HandFrame = {
  t: number; // ms, monotonic
  neck?: HandData; // left-of-screen hand; undefined when not visible
  strum?: HandData; // right-of-screen hand; undefined when not visible
  fret: number; // 0 = open / no neck hand, 1..6
  muted: boolean;
  pose?: InstrumentPose; // where the dombyra is this frame (tilt follows the neck hand); pass to instrument.layout
  placing?: boolean; // player is positioning the dombyra (button on the page): not playing, ignore strums
  dragging?: boolean; // …and is pinching right now, so the dombyra moves with the strum hand
};

export type Recording = {
  version: 1;
  createdAt: string;
  label: string;
  width: number;
  height: number;
  frames: HandFrame[];
};
