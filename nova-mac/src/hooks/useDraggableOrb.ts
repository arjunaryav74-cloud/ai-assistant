import { useCallback, useEffect, useRef } from "react";
import { nova } from "../lib/ipc";

// A movement below this (px, screen space) counts as a click, not a drag.
const CLICK_MOVE_THRESHOLD = 4;
// Short momentum coast after release — "slides a little" past where the
// cursor let go instead of stopping dead, without turning into a long
// ice-skate. ~10 frames at 60fps.
const COAST_MAX_MS = 170;
const COAST_DECAY = 0.86;
const COAST_STOP_VELOCITY = 0.01;
const FRAME_MS = 16;

interface DragOrigin {
  mouseX: number;
  mouseY: number;
  winX: number;
  winY: number;
}

interface VelocitySample {
  x: number;
  y: number;
  t: number;
}

/**
 * Fully custom window drag for the orb, driven entirely from the renderer —
 * deliberately NOT `-webkit-app-region: drag`. That approach (drag region +
 * a click handler on the same element) is unreliable in Electron: once the
 * OS takes over the drag, the page stops reliably receiving the mouse events
 * a click handler needs, so clicking the orb silently stopped working. Doing
 * the whole gesture in JS (read our own position via window.screenX/Y, tell
 * main where to move on every mousemove) sidesteps that entirely — a click
 * with no real movement never touches the window at all — and, as a bonus,
 * gives full control over feel: a brief momentum coast on release instead of
 * the rigid, instant stop native window dragging is stuck with.
 */
export function useDraggableOrb(
  onClick: () => void,
  reportVelocity: (vx: number, vy: number) => void,
): { onMouseDown: (e: React.MouseEvent) => void } {
  const origin = useRef<DragOrigin | null>(null);
  const moved = useRef(false);
  const lastSample = useRef<VelocitySample | null>(null);
  const lastVelocity = useRef({ vx: 0, vy: 0 });
  const coastRaf = useRef<number | null>(null);
  const moveHandlerRef = useRef<(e: MouseEvent) => void>(() => {});
  const upHandlerRef = useRef<(e: MouseEvent) => void>(() => {});

  const stopCoast = useCallback(() => {
    if (coastRaf.current !== null) {
      cancelAnimationFrame(coastRaf.current);
      coastRaf.current = null;
    }
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const start = origin.current;
      if (!start) return;
      const dx = e.screenX - start.mouseX;
      const dy = e.screenY - start.mouseY;
      if (!moved.current && (Math.abs(dx) >= CLICK_MOVE_THRESHOLD || Math.abs(dy) >= CLICK_MOVE_THRESHOLD)) {
        moved.current = true;
      }
      if (!moved.current) return; // stay perfectly inert until it's a real drag

      const targetX = start.winX + dx;
      const targetY = start.winY + dy;
      nova().orbDragMove(targetX, targetY);

      const now = performance.now();
      const last = lastSample.current;
      if (last) {
        const dt = Math.max(1, now - last.t);
        const vx = (targetX - last.x) / dt;
        const vy = (targetY - last.y) / dt;
        lastVelocity.current = { vx, vy };
        reportVelocity(vx, vy);
      }
      lastSample.current = { x: targetX, y: targetY, t: now };
    },
    [reportVelocity],
  );
  moveHandlerRef.current = handleMouseMove;

  const runCoast = useCallback(() => {
    let { vx, vy } = lastVelocity.current;
    let x = lastSample.current?.x ?? 0;
    let y = lastSample.current?.y ?? 0;
    const start = performance.now();

    const tick = (now: number) => {
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (now - start > COAST_MAX_MS || speed < COAST_STOP_VELOCITY) {
        nova().orbDragEnd();
        coastRaf.current = null;
        return;
      }
      x += vx * FRAME_MS;
      y += vy * FRAME_MS;
      nova().orbDragMove(x, y);
      reportVelocity(vx, vy);
      vx *= COAST_DECAY;
      vy *= COAST_DECAY;
      coastRaf.current = requestAnimationFrame(tick);
    };
    coastRaf.current = requestAnimationFrame(tick);
  }, [reportVelocity]);

  const handleMouseUp = useCallback(() => {
    document.removeEventListener("mousemove", moveHandlerRef.current);
    document.removeEventListener("mouseup", upHandlerRef.current);
    origin.current = null;

    if (!moved.current) {
      onClick();
      return;
    }
    runCoast();
  }, [onClick, runCoast]);
  upHandlerRef.current = handleMouseUp;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Let buttons (settings/collapse, etc.) behave normally — never start a
    // drag from a mousedown that landed on one.
    if ((e.target as HTMLElement).closest?.("button")) return;
    stopCoast();
    moved.current = false;
    lastSample.current = null;
    origin.current = {
      mouseX: e.screenX,
      mouseY: e.screenY,
      winX: window.screenX,
      winY: window.screenY,
    };
    document.addEventListener("mousemove", moveHandlerRef.current);
    document.addEventListener("mouseup", upHandlerRef.current);
  }, [stopCoast]);

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", moveHandlerRef.current);
      document.removeEventListener("mouseup", upHandlerRef.current);
      stopCoast();
    };
  }, [stopCoast]);

  return { onMouseDown: handleMouseDown };
}
