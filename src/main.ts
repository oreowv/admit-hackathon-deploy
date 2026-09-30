import {
  FrameBus,
  LiveSource,
  ReplaySource,
  Recorder,
  downloadRecording,
  drawOverlay,
  parseRecording,
  P1Engine,
  type HandFrame,
  type Recording,
} from "./p1";
import { DombyraAudio, StrumDetector, StrumFx } from "./p2";

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
  btnRecord: $<HTMLButtonElement>("btn-record"),
  recLabel: $<HTMLSelectElement>("rec-label"),
  recDuration: $<HTMLSelectElement>("rec-duration"),
  recProgress: $<HTMLProgressElement>("rec-progress"),
  btnPlace: $<HTMLButtonElement>("btn-place"),
  follow: $<HTMLInputElement>("follow"),
  tilt: $<HTMLInputElement>("tilt"),
  height: $<HTMLInputElement>("height"),
};

// P2 plugs in here: bus.subscribe(frame => { ... }).
export const bus = new FrameBus();
const engine = new P1Engine();
let live: LiveSource | undefined;
let replay: ReplaySource | undefined;
let recorder: Recorder | undefined;
let mode: "none" | "camera" | "replay" = "none";

const strum = new StrumDetector(engine.fret.cfg);
const audio = new DombyraAudio();
const fx = new StrumFx();

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
    ui.btnRecord.disabled = false;
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
  recorder?.finish();
  strum.reset();
  canvas.width = rec.width || 1280;
  canvas.height = rec.height || 720;
  replay = new ReplaySource(rec, true);
  replay.start((f) => bus.emit(f));
  mode = "replay";
  ui.source.textContent = `запись: ${name}`;
  ui.message.textContent = "";
  ui.btnRecord.disabled = true;
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

// ---- recording -----------------------------------------------------------

ui.btnRecord.addEventListener("click", () => {
  if (recorder?.recording) {
    recorder.finish();
    return;
  }
  recorder = new Recorder(
    Number(ui.recDuration.value),
    { label: ui.recLabel.value, width: canvas.width, height: canvas.height },
    (rec) => {
      downloadRecording(rec);
      ui.btnRecord.classList.remove("recording");
      ui.btnRecord.textContent = "● Записать";
      ui.recProgress.value = 0;
    },
  );
  recorder.start();
  ui.btnRecord.classList.add("recording");
  ui.btnRecord.textContent = "■ Остановить";
});

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
  recorder?.push(f);
  frameCount++;
  // Straight from the frame callback to the synth: no rAF or React in between.
  for (const ev of strum.push(f, canvas.width / canvas.height)) {
    audio.handle(ev);
    fx.handle(ev, performance.now());
  }
});

function render(): void {
  const f = bus.latest;
  drawOverlay(ctx, f, mode === "camera" ? video : null, instrument);
  fx.draw(ctx, f, instrument, performance.now());

  ui.fret.textContent = String(f?.fret ?? 0);
  ui.mute.classList.toggle("on", !!f?.muted);
  ui.handNeck.classList.toggle("on", !!f?.neck);
  ui.handNeck.textContent = f?.neck ? "гриф ✓" : "гриф ✕";
  ui.handStrum.classList.toggle("on", !!f?.strum);
  ui.handStrum.textContent = f?.strum ? "бой ✓" : "бой ✕";
  if (recorder?.recording) ui.recProgress.value = recorder.progress;

  const now = performance.now();
  if (now - fpsWindowStart >= 1000) {
    ui.fps.textContent = `${Math.round((frameCount * 1000) / (now - fpsWindowStart))} fps`;
    frameCount = 0;
    fpsWindowStart = now;
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
