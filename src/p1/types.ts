// Contract between P1 (perception) and P2 (strum + sound). Do not change without telling P2.

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
};

export type Recording = {
  version: 1;
  createdAt: string;
  label: string;
  width: number;
  height: number;
  frames: HandFrame[];
};
