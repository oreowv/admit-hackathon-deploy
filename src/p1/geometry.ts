import type { Point } from "./types";

export const WRIST = 0;
export const PALM_POINTS = [0, 5, 9, 13, 17];

export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

// Distance in units of frame height; `aspect` = width / height corrects x.
export function dist(a: { x: number; y: number }, b: { x: number; y: number }, aspect = 1): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

export function palmCenter(points: Point[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const i of PALM_POINTS) {
    x += points[i].x;
    y += points[i].y;
  }
  return { x: x / PALM_POINTS.length, y: y / PALM_POINTS.length };
}

export function palmSize(points: Point[], aspect = 1): number {
  return dist(points[WRIST], points[9], aspect);
}
