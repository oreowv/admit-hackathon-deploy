import { FRET_SEMITONES, OPEN_STRINGS } from "../config";
import type { StringId } from "./types";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiFor(string: StringId, fret: number): number {
  return OPEN_STRINGS[string] + FRET_SEMITONES[Math.max(0, Math.min(fret, FRET_SEMITONES.length - 1))];
}

export function noteName(midi: number): string {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
