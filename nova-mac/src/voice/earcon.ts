/**
 * Synthesized audio cues (no assets — pure Web Audio oscillators).
 *
 * Deliberately exactly three cues — one per moment the user actually needs
 * audible feedback for: the mic opening, the mic closing, and something
 * going wrong. Every other transition (thinking, TTS starting, barge-in)
 * already has its own orb color, so a distinct chime for each of those was
 * extra noise on top of noise the user was already trying to listen through.
 *
 * listening — starts recording (wake word fired, or barge-in interrupts TTS
 *             to start a new turn): bright rising two-tone
 * finished  — stops recording (silence detected, kill phrase heard):
 *             short soft tick
 * error     — something failed (mic, transcription, chat): low double buzz
 */

export type CueName = "listening" | "finished" | "error";

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext {
  if (!ctx || ctx.state === "closed") ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

interface Note {
  freq: number;
  /** seconds after cue start */
  at: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
}

const CUES: Record<CueName, Note[]> = {
  listening: [
    { freq: 660, at: 0, duration: 0.09, gain: 0.16 },
    { freq: 990, at: 0.08, duration: 0.14, gain: 0.18 },
  ],
  finished: [{ freq: 880, at: 0, duration: 0.06, gain: 0.1 }],
  error: [
    { freq: 220, at: 0, duration: 0.12, gain: 0.14, type: "square" },
    { freq: 180, at: 0.15, duration: 0.16, gain: 0.12, type: "square" },
  ],
};

export function playCue(name: CueName): void {
  try {
    const audio = ensureCtx();
    const now = audio.currentTime + 0.01;
    for (const note of CUES[name]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = note.type ?? "sine";
      osc.frequency.value = note.freq;
      // Fast attack, exponential release — keeps cues soft, no clicks.
      gain.gain.setValueAtTime(0.0001, now + note.at);
      gain.gain.exponentialRampToValueAtTime(note.gain, now + note.at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.duration);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now + note.at);
      osc.stop(now + note.at + note.duration + 0.05);
    }
  } catch {
    // cues are best-effort
  }
}

/** Back-compat: the original single ack earcon maps to the listening cue. */
export async function playEarcon(): Promise<void> {
  playCue("listening");
}
