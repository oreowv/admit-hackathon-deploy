import type { HandData, HandFrame, Point } from "./types";
import { LandmarkSmoother, type FilterParams } from "./oneEuro";
import { palmCenter, palmSize } from "./geometry";
import { RoleAssigner, DEFAULT_ROLE_OPTIONS, type RoleOptions } from "./roles";
import { FretTracker } from "./fret";
import { MuteDetector } from "./mute";
import { NeckAim } from "./aim";
import { Placement } from "./grab";
import { cloneInstrument, DEFAULT_INSTRUMENT, type InstrumentConfig } from "../config";
import { gripPoint } from "../instrument";

export type EngineOptions = {
  aspect: number; // video width / height
  mirror: boolean;
  neckFilter: FilterParams;
  strumFilter: FilterParams; // lighter smoothing so P2 still sees fast strums
  instrument: InstrumentConfig;
  roles: RoleOptions;
  muteFrames: number;
};

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  aspect: 16 / 9,
  mirror: true,
  neckFilter: { minCutoff: 0.7, beta: 5.0 }, // steady when still; beta 5 (was 2) cuts slide lag between frets from 35–50 to 20–30 ms, same jitter
  strumFilter: { minCutoff: 2.0, beta: 8.0 },
  instrument: DEFAULT_INSTRUMENT,
  roles: DEFAULT_ROLE_OPTIONS,
  muteFrames: 4,
};

// Pure per-frame pipeline: raw MediaPipe landmarks → HandFrame. No DOM, no camera.
export class P1Engine {
  readonly opts: EngineOptions;
  readonly fret: FretTracker;
  private roles: RoleAssigner;
  private mute: MuteDetector;
  readonly grab: Placement; // the page's "move dombyra" button toggles grab.enabled
  private aim: NeckAim;
  private neckSmoother: LandmarkSmoother;
  private strumSmoother: LandmarkSmoother;
  private lastT = -Infinity;

  constructor(opts: Partial<EngineOptions> = {}) {
    this.opts = { ...DEFAULT_ENGINE_OPTIONS, ...opts };
    this.roles = new RoleAssigner(this.opts.roles);
    this.fret = new FretTracker(cloneInstrument(this.opts.instrument));
    this.mute = new MuteDetector(this.opts.muteFrames);
    this.aim = new NeckAim(this.fret.cfg);
    this.grab = new Placement(this.fret.cfg);
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
    // Grab first: it may move the pivot the neck then aims from.
    const dragging = this.grab.update(neckData, strumData, this.aim.value, this.opts.aspect);
    const grip = neckData && gripPoint(neckData.points, this.fret.cfg.gripLift);
    const angle = this.aim.update(grip, t, this.opts.aspect);
    const pose = { angle, pivot: { ...this.fret.cfg.pivot } };

    return {
      t,
      neck: neckData,
      strum: strumData,
      fret: this.fret.update(neckData?.points, this.opts.aspect, pose),
      muted: this.mute.update(neckData?.points, this.opts.aspect),
      pose,
      placing: this.grab.enabled,
      dragging,
    };
  }

  setAspect(aspect: number): void {
    this.opts.aspect = aspect;
  }

  reset(): void {
    this.roles.reset();
    this.fret.reset();
    this.mute.reset();
    this.aim.reset();
    this.grab.reset();
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
