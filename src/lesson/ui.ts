import { TUNINGS, type TuningName } from "../config";
import { noteName } from "../p2/notes";
import type { GestureEvent } from "../p2/types";
import { Lesson, type Feedback, type Mistake } from "./lesson";
import { SONGS, arrange, type Note, type Song } from "./songs";

const MISTAKE_TIP: Record<Mistake, string> = {
  fret: "не тот лад — смотрите, чтобы синяя точка на ладони была на подсвеченном ладу",
  offNeck: "ладонь уходила с грифа — держите её на грифе",
  muted: "кулак глушил струну — держите пальцы раскрытыми",
  string: "не та струна — ведите палец через подсвеченную струну",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Learning mode on the page: song list, the lesson panel on the stage, the results window.
export class LessonUi {
  lesson?: Lesson;

  constructor(
    private deps: { tuning: () => TuningName; ensureCamera: () => Promise<void>; setOnly: (s?: 0 | 1) => void },
  ) {
    $("lesson-close").addEventListener("click", () => this.close());
    $("res-close").addEventListener("click", () => $<HTMLDialogElement>("results").close());
    $("res-retry").addEventListener("click", () => this.restart(0));
    $("res-next").addEventListener("click", () => this.restart(1));
    this.renderSongs();
  }

  // The note to play now, for drawing on the dombyra.
  get target(): Note | undefined {
    return this.lesson?.current;
  }

  renderSongs(): void {
    const box = $("songs");
    box.replaceChildren(
      ...SONGS.map((song) => {
        const b = document.createElement("button");
        b.className = "song";
        const notes = arrange(song, this.deps.tuning());
        const string = notes[0].string === 0 ? "на верхней струне" : "на нижней струне";
        const best = this.best(song);
        b.innerHTML = `<span class="song-name"></span><span class="song-frets"></span><span class="song-meta"></span>`;
        b.querySelector(".song-name")!.textContent = song.name;
        b.querySelector(".song-frets")!.textContent = notes.map((n) => n.fret).join(" · ");
        b.querySelector(".song-meta")!.textContent = `одна струна · ${string}${best !== undefined ? ` · лучший ${best}%` : ""}`;
        b.addEventListener("click", () => void this.start(song));
        return b;
      }),
    );
  }

  async start(song: Song): Promise<void> {
    $<HTMLDialogElement>("results").close();
    await this.deps.ensureCamera();
    this.lesson = new Lesson(song, arrange(song, this.deps.tuning()), performance.now());
    $("lesson").hidden = false;
    const str = this.lesson.notes[0].string;
    const letter = noteName(TUNINGS[this.deps.tuning()][str]).replace(/\d+$/, "");
    $("lesson-title").textContent = song.name;
    $("lesson-note").textContent = `Упражнение на одной струне — ${str === 0 ? "верхней" : "нижней"} (${letter}). Вторая струна на время урока выключена.`;
    this.deps.setOnly(str); // one-string exercise: the other string doesn't sound or count
    this.feedback({ kind: "hit", note: this.lesson.current! }, "Играйте подсвеченную ноту");
  }

  close(): void {
    if (this.lesson) this.deps.setOnly(undefined);
    this.lesson = undefined;
    $("lesson").hidden = true;
  }

  // Strums are judged one at a time; other events don't matter here.
  handle(ev: GestureEvent): void {
    const l = this.lesson;
    if (!l || ev.type !== "strum") return;
    const fb = l.judge(ev.strings, ev.fret, ev.muted, performance.now());
    if (fb.kind === "done") return this.finish();
    this.feedback(fb);
  }

  private feedback(fb: Feedback, text?: string): void {
    const l = this.lesson!;
    const notesEl = $("lesson-notes");
    const open = TUNINGS[this.deps.tuning()];
    notesEl.replaceChildren(
      ...l.notes.map((n, i) => {
        const chip = document.createElement("span");
        chip.className = `note-chip${i < l.index ? " done" : i === l.index ? " current" : ""}`;
        chip.innerHTML = `<b></b><i></i>`;
        chip.querySelector("b")!.textContent = String(n.fret);
        chip.querySelector("i")!.textContent = noteName(open[n.string]).replace(/\d+$/, "");
        return chip;
      }),
    );
    $("lesson-progress").textContent = `${l.index} / ${l.notes.length}`;
    const el = $("lesson-feedback");
    el.className = `lesson-feedback ${fb.kind === "miss" ? "fb-miss" : "fb-hit"}`;
    el.textContent = fb.kind === "miss" ? `↺ Ещё раз: ${fb.hint}` : text ?? "✓ Верно! Следующая нота";
    notesEl.querySelector(".current")?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  private finish(): void {
    const l = this.lesson!;
    const r = l.results();
    const prev = this.best(l.song);
    if (prev === undefined || r.accuracy > prev) {
      try {
        localStorage.setItem(`air-dombyra:best:${l.song.id}`, String(r.accuracy));
      } catch {
        // no storage: best score just isn't kept
      }
    }
    this.close();
    this.last = l.song;
    $("res-title").textContent = `${l.song.name} — готово!`;
    $("res-acc").textContent = `${r.accuracy}%`;
    $("res-notes").textContent = String(r.notes);
    $("res-tries").textContent = String(r.attempts);
    $("res-time").textContent = `${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, "0")}`;
    $("res-tip").textContent = r.top ? `Чаще всего: ${MISTAKE_TIP[r.top[0]]} (${r.top[1]}×).` : "Без единой ошибки — отлично!";
    $("res-best").textContent =
      prev === undefined || r.accuracy > prev ? "🏆 Новый личный рекорд" : `Лучший результат: ${prev}%`;
    this.renderSongs();
    $<HTMLDialogElement>("results").showModal();
  }

  private last?: Song;

  private restart(step: 0 | 1): void {
    const i = SONGS.findIndex((s) => s.id === this.last?.id);
    void this.start(SONGS[(i + step + SONGS.length) % SONGS.length]);
  }

  private best(song: Song): number | undefined {
    try {
      const v = localStorage.getItem(`air-dombyra:best:${song.id}`);
      return v === null ? undefined : Number(v);
    } catch {
      return undefined;
    }
  }
}
