import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandFrame } from "./types";
import { P1Engine } from "./engine";

const BASE = import.meta.env.BASE_URL;

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

async function createLandmarker(delegate: "GPU" | "CPU"): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: `${BASE}models/hand_landmarker.task`, delegate },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

// Camera → MediaPipe → P1Engine, one HandFrame per new video frame.
export class LiveSource {
  private running = false;
  private lastVideoTime = -1;

  private constructor(
    readonly video: HTMLVideoElement,
    private landmarker: HandLandmarker,
    readonly engine: P1Engine,
    private stream: MediaStream,
  ) {}

  static async create(video: HTMLVideoElement, engine = new P1Engine()): Promise<LiveSource> {
    const stream = await startCamera(video);
    let landmarker: HandLandmarker;
    try {
      landmarker = await createLandmarker("GPU");
    } catch (e) {
      console.warn("[P1] GPU delegate failed, falling back to CPU", e);
      landmarker = await createLandmarker("CPU");
    }
    engine.setAspect(video.videoWidth / video.videoHeight);
    return new LiveSource(video, landmarker, engine, stream);
  }

  start(onFrame: (f: HandFrame) => void): void {
    if (this.running) return;
    this.running = true;
    this.engine.reset();
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const schedule = (cb: () => void) =>
      v.requestVideoFrameCallback ? v.requestVideoFrameCallback(cb) : requestAnimationFrame(cb);

    const tick = () => {
      if (!this.running) return;
      if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;
        const t = performance.now();
        const res = this.landmarker.detectForVideo(this.video, t);
        onFrame(this.engine.process(res.landmarks, t));
      }
      schedule(tick);
    };
    schedule(tick);
  }

  stop(): void {
    this.running = false;
  }

  dispose(): void {
    this.stop();
    this.stream.getTracks().forEach((tr) => tr.stop());
    this.landmarker.close();
  }
}
