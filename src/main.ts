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
  reversed: $<HTMLInputElement>("reversed"),
  zoneX0: $<HTMLInputElement>("zone-x0"),
  zoneX1: $<HTMLInputElement>("zone-x1"),
};

// P2 plugs in here: bus.subscribe(frame => { ... }).
export const bus = new FrameBus();
const engine = new P1Engine();
let live: LiveSource | undefined;
let replay: ReplaySource | undefined;
let recorder: Recorder | undefined;
let mode: "none" | "camera" | "replay" = "none";

Object.assign(window, { p1: { bus, engine } }); // for poking from DevTools

// ---- sources -------------------------------------------------------------

async function useCamera(): Promise<void> {
  replay?.stop();
  replay = undefined;
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

// ---- fret zone controls --------------------------------------------------

const zone = engine.fret.zone;
ui.zoneX0.value = String(zone.x0);
ui.zoneX1.value = String(zone.x1);
ui.reversed.checked = zone.reversed;
ui.reversed.addEventListener("change", () => (zone.reversed = ui.reversed.checked));
ui.zoneX0.addEventListener("input", () => (zone.x0 = Math.min(Number(ui.zoneX0.value), zone.x1 - 0.1)));
ui.zoneX1.addEventListener("input", () => (zone.x1 = Math.max(Number(ui.zoneX1.value), zone.x0 + 0.1)));

// ---- per-frame UI --------------------------------------------------------

let frameCount = 0;
let fpsWindowStart = performance.now();

bus.subscribe((f: HandFrame) => {
  recorder?.push(f);
  frameCount++;
});

function render(): void {
  const f = bus.latest;
  drawOverlay(ctx, f, mode === "camera" ? video : null, zone);

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
