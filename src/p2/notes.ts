import { DEFAULT_TUNING, FRET_SEMITONES, TUNINGS, type TuningName } from "../config";
import type { StringId } from "./types";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiFor(string: StringId, fret: number, tuning: TuningName = DEFAULT_TUNING): number {
  return TUNINGS[tuning][string] + FRET_SEMITONES[Math.max(0, Math.min(fret, FRET_SEMITONES.length - 1))];
}

export function noteName(midi: number): string {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
