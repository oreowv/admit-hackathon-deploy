// Records the stage as a video: the canvas (camera image, dombyra, strings, hands, effects) plus the
// dombyra's sound. MP4 where the browser can record it (easy to share), WebM otherwise.
const TYPES = [
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export type Clip = { blob: Blob; name: string };

export class VideoCapture {
  private rec?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private startedAt = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  static get supported(): boolean {
    return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
  }

  get recording(): boolean {
    return this.rec !== undefined;
  }

  get elapsedMs(): number {
    return this.rec ? performance.now() - this.startedAt : 0;
  }

  start(audio?: MediaStreamTrack): void {
    if (this.rec) return;
    const stream = this.canvas.captureStream(30);
    if (audio) stream.addTrack(audio);
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 });
    this.chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    rec.start(1000); // a chunk per second, so a long take doesn't sit in one buffer
    this.rec = rec;
    this.stream = stream;
    this.startedAt = performance.now();
  }

  // Resolves once the recorder has flushed its last chunk: the finished clip, ready to preview and save.
  stop(): Promise<Clip> {
    const rec = this.rec;
    const stream = this.stream;
    this.rec = this.stream = undefined;
    if (!rec) return Promise.reject(new Error("not recording"));
    return new Promise((resolve, reject) => {
      rec.onstop = () => {
        for (const t of stream?.getVideoTracks() ?? []) t.stop(); // the audio track is the live sound tap: keep it
        const type = rec.mimeType || "video/webm";
        const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        resolve({ blob: new Blob(this.chunks, { type }), name: `air-dombyra-${stamp}.${ext}` });
      };
      rec.onerror = () => reject(new Error("recording failed"));
      if (rec.state === "inactive") rec.onstop(new Event("stop"));
      else rec.stop();
    });
  }
}

type SavePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;

// "Save as…" dialog where the browser has one (Chrome, Edge); a normal download otherwise.
// Must be called from a click, so the browser treats it as the user's own save.
export async function saveClip(clip: Clip): Promise<boolean> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const ext = clip.name.split(".").pop()!;
      const handle = await picker({
        suggestedName: clip.name,
        types: [{ description: "Видео", accept: { [clip.blob.type.split(";")[0]]: [`.${ext}`] } }],
      });
      const file = await handle.createWritable();
      await file.write(clip.blob);
      await file.close();
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false; // player closed the dialog
      // any other failure: fall back to a plain download below
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(clip.blob);
  a.download = clip.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return true;
}
