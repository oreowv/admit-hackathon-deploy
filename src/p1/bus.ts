import type { HandFrame } from "./types";

export type FrameListener = (frame: HandFrame) => void;

// P2 subscribes here; it never touches the camera.
export class FrameBus {
  private listeners = new Set<FrameListener>();
  latest?: HandFrame;

  subscribe(fn: FrameListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(frame: HandFrame): void {
    this.latest = frame;
    for (const fn of this.listeners) fn(frame);
  }
}
