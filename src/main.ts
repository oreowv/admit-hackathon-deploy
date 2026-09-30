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
import { LessonUi } from "./lesson/ui";

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
  help: $<HTMLDialogElement>("help"),
  toast: $("toast"),
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

// Learning mode: songs in the sidebar, one note at a time on the stage.
const lessons = new LessonUi({
  tuning: () => strum.tuning,
  ensureCamera: async () => {
    if (mode !== "camera") await useCamera();
  },
  // One-string exercises switch the other string off; leaving restores the player's own choice.
  setOnly: (only) => {
    if (only === undefined) setStrings(ui.strings.value);
    else strum.only = only;
  },
});
ui.tuning.addEventListener("change", () => lessons.renderSongs());

// Gesture guide: header button, sidebar button; closes on ✕, Esc, or a click outside it.
for (const id of ["btn-help", "btn-help2"]) $(id).addEventListener("click", () => ui.help.showModal());
$("help-close").addEventListener("click", () => ui.help.close());
ui.help.addEventListener("click", (e) => {
  if (e.target === ui.help) ui.help.close();
});

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
    ui.btnVideo.innerHTML = '<span class="spinner" aria-hidden="true"></span>Сохраняю видео…';
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
// Move mode on/off: the button, or both open palms held still for a second (frame.toggle).
function togglePlacing(): void {
  const placing = (engine.grab.enabled = !engine.grab.enabled);
  ui.btnPlace.classList.toggle("recording", placing);
  ui.btnPlace.textContent = placing ? "🔒 Зафиксировать" : "Двигать домбыру";
  if (!placing) {
    savePose();
    syncSliders();
  }
}
ui.btnPlace.addEventListener("click", togglePlacing);

// ---- per-frame UI --------------------------------------------------------

let frameCount = 0;
let fpsWindowStart = performance.now();

bus.subscribe((f: HandFrame) => {
  frameCount++;
  if (f.toggle && mode === "camera") togglePlacing();
  // Straight from the frame callback to the synth: no rAF or React in between.
  for (const ev of strum.push(f, canvas.width / canvas.height)) {
    audio.handle(ev);
    fx.handle(ev, performance.now());
    lessons.handle(ev);
  }
});

// Top-of-stage hint: how to use placing mode, or which hand to bring into view. A hand counts as gone
// after HAND_LOST_MS, so a frame or two of lost tracking doesn't make it flicker.
const HAND_LOST_MS = 500;
let neckSeen = 0;
let strumSeen = 0;
let toastHtml = "";

function updateToast(f: HandFrame | undefined, now: number): void {
  if (f?.neck) neckSeen = now;
  if (f?.strum) strumSeen = now;
  const noNeck = now - neckSeen > HAND_LOST_MS;
  const noStrum = now - strumSeen > HAND_LOST_MS;
  let html = "";
  if (f?.palmsHold) {
    const pct = Math.round(f.palmsHold * 100);
    html =
      `<span class="t-ic t-hold" style="--p:${pct}%">✋</span>` +
      `<span>Держите обе ладони… ${engine.grab.enabled ? "зафиксирую домбыру" : "включу перемещение"}</span>`;
  } else if (engine.grab.enabled) {
    html =
      '<span class="t-ic t-strum">✥</span><span>Правая: щипок в кружке на корпусе — двигать</span>' +
      '<span class="t-sep"></span><span class="t-ic t-neck">⟲</span><span>Левая: щипок в кружке на грифе — поворот</span>' +
      '<span class="t-sep"></span><span>✋✋ 1 с — готово</span>';
  } else if (mode === "camera" && noNeck && noStrum) {
    html = '<span class="dot dot-neck"></span><span class="dot dot-strum"></span><span>Покажите обе руки: левую — на гриф, правую — к струнам</span>';
  } else if (mode === "camera" && noNeck) {
    html = '<span class="dot dot-neck"></span><span>Левая рука вне кадра — верните её на гриф</span>';
  } else if (mode === "camera" && noStrum) {
    html = '<span class="dot dot-strum"></span><span>Правая рука вне кадра — верните её к струнам</span>';
  }
  if (html !== toastHtml) {
    toastHtml = html;
    ui.toast.innerHTML = html; // fixed strings only
    ui.toast.hidden = !html;
  }
}

function render(): void {
  const f = bus.latest;
  updateToast(f, performance.now());
  drawOverlay(ctx, f, mode === "camera" ? video : null, instrument, strum.only, lessons.target);
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
