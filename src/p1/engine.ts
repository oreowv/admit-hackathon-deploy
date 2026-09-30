import type { HandData, HandFrame, Point } from "./types";
import { LandmarkSmoother, type FilterParams } from "./oneEuro";
import { palmCenter, palmSize } from "./geometry";
import { RoleAssigner, DEFAULT_ROLE_OPTIONS, type RoleOptions } from "./roles";
import { FretTracker, DEFAULT_FRET_ZONE, type FretZone } from "./fret";
import { MuteDetector } from "./mute";

export type EngineOptions = {
  aspect: number; // video width / height
  mirror: boolean;
  neckFilter: FilterParams;
  strumFilter: FilterParams; // lighter smoothing so P2 still sees fast strums
  fretZone: FretZone;
  roles: RoleOptions;
  muteFrames: number;
};

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  aspect: 16 / 9,
  mirror: true,
  neckFilter: { minCutoff: 1.0, beta: 2.0 },
  strumFilter: { minCutoff: 2.0, beta: 8.0 },
  fretZone: DEFAULT_FRET_ZONE,
  roles: DEFAULT_ROLE_OPTIONS,
  muteFrames: 4,
};

// Pure per-frame pipeline: raw MediaPipe landmarks → HandFrame. No DOM, no camera.
export class P1Engine {
  readonly opts: EngineOptions;
  readonly fret: FretTracker;
  private roles: RoleAssigner;
  private mute: MuteDetector;
  private neckSmoother: LandmarkSmoother;
  private strumSmoother: LandmarkSmoother;
  private lastT = -Infinity;

  constructor(opts: Partial<EngineOptions> = {}) {
    this.opts = { ...DEFAULT_ENGINE_OPTIONS, ...opts };
    this.roles = new RoleAssigner(this.opts.roles);
    this.fret = new FretTracker({ ...this.opts.fretZone });
    this.mute = new MuteDetector(this.opts.muteFrames);
    this.neckSmoother = new LandmarkSmoother(this.opts.neckFilter);
    this.strumSmoother = new LandmarkSmoother(this.opts.strumFilter);
  }

  process(rawHands: Point[][], t: number): HandFrame {
    // Keep t strictly increasing: P2 divides by dt.
    if (t <= this.lastT) t = this.lastT + 0.001;
    this.lastT = t;

    const hands = rawHands
      .filter((h) => h.length === 21)
      .map((h) => (this.opts.mirror ? h.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })) : h));
    const { neck, strum } = this.roles.assign(hands, t);

    const neckData = this.toHandData(neck, this.neckSmoother, t);
    const strumData = this.toHandData(strum, this.strumSmoother, t);

    return {
      t,
      neck: neckData,
      strum: strumData,
      fret: this.fret.update(neckData?.palm),
      muted: this.mute.update(neckData?.points, this.opts.aspect),
    };
  }

  setAspect(aspect: number): void {
    this.opts.aspect = aspect;
  }

  reset(): void {
    this.roles.reset();
    this.fret.reset();
    this.mute.reset();
    this.neckSmoother.reset();
    this.strumSmoother.reset();
    this.lastT = -Infinity;
  }

  private toHandData(raw: Point[] | undefined, smoother: LandmarkSmoother, t: number): HandData | undefined {
    if (!raw) {
      smoother.reset(); // so a returning hand doesn't glide in from its old spot
      return undefined;
    }
    const points = smoother.smooth(raw, t);
    return { points, palm: palmCenter(points), size: palmSize(points, this.opts.aspect) };
  }
}
