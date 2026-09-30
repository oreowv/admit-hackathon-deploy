import * as Tone from "tone";
import type { GestureEvent } from "./types";
import { midiFor } from "./notes";

// Two plucked voices, one per string: a new pluck on a string replaces what it was ringing, like a real
// string. Karplus-Strong (PluckSynth) with bright, long-ringing settings for the dombyra's twang.
export class DombyraAudio {
  private voices?: { synth: Tone.PluckSynth; gain: Tone.Gain }[];

  // Call from a click handler: browsers only allow audio after a user gesture.
  async unlock(): Promise<void> {
    if (this.voices) return;
    // lookAhead 0: play the moment a string is crossed instead of scheduling ~100 ms ahead.
    Tone.setContext(new Tone.Context({ latencyHint: "interactive", lookAhead: 0 }));
    await Tone.start();
    const out = new Tone.Gain(0.9).toDestination();
    this.voices = [0, 1].map(() => {
      const gain = new Tone.Gain(0).connect(out);
      const synth = new Tone.PluckSynth({ attackNoise: 1.5, dampening: 4200, resonance: 0.975, release: 0.08 });
      synth.connect(gain);
      return { synth, gain };
    });
  }

  handle(ev: GestureEvent): void {
    if (!this.voices) return;
    const now = Tone.now();
    if (ev.type === "pluck") {
      const v = this.voices[ev.string];
      v.gain.gain.setValueAtTime(ev.vel * (ev.muted ? 0.5 : 1), now);
      v.synth.triggerAttack(Tone.Frequency(midiFor(ev.string, ev.fret), "midi").toFrequency(), now);
      if (ev.muted) v.synth.triggerRelease(now + 0.04); // left fist on the strings: short dead "chk"
    } else if (ev.type === "mute") {
      for (const v of this.voices) v.synth.triggerRelease(now);
    }
  }
}
