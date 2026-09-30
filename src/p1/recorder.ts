import type { HandFrame, Recording } from "./types";

// Collects HandFrames for a fixed duration; the result is what P2 replays.
export class Recorder {
  private frames: HandFrame[] = [];
  private startT = 0;
  private active = false;

  constructor(
    private durationMs: number,
    private meta: { label: string; width: number; height: number },
    private onDone: (rec: Recording) => void,
  ) {}

  get recording(): boolean {
    return this.active;
  }

  get progress(): number {
    if (!this.active || !this.frames.length) return 0;
    return Math.min(1, (this.frames[this.frames.length - 1].t - this.startT) / this.durationMs);
  }

  start(): void {
    this.frames = [];
    this.active = true;
    this.startT = NaN;
  }

  push(frame: HandFrame): void {
    if (!this.active) return;
    if (Number.isNaN(this.startT)) this.startT = frame.t;
    this.frames.push(frame);
    if (frame.t - this.startT >= this.durationMs) this.finish();
  }

  finish(): void {
    if (!this.active) return;
    this.active = false;
    const t0 = this.frames[0]?.t ?? 0;
    this.onDone({
      version: 1,
      createdAt: new Date().toISOString(),
      ...this.meta,
      frames: this.frames.map((f) => ({ ...f, t: f.t - t0 })),
    });
  }
}

export function downloadRecording(rec: Recording): void {
  // Round to 5 decimals: plenty for 0..1 coords and ms, keeps files ~3x smaller.
  const json = JSON.stringify(rec, (_, v) => (typeof v === "number" ? Math.round(v * 1e5) / 1e5 : v));
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const stamp = rec.createdAt.replace(/[:.]/g, "-").slice(0, 19);
  a.download = `handframes_${rec.label || "rec"}_${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
