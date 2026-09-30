import type { Point } from "./types";

export type FilterParams = { minCutoff: number; beta: number; dCutoff?: number };

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

// One Euro Filter: heavy smoothing when still, little lag when moving fast.
export class OneEuroFilter {
  private xPrev?: number;
  private dxPrev = 0;
  private tPrev?: number;

  constructor(private params: FilterParams) {}

  filter(x: number, tMs: number): number {
    if (this.xPrev === undefined || this.tPrev === undefined) {
      this.xPrev = x;
      this.tPrev = tMs;
      this.dxPrev = 0;
      return x;
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-3);
    const dx = (x - this.xPrev) / dt;
    const edx = this.dxPrev + alpha(this.params.dCutoff ?? 1, dt) * (dx - this.dxPrev);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(edx);
    const ex = this.xPrev + alpha(cutoff, dt) * (x - this.xPrev);
    this.xPrev = ex;
    this.dxPrev = edx;
    this.tPrev = tMs;
    return ex;
  }

  reset(): void {
    this.xPrev = undefined;
    this.tPrev = undefined;
    this.dxPrev = 0;
  }
}

export class LandmarkSmoother {
  private filters: OneEuroFilter[];

  constructor(params: FilterParams, count = 21) {
    this.filters = Array.from({ length: count * 3 }, () => new OneEuroFilter(params));
  }

  smooth(points: Point[], tMs: number): Point[] {
    return points.map((p, i) => ({
      x: this.filters[i * 3].filter(p.x, tMs),
      y: this.filters[i * 3 + 1].filter(p.y, tMs),
      z: this.filters[i * 3 + 2].filter(p.z, tMs),
    }));
  }

  reset(): void {
    for (const f of this.filters) f.reset();
  }
}
