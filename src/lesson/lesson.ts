import type { StringId } from "../p2/types";
import type { Note, Song } from "./songs";

export type Mistake = "fret" | "offNeck" | "muted" | "string";
export type Feedback =
  | { kind: "hit"; note: Note }
  | { kind: "miss"; mistake: Mistake; hint: string }
  | { kind: "done" };

const STRING_NAME = ["верхняя", "нижняя"];

// "1 лад", "2 лада", "5 ладов".
export function frets(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return `${n} лад`;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} лада`;
  return `${n} ладов`;
}

// Step-by-step practice: waits for the right note, a wrong one doesn't advance and says exactly what to
// fix (the "error" mode). Counts attempts and mistakes for the results.
export class Lesson {
  index = 0;
  attempts = 0;
  mistakes: Record<Mistake, number> = { fret: 0, offNeck: 0, muted: 0, string: 0 };
  finishedAt?: number;

  constructor(
    readonly song: Song,
    readonly notes: Note[],
    readonly startedAt: number,
  ) {}

  get current(): Note | undefined {
    return this.notes[this.index];
  }

  get done(): boolean {
    return this.index >= this.notes.length;
  }

  // One strum: the strings it hit, the fret held, whether the left hand was muting.
  judge(strings: StringId[], fret: number, muted: boolean, t: number): Feedback {
    const target = this.current;
    if (!target) return { kind: "done" };
    this.attempts++;
    const miss = (mistake: Mistake, hint: string): Feedback => {
      this.mistakes[mistake]++;
      return { kind: "miss", mistake, hint };
    };
    if (muted) return miss("muted", "Разожмите кулак левой руки — сейчас он глушит струны");
    if (!strings.includes(target.string)) {
      return miss("string", `Нужна ${STRING_NAME[target.string]} струна — ведите палец через неё`);
    }
    if (fret !== target.fret) {
      if (fret === 0) return miss("offNeck", `Поставьте ладонь на гриф, на ${target.fret}-й лад`);
      const d = target.fret - fret;
      return miss(
        "fret",
        `Вы на ${fret}-м ладу, нужен ${target.fret}-й: сдвиньте левую руку на ${frets(Math.abs(d))} ${d > 0 ? "к корпусу" : "к головке"}`,
      );
    }
    this.index++;
    if (!this.done) return { kind: "hit", note: target };
    this.finishedAt = t;
    return { kind: "done" };
  }

  results(): { accuracy: number; attempts: number; notes: number; seconds: number; top?: [Mistake, number] } {
    const top = (Object.entries(this.mistakes) as [Mistake, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
    return {
      accuracy: this.attempts ? Math.round((this.notes.length / this.attempts) * 100) : 0,
      attempts: this.attempts,
      notes: this.notes.length,
      seconds: Math.round(((this.finishedAt ?? this.startedAt) - this.startedAt) / 1000),
      top,
    };
  }
}
