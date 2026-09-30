import type { Point } from "../src/p1/types";

// Synthetic 21-point hand around (cx, cy). `fist` pulls fingertips back towards the wrist.
export function makeHand(cx: number, cy: number, fist = false, s = 0.1): Point[] {
  const pts: Point[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  pts[0] = { x: cx, y: cy + s, z: 0 }; // wrist below
  const cols = [-0.3, -0.1, 0.1, 0.3];
  [5, 9, 13, 17].forEach((mcp, i) => {
    const x = cx + cols[i] * s;
    pts[mcp] = { x, y: cy, z: 0 };
    pts[mcp + 1] = { x, y: cy - 0.4 * s, z: 0 }; // pip
    pts[mcp + 2] = { x, y: fist ? cy + 0.1 * s : cy - 0.7 * s, z: 0 };
    pts[mcp + 3] = { x, y: fist ? cy + 0.3 * s : cy - 0.9 * s, z: 0 }; // tip
  });
  for (let i = 1; i <= 4; i++) pts[i] = { x: cx - 0.5 * s, y: cy + 0.5 * s - i * 0.1 * s, z: 0 };
  return pts;
}

// MediaPipe returns unmirrored coords; engine mirrors x → 1 - x.
export const raw = (h: Point[]) => h.map((p) => ({ ...p, x: 1 - p.x }));
