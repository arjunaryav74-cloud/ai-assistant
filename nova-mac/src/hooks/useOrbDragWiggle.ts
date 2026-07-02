import { useCallback, useEffect, useRef, useState } from "react";
import { nova } from "../lib/ipc";

export interface OrbWiggle {
  scaleX: number;
  scaleY: number;
  rotate: number;
}

export const NEUTRAL_WIGGLE: OrbWiggle = { scaleX: 1, scaleY: 1, rotate: 0 };

// Tuned so a drag reads as a soft, subtle jelly wobble — noticeable but not
// cartoonish — and can never stretch enough to clip against the orb's window.
const VELOCITY_TO_STRETCH = 34;
const MAX_STRETCH = 0.09;
const SQUASH_RATIO = 0.5;
/** No new drag-velocity tick within this window means the drag stopped —
 *  spring back to neutral rather than waiting indefinitely. */
const IDLE_DECAY_MS = 140;

/** Pure conversion from instantaneous drag velocity (px/ms) to a squash-and-
 *  stretch transform: stretched along the direction of motion, squashed
 *  perpendicular to it, capped so it never exceeds the orb's clipping margin. */
export function velocityToWiggle(vx: number, vy: number): OrbWiggle {
  const speed = Math.sqrt(vx * vx + vy * vy);
  const stretch = Math.min(speed * VELOCITY_TO_STRETCH, MAX_STRETCH);
  const rotate = stretch > 0.01 ? (Math.atan2(vy, vx) * 180) / Math.PI : 0;
  return { scaleX: 1 + stretch, scaleY: 1 - stretch * SQUASH_RATIO, rotate };
}

/**
 * Turns a stream of velocity reports (pixels/ms) into a squash-and-stretch
 * transform: the orb stretches along the direction of motion and squashes
 * perpendicular to it, like a soft jelly ball, then settles back to neutral
 * (via a bouncy spring in the consuming component) once reports stop
 * arriving. Source-agnostic — callers feed it from wherever the velocity
 * actually comes from (IPC broadcast, a local drag handler, etc).
 */
export function useWiggleState(): { wiggle: OrbWiggle; reportVelocity: (vx: number, vy: number) => void } {
  const [wiggle, setWiggle] = useState<OrbWiggle>(NEUTRAL_WIGGLE);
  const decayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportVelocity = useCallback((vx: number, vy: number) => {
    setWiggle(velocityToWiggle(vx, vy));
    if (decayTimer.current) clearTimeout(decayTimer.current);
    decayTimer.current = setTimeout(() => setWiggle(NEUTRAL_WIGGLE), IDLE_DECAY_MS);
  }, []);

  useEffect(() => () => {
    if (decayTimer.current) clearTimeout(decayTimer.current);
  }, []);

  return { wiggle, reportVelocity };
}

/** Wiggle driven by the main process's native-drag velocity broadcast — used
 *  by the expanded panel, which is still dragged via a native OS drag region. */
export function useOrbDragWiggle(): OrbWiggle {
  const { wiggle, reportVelocity } = useWiggleState();

  useEffect(() => {
    const off = nova().onOrbDragVelocity?.(({ vx, vy }) => reportVelocity(vx, vy));
    return () => off?.();
  }, [reportVelocity]);

  return wiggle;
}
