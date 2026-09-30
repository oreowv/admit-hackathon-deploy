import {
  FrameBus,
  LiveSource,
  ReplaySource,
  drawOverlay,
  parseRecording,
  P1Engine,
  type HandFrame,
  type Recording,
} from "./p1";
import { DombyraAudio, StrumDetector, StrumFx, noteName } from "./p2";
import { DEFAULT_TUNING, TUNINGS, type TuningName } from "./config";
import { VideoCapture, saveClip, type Clip } from "./capture";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("canvas");
const ctx = canvas.getContext("2d")!;
const video = $<HTMLVideoElement>("video");
const ui = {
  source: $("source"),
  fps: $("fps"),
  handNeck: $("hand-neck"),
  handStrum: $("hand-strum"),
  fret: $("fret"),
  mute: $("mute"),
  message: $("message"),
  btnCamera: $<HTMLButtonElement>("btn-camera"),
  fileReplay: $<HTMLInputElement>("file-replay"),
  btnVideo: $<HTMLButtonElement>("btn-video"),
  clip: $<HTMLDivElement>("clip"),
  clipVideo: $<HTMLVideoElement>("clip-video"),
  clipSave: $<HTMLButtonElement>("clip-save"),
  clipDiscard: $<HTMLButtonElement>("clip-discard"),
  btnPlace: $<HTMLButtonElement>("btn-place"),
  strings: $<HTMLSelectElement>("strings"),
  sustain: $<HTMLSelectElement>("sustain"),
  tuning: $<HTMLSelectElement>("tuning"),
  follow: $<HTMLInputElement>("follow"),
  tilt: $<HTMLInputElement>("tilt"),
  height: $<HTMLInputElement>("height"),
};

// P2 plugs in here: bus.subscribe(frame => { ... }).
export const bus = new FrameBus();
const engine = new P1Engine();
let live: LiveSource | undefined;
let replay: ReplaySource | undefined;
let mode: "none" | "camera" | "replay" = "none";

const strum = new StrumDetector(engine.fret.cfg);
const audio = new DombyraAudio();
const fx = new StrumFx();

// Both strings, or just the upper (D) / lower (G) one. Remembered per browser.
const STRINGS_KEY = "air-dombyra:strings";
function setStrings(value: string): void {
  if (!["both", "0", "1"].includes(value)) value = "both";
  strum.only = value === "0" ? 0 : value === "1" ? 1 : undefined;
  ui.strings.value = value;
  try {
    localStorage.setItem(STRINGS_KEY, value);
  } catch {
    // no storage: choice just isn't remembered
  }
}
try {
  setStrings(localStorage.getItem(STRINGS_KEY) ?? "both");
} catch {
  setStrings("both");
}
ui.strings.addEventListener("change", () => setStrings(ui.strings.value));

// Dombyra tuning: D–A (a fifth) or D–G (a fourth). Remembered per browser.
const TUNING_KEY = "air-dombyra:tuning";
function setTuning(value: string): void {
  strum.tuning = value in TUNINGS ? (value as TuningName) : DEFAULT_TUNING;
  ui.tuning.value = strum.tuning;
  const [top, bottom] = TUNINGS[strum.tuning].map((m) => noteName(m).replace(/\d+$/, ""));
  ui.strings.options[1].text = `Только верхняя (${top})`;
  ui.strings.options[2].text = `Только нижняя (${bottom})`;
  try {
    localStorage.setItem(TUNING_KEY, strum.tuning);
  } catch {
    // no storage: choice just isn't remembered
  }
}
try {
  setTuning(localStorage.getItem(TUNING_KEY) ?? DEFAULT_TUNING);
} catch {
  setTuning(DEFAULT_TUNING);
}
ui.tuning.addEventListener("change", () => setTuning(ui.tuning.value));

// Long ring or a short, percussive dombyra-like decay. Remembered per browser.
const SUSTAIN_KEY = "air-dombyra:sustain";
function setSustain(value: string): void {
  audio.sustain = value === "short" ? "short" : "long";
  ui.sustain.value = audio.sustain;
  try {
    localStorage.setItem(SUSTAIN_KEY, audio.sustain);
  } catch {
    // no storage: choice just isn't remembered
  }
}
try {
  setSustain(localStorage.getItem(SUSTAIN_KEY) ?? "long");
} catch {
  setSustain("long");
}
ui.sustain.addEventListener("change", () => setSustain(ui.sustain.value));

Object.assign(window, { p1: { bus, engine }, p2: { strum, audio } }); // for poking from DevTools

// Browsers start audio only after a user gesture; the first click anywhere unlocks it.
window.addEventListener("pointerdown", () => void audio.unlock(), { once: true });

// ---- sources -------------------------------------------------------------

async function useCamera(): Promise<void> {
  void audio.unlock();
  replay?.stop();
  replay = undefined;
  strum.reset();
  ui.message.textContent = "Запускаю камеру и MediaPipe…";
  ui.btnCamera.disabled = true;
  try {
    live ??= await LiveSource.create(video, engine);
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    live.start((f) => bus.emit(f));
    mode = "camera";
    ui.source.textContent = "камера";
    ui.message.textContent = "";
    ui.btnVideo.disabled = !VideoCapture.supported;
  } catch (e) {
    console.error(e);
    ui.message.textContent = `Не удалось открыть камеру: ${(e as Error).message}`;
  } finally {
    ui.btnCamera.disabled = false;
  }
}

function useReplay(rec: Recording, name: string): void {
  live?.stop();
  replay?.stop();
  strum.reset();
  canvas.width = rec.width || 1280;
  canvas.height = rec.height || 720;
  replay = new ReplaySource(rec, true);
  replay.start((f) => bus.emit(f));
  mode = "replay";
  ui.source.textContent = `запись: ${name}`;
  ui.message.textContent = "";
  ui.btnVideo.disabled = !VideoCapture.supported;
}

