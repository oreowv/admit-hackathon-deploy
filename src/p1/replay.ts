import type { HandFrame, Recording } from "./types";

export function parseRecording(text: string): Recording {
  const rec = JSON.parse(text) as Recording;
  if (rec.version !== 1 || !Array.isArray(rec.frames)) throw new Error("Not a HandFrame recording (v1)");
  return rec;
}

// Plays a recording back in real time. Timestamps keep increasing across loops.
export class ReplaySource {
  private running = false;
  private raf = 0;

  constructor(readonly recording: Recording, private loop = true) {}

  start(onFrame: (f: HandFrame) => void, onEnd?: () => void): void {
    const frames = this.recording.frames;
    if (!frames.length) return;
    this.running = true;
    const t0 = frames[0].t;
    const span = frames[frames.length - 1].t - t0 + 33;
    const clockStart = performance.now();
    let idx = 0;
    let pass = 0;

    const tick = () => {
      if (!this.running) return;
      const elapsed = performance.now() - clockStart - pass * span;
      while (idx < frames.length && frames[idx].t - t0 <= elapsed) {
        onFrame({ ...frames[idx], t: frames[idx].t + pass * span });
        idx++;
      }
      if (idx >= frames.length) {
        if (!this.loop) {
          this.running = false;
          onEnd?.();
          return;
        }
        idx = 0;
        pass++;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}

// Synchronous, deterministic replay — what P2 should use in tests.
export function* frames(rec: Recording): Generator<HandFrame> {
  yield* rec.frames;
}
