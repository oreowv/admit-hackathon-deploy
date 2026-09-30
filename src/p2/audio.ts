import * as Tone from "tone";
import type { GestureEvent } from "./types";

const SAMPLES = `${import.meta.env.BASE_URL}samples/`;

// "long": notes ring out naturally (up to ~4 s). "short": cut at SHORT_S like a real dombyra's quick,
// percussive decay.
export type Sustain = "long" | "short";
const SHORT_S = 0.5;
const SECOND_STRING_MS: [number, number] = [10, 25]; // gap between the two strings of one strum

// One string's voice. Each string is monophonic like a real one: a new pluck replaces what it rang.
interface Voice {
  play(midi: number, vel: number, muted: boolean, time: number, length?: number): void;
  stop(time: number): void;
}

// Recorded plucks (public/samples, see scripts/prepare-samples.mjs), repitched by Tone.Sampler to any fret.
class SampleVoice implements Voice {
  private sampler: Tone.Sampler;

  constructor(buffers: Tone.ToneAudioBuffers, notes: string[], out: Tone.InputNode) {
    const urls = Object.fromEntries(notes.map((n) => [n, buffers.get(n)]));
    this.sampler = new Tone.Sampler({ urls, release: 0.12 }).connect(out);
  }

  play(midi: number, vel: number, muted: boolean, time: number, length?: number): void {
    this.sampler.releaseAll(time); // re-striking a string stops its previous note
    const note = Tone.Frequency(midi, "midi").toNote();
    if (muted) this.sampler.triggerAttackRelease(note, 0.05, time, vel * 0.6); // left fist on the strings: dead "chk"
    else if (length) this.sampler.triggerAttackRelease(note, length, time, vel);
    else this.sampler.triggerAttack(note, time, vel);
  }

  stop(time: number): void {
    this.sampler.releaseAll(time);
  }
}

// Karplus-Strong fallback, used until the samples have loaded or if they can't be.
class SynthVoice implements Voice {
  private synth = new Tone.PluckSynth({ attackNoise: 1.5, dampening: 4200, resonance: 0.99, release: 0.12 });
  private gain = new Tone.Gain(0);

  constructor(out: Tone.InputNode) {
    this.synth.connect(this.gain);
    this.gain.connect(out);
  }

  play(midi: number, vel: number, muted: boolean, time: number, length?: number): void {
    this.gain.gain.setValueAtTime(vel * (muted ? 0.5 : 1), time);
    this.synth.triggerAttack(Tone.Frequency(midi, "midi").toFrequency(), time);
    if (muted) this.synth.triggerRelease(time + 0.04);
    else if (length) this.synth.triggerRelease(time + length);
  }

  stop(time: number): void {
    this.synth.triggerRelease(time);
  }
}

// Two strings, each with its own voice, so a strum over both rings as two notes and a single-string
// pluck rings alone. Shaped from nylon guitar towards a dombyra: highpass (thinner body), presence
// peak (bright twang), a short noise burst when the finger hits the strings, and the second string of
// a strum 10–25 ms after the first.
export class DombyraAudio {
  private voices?: Voice[];
  private out?: Tone.Gain;
  private tap?: MediaStreamAudioDestinationNode;
  private unlocking?: Promise<void>;
  private hit?: Tone.NoiseSynth;
  private room?: Tone.Reverb;
  private sweep?: { t: number; at: number }; // first pluck of the current strum: detector ms, audio time
  private _sustain: Sustain = "long";

  get sustain(): Sustain {
    return this._sustain;
  }

  set sustain(s: Sustain) {
    this._sustain = s;
    if (this.room) this.room.wet.value = s === "long" ? 0.22 : 0.1; // a long tail would undo the short decay
  }

  // Call from a click handler: browsers only allow audio after a user gesture. Runs once: overlapping
  // calls (the page's first click and a button click) share it instead of building a second context.
  unlock(): Promise<void> {
    return (this.unlocking ??= this.start());
  }

  private async start(): Promise<void> {
    // lookAhead 0: play the moment a string is crossed instead of scheduling ~100 ms ahead.
    Tone.setContext(new Tone.Context({ latencyHint: "interactive", lookAhead: 0 }));
    await Tone.start();

    const out = (this.out = new Tone.Gain(0.9).toDestination());
    this.room = new Tone.Reverb({ decay: 2.8, wet: 0.22 }).connect(out);
    const air = new Tone.Filter({ type: "lowpass", frequency: 8000, rolloff: -12 }).connect(this.room);
    const twang = new Tone.Filter({ type: "peaking", frequency: 2500, Q: 1, gain: 4 }).connect(air);
    const thin = new Tone.Filter({ type: "highpass", frequency: 150, rolloff: -12 }).connect(twang);

    // The finger striking the strings: a 30 ms band-passed noise burst at the start of each strum.
    const hitTone = new Tone.Filter({ type: "bandpass", frequency: 3000, Q: 0.8 }).connect(thin);
    this.hit = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
      volume: -10,
    }).connect(hitTone);

    this.sustain = this._sustain;
    this.voices = [new SynthVoice(thin), new SynthVoice(thin)];
    void this.loadSamples(thin);
  }

  // Everything the dombyra plays, as a live audio track: goes into the screen recording.
  captureTrack(): MediaStreamTrack | undefined {
    if (!this.out) return undefined;
    if (!this.tap) {
      this.tap = Tone.getContext().createMediaStreamDestination();
      this.out.connect(this.tap);
    }
    return this.tap.stream.getAudioTracks()[0];
  }

  handle(ev: GestureEvent): void {
    if (!this.voices) return;
    const now = Tone.now();
    if (ev.type === "pluck") {
      let time = now;
      if (ev.first) {
        this.sweep = { t: ev.t, at: now };
        this.hit?.triggerAttack(now, 0.3 + 0.7 * ev.vel);
      } else if (this.sweep) {
        // Second string of the strum: its real delay after the first, kept within 10–25 ms. Crossings
        // that fell into the same camera frame would otherwise sound as one.
        const [lo, hi] = SECOND_STRING_MS;
        time = Math.max(now, this.sweep.at + Math.min(hi, Math.max(lo, ev.t - this.sweep.t)) / 1000);
      }
      const length = this._sustain === "short" ? SHORT_S : undefined;
      this.voices[ev.string].play(ev.midi, ev.vel, ev.muted, time, length);
    } else if (ev.type === "mute") {
      for (const v of this.voices) v.stop(now);
    }
  }

  private async loadSamples(out: Tone.InputNode): Promise<void> {
    try {
      const res = await fetch(`${SAMPLES}manifest.json`);
      const { notes } = (await res.json()) as { notes: Record<string, string> };
      const buffers = await new Promise<Tone.ToneAudioBuffers>((resolve, reject) => {
        const b = new Tone.ToneAudioBuffers({ urls: notes, baseUrl: SAMPLES, onload: () => resolve(b), onerror: reject });
      });
      const names = Object.keys(notes);
      this.voices = [new SampleVoice(buffers, names, out), new SampleVoice(buffers, names, out)];
    } catch (e) {
      console.warn("[audio] samples unavailable, staying on the synth", e);
    }
  }
}