ui.btnCamera.addEventListener("click", useCamera);

ui.fileReplay.addEventListener("change", async () => {
  const file = ui.fileReplay.files?.[0];
  if (!file) return;
  try {
    useReplay(parseRecording(await file.text()), file.name);
  } catch (e) {
    ui.message.textContent = `Не удалось прочитать файл: ${(e as Error).message}`;
  }
  ui.fileReplay.value = "";
});

// ---- video recording -----------------------------------------------------

// What's on the stage (camera, dombyra, strings, effects) plus the sound: record → stop → preview →
// save (the player's own click, so the browser shows its save dialog / download) or delete.
const capture = new VideoCapture(canvas);
let clip: Clip | undefined;

function showClip(c: Clip | undefined): void {
  if (ui.clipVideo.src) URL.revokeObjectURL(ui.clipVideo.src);
  clip = c;
  ui.clip.hidden = !c;
  if (c) ui.clipVideo.src = URL.createObjectURL(c.blob);
  else ui.clipVideo.removeAttribute("src");
}

ui.btnVideo.addEventListener("click", async () => {
  if (capture.recording) {
    ui.btnVideo.disabled = true;
    ui.btnVideo.textContent = "Сохраняю…";
    try {
      showClip(await capture.stop());
      ui.message.textContent = "";
    } catch (e) {
      ui.message.textContent = `Запись не удалась: ${(e as Error).message}`;
    }
    ui.btnVideo.classList.remove("recording");
    ui.btnVideo.textContent = "● Записать видео";
    ui.btnVideo.disabled = false;
    return;
  }
  showClip(undefined);
  await audio.unlock(); // the sound track only exists once audio is running
  capture.start(audio.captureTrack());
  ui.btnVideo.classList.add("recording");
});

ui.clipSave.addEventListener("click", async () => {
  if (clip && (await saveClip(clip))) showClip(undefined);
});
ui.clipDiscard.addEventListener("click", () => showClip(undefined));

// ---- instrument placement ------------------------------------------------

const instrument = engine.fret.cfg; // drawing and fret detection share this object
const POSE_KEY = "air-dombyra:pose";

// Where the player last placed and turned the dombyra survives reloads.
function loadPose(): void {
  try {
    const p = JSON.parse(localStorage.getItem(POSE_KEY) ?? "null");
    if (typeof p?.pivot?.x === "number" && typeof p?.pivot?.y === "number" && typeof p?.angle === "number") {
      instrument.pivot = { x: p.pivot.x, y: p.pivot.y };
      instrument.angle = p.angle;
    }
  } catch {
    // no storage: keep the default pose
  }
}

function savePose(): void {
  try {
    localStorage.setItem(POSE_KEY, JSON.stringify({ pivot: instrument.pivot, angle: instrument.angle }));
  } catch {
    // no storage: pose just isn't remembered
  }
}

function syncSliders(): void {
  ui.tilt.value = String(instrument.angle);
  ui.height.value = String(instrument.pivot.y);
}

loadPose();
syncSliders();
ui.follow.checked = instrument.followHand;
ui.tilt.disabled = instrument.followHand; // the tilt slider is only for a fixed neck
ui.follow.addEventListener("change", () => {
  instrument.followHand = ui.tilt.disabled = ui.follow.checked;
});
ui.tilt.addEventListener("input", () => {
  instrument.angle = Number(ui.tilt.value);
  savePose();
});
ui.height.addEventListener("input", () => {
  instrument.pivot.y = Number(ui.height.value);
  savePose();
});

// Click → right pinch on the tail moves, left pinch turns → click again to lock and remember it.
ui.btnPlace.addEventListener("click", () => {
  const placing = (engine.grab.enabled = !engine.grab.enabled);
  ui.btnPlace.classList.toggle("recording", placing);
  ui.btnPlace.textContent = placing ? "🔒 Зафиксировать" : "Двигать домбыру";
  ui.message.textContent = placing
    ? "Правая рука: щипок на кружке у хвоста — двигать. Левая рука: щипок и поворот — наклон"
    : "";
  if (!placing) {
    savePose();
    syncSliders();
  }
});

// ---- per-frame UI --------------------------------------------------------

let frameCount = 0;
let fpsWindowStart = performance.now();

bus.subscribe((f: HandFrame) => {
  frameCount++;
  // Straight from the frame callback to the synth: no rAF or React in between.
  for (const ev of strum.push(f, canvas.width / canvas.height)) {
    audio.handle(ev);
    fx.handle(ev, performance.now());
  }
});

function render(): void {
  const f = bus.latest;
  drawOverlay(ctx, f, mode === "camera" ? video : null, instrument, strum.only);
  fx.draw(ctx, f, instrument, performance.now());

  ui.fret.textContent = String(f?.fret ?? 0);
  ui.mute.classList.toggle("on", !!f?.muted);
  ui.handNeck.classList.toggle("on", !!f?.neck);
  ui.handNeck.textContent = f?.neck ? "гриф ✓" : "гриф ✕";
  ui.handStrum.classList.toggle("on", !!f?.strum);
  ui.handStrum.textContent = f?.strum ? "бой ✓" : "бой ✕";
  if (capture.recording) {
    const s = Math.floor(capture.elapsedMs / 1000);
    ui.btnVideo.textContent = `■ Остановить ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  const now = performance.now();
  if (now - fpsWindowStart >= 1000) {
    ui.fps.textContent = `${Math.round((frameCount * 1000) / (now - fpsWindowStart))} fps`;
    frameCount = 0;
    fpsWindowStart = now;
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
