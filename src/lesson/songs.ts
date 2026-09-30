import { TUNINGS, type TuningName } from "../config";
import { FRETS } from "../instrument";
import type { StringId } from "../p2/types";

export type Song = { id: string; name: string; frets: number[] };
export type Note = { string: StringId; fret: number; midi: number };

// Practice songs, written as fret numbers on the top (D) string.
export const SONGS: Song[] = [
  { id: "ex1", name: "Упражнение 1", frets: [7, 7, 8, 7, 3, 5, 7, 12] },
  { id: "ex2", name: "Упражнение 2", frets: [10, 12, 15, 14, 13, 12, 15, 14, 10] },
  { id: "ex3", name: "Упражнение 3", frets: [5, 5, 7, 8, 7, 10, 8, 7] },
];

// This dombyra has 12 frets. A song that doesn't fit on the top string moves to the bottom string at the
// same pitches (top-string fret 15 = bottom-string fret 8 in D–A); a single note that fits neither
// string of the chosen one goes to the other.
export function arrange(song: Song, tuning: TuningName): Note[] {
  const opens = TUNINGS[tuning];
  const pitches = song.frets.map((f) => opens[0] + f);
  const fits = (s: StringId, m: number) => m - opens[s] >= 0 && m - opens[s] <= FRETS;
  const main: StringId = pitches.every((m) => fits(0, m)) ? 0 : pitches.every((m) => fits(1, m)) ? 1 : 0;
  return pitches.map((midi) => {
    const s: StringId = fits(main, midi) ? main : main === 0 ? 1 : 0;
    return { string: s, fret: Math.max(0, Math.min(FRETS, midi - opens[s])), midi };
  });
}
