import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRecording, frames } from "../src/p1/replay";

// Any recording in recordings/ must satisfy the P1 → P2 contract.
describe("recordings/synthetic-demo.json", () => {
  const rec = parseRecording(readFileSync(new URL("../recordings/synthetic-demo.json", import.meta.url), "utf8"));

  it("matches the HandFrame contract", () => {
    let prevT = -Infinity;
    for (const f of frames(rec)) {
      expect(f.t).toBeGreaterThan(prevT);
      prevT = f.t;
      expect(f.fret).toBeGreaterThanOrEqual(0);
      expect(f.fret).toBeLessThanOrEqual(6);
      expect(typeof f.muted).toBe("boolean");
      for (const h of [f.neck, f.strum]) {
        if (!h) continue;
        expect(h.points).toHaveLength(21);
        for (const p of h.points) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(1);
        }
        expect(h.size).toBeGreaterThan(0);
      }
    }
  });

  it("covers the scenarios P2 needs", () => {
    const fs = rec.frames;
    expect(new Set(fs.map((f) => f.fret)).size).toBe(6);
    expect(fs.some((f) => f.muted)).toBe(true);
    expect(fs.some((f) => !f.strum)).toBe(true);
    expect(fs.some((f) => f.strum && f.strum.size < 0.06)).toBe(true);
  });
});
