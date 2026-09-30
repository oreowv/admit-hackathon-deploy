export type FretZone = {
  x0: number; // left edge of the neck zone (0..1 of screen width)
  x1: number; // right edge
  y0: number; // top edge
  y1: number; // bottom edge
  frets: number;
  hysteresis: number; // fraction of one fret width needed to leave the current fret
  reversed: boolean; // false: fret 1 at x0 (far left, like the headstock), 6 near x1
};

export const DEFAULT_FRET_ZONE: FretZone = {
  x0: 0.04,
  x1: 0.46,
  y0: 0.15,
  y1: 0.95,
  frets: 6,
  hysteresis: 0.3,
  reversed: false,
};

const Y_MARGIN = 0.03;

// Position along the zone in fret units: 0..frets.
export function fretPosition(x: number, zone: FretZone): number {
  const u = ((x - zone.x0) / (zone.x1 - zone.x0)) * zone.frets;
  return zone.reversed ? zone.frets - u : u;
}

export class FretTracker {
  private current = 0;

  constructor(public zone: FretZone = { ...DEFAULT_FRET_ZONE }) {}

  get value(): number {
    return this.current;
  }

  update(palm?: { x: number; y: number }): number {
    if (!palm) return (this.current = 0);
    const { frets, hysteresis: h } = this.zone;
    const u = fretPosition(palm.x, this.zone);

    if (this.current > 0) {
      const inY = palm.y >= this.zone.y0 - Y_MARGIN && palm.y <= this.zone.y1 + Y_MARGIN;
      if (inY && u >= this.current - 1 - h && u <= this.current + h) return this.current;
    }

    const inY = palm.y >= this.zone.y0 && palm.y <= this.zone.y1;
    if (!inY || u < 0 || u >= frets) {
      // Leaving the zone also needs to clear the hysteresis band (handled above), so we get here
      // only when clearly outside.
      return (this.current = 0);
    }
    return (this.current = Math.min(frets, Math.floor(u) + 1));
  }

  reset(): void {
    this.current = 0;
  }
}
