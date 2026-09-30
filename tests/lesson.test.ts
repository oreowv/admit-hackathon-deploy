import { describe, expect, it } from "vitest";
import { SONGS, arrange } from "../src/lesson/songs";
import { Lesson, frets } from "../src/lesson/lesson";

describe("songs", () => {
  it("fit 12 frets: songs 1 and 3 on the top string, song 2 moves to the bottom string at the same pitches", () => {
    expect(arrange(SONGS[0], "D-A").map((n) => [n.string, n.fret])).toEqual([7, 7, 8, 7, 3, 5, 7, 12].map((f) => [0, f]));
    expect(arrange(SONGS[1], "D-A").map((n) => [n.string, n.fret])).toEqual([3, 5, 8, 7, 6, 5, 8, 7, 3].map((f) => [1, f]));
    expect(arrange(SONGS[1], "D-G").map((n) => n.fret)).toEqual([5, 7, 10, 9, 8, 7, 10, 9, 5]);
    expect(arrange(SONGS[2], "D-A").every((n) => n.string === 0)).toBe(true);
    for (const s of SONGS) for (const t of ["D-A", "D-G"] as const) {
      expect(arrange(s, t).map((n) => n.midi)).toEqual(s.frets.map((f) => 50 + f)); // pitches unchanged
    }
  });
});

describe("Lesson", () => {
  const song = { id: "t", name: "t", frets: [7, 5] };
  const notes = arrange(song, "D-A");

  it("a wrong note doesn't advance and says exactly what to fix", () => {
    const l = new Lesson(song, notes, 0);
    const miss = l.judge([0], 5, false, 100);
    expect(miss).toMatchObject({ kind: "miss", mistake: "fret" });
    expect(miss.kind === "miss" && miss.hint).toContain("на 2 лада к корпусу");
    expect(l.index).toBe(0);
    expect(l.judge([0], 9, false, 200)).toMatchObject({ kind: "miss" });
    expect(l.judge([0], 9, false, 200).kind === "miss" && "ok").toBe("ok");
    expect(l.judge([0], 0, false, 300)).toMatchObject({ mistake: "offNeck" });
    expect(l.judge([0], 7, true, 300)).toMatchObject({ mistake: "muted" });
    expect(l.judge([1], 7, false, 300)).toMatchObject({ mistake: "string" });
  });

  it("the right note advances; finishing gives results", () => {
    const l = new Lesson(song, notes, 1000);
    expect(l.judge([0, 1], 7, false, 2000)).toMatchObject({ kind: "hit" }); // both strings is fine: the target sounded
    l.judge([0], 4, false, 2500);
    expect(l.judge([0], 5, false, 5000)).toEqual({ kind: "done" });
    expect(l.results()).toMatchObject({ accuracy: 67, attempts: 3, notes: 2, seconds: 4, top: ["fret", 1] });
  });

  it("Russian plural of лад", () => {
    expect([1, 2, 5, 11, 21, 22].map(frets)).toEqual(["1 лад", "2 лада", "5 ладов", "11 ладов", "21 лад", "22 лада"]);
  });
});
