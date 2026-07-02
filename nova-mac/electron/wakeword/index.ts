import { Worker } from "node:worker_threads";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEBOUNCE_MS = 3000;

/**
 * Maps the Settings "Wake word sensitivity" slider (0.35 strict … 0.85
 * sensitive, per its UI copy "higher fires easier") onto the engine's score
 * threshold, whose sense is inverted (score must EXCEED threshold to fire,
 * so a lower threshold is what actually fires more easily). 0.05 was the
 * previous hardcoded default and effectively the only value ever used —
 * this control did nothing until it was wired up, so anyone who'd already
 * dragged the slider to max "sensitive" (thinking it had no effect) would
 * otherwise land on a threshold low enough to false-trigger on background
 * noise/TV/conversation the moment it started actually working. Range is
 * deliberately narrow and floored well above zero to keep even max
 * sensitivity safe.
 */
export function wakeSensitivityToThreshold(sensitivity: number): number {
  const s = Math.max(0, Math.min(1, sensitivity));
  // 0 -> 0.075 (strict) … 1 -> 0.03 (sensitive); real slider domain
  // 0.35..0.85 maps to ~0.059..0.037 — a safe band either side of the old
  // hardcoded 0.05 default.
  return Math.max(0.03, 0.075 - s * 0.045);
}

export class WakeWordController {
  private worker: Worker | null = null;
  private enabled = true;
  private pausedForTurn = false;
  private lastFireAt = 0;
  /** Require score to drop below threshold before re-firing */
  private armed = true;
  private onWake: (() => void) | null = null;
  private threshold: number;

  constructor(
    private readonly modelsDir: string = join(
      dirname(fileURLToPath(import.meta.url)),
      "models",
    ),
    initialThreshold = 0.05,
  ) {
    this.threshold = initialThreshold;
  }

  /** Called live when the user changes wake sensitivity in Settings. */
  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  start(onWake: () => void): void {
    this.onWake = onWake;
    const workerPath = join(dirname(fileURLToPath(import.meta.url)), "worker.js");
    this.worker = new Worker(workerPath, {
      workerData: { modelsDir: this.modelsDir },
    });
    this.worker.on("message", (msg: { type: string; score?: number }) => {
      if (msg.type === "ready") { console.log("[nova] wake engine ready"); return; }
      if (msg.type !== "score" || msg.score == null) return;
      if (msg.score > 0.001) console.log("[nova] wake score", msg.score.toFixed(4));
      this.handleScore(msg.score);
    });
    this.worker.on("error", (e) => console.error("[nova] wake worker error", e));
  }

  private handleScore(score: number): void {
    if (!this.enabled || this.pausedForTurn) return;
    if (score < this.threshold) { this.armed = true; return; }
    const now = Date.now();
    if (this.armed && now - this.lastFireAt >= DEBOUNCE_MS) {
      this.armed = false;
      this.lastFireAt = now;
      this.onWake?.();
    }
  }

  private frameCount = 0;
  pushFrame(buf: ArrayBuffer): void {
    if (!this.enabled || this.pausedForTurn) return;
    this.frameCount++;
    if (this.frameCount % 50 === 0) console.log("[nova] wake frames received:", this.frameCount);
    this.worker?.postMessage({ type: "frame", buf }, [buf]);
  }

  setEnabled(on: boolean): void { this.enabled = on; }
  pauseForTurn(): void { this.pausedForTurn = true; }
  /**
   * Resume ingesting frames — but do NOT force re-arm. Score processing is
   * skipped entirely while paused, so `armed` is frozen at whatever it was
   * the moment the last wake fired (false). Blindly resetting it to true
   * here meant that if the sound that caused the false wake was still
   * ringing (persistent background noise/TV/conversation, not a one-off
   * blip), the very next score message — often within a frame or two of
   * resuming — could immediately pass threshold again and fire, producing
   * a tight repeat loop that kept "hearing" things nobody said. Now it only
   * re-arms the normal way, in handleScore, once the score has genuinely
   * dropped back below threshold at least once after resuming.
   */
  resume(): void { this.pausedForTurn = false; }
}
