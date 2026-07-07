// Single source of truth for the orb window's two sizes and where the orb's
// visual center sits within each — used by both the main process (window
// positioning math) and the renderer (so the orb can be pinned at a fixed
// pixel offset instead of flex/percentage-centered, which would otherwise
// drift as the window animates between sizes; see MiniOrb.tsx / Orb.tsx).

export const ORB_MINI_SIZE = 96;
export const ORB_PANEL_WIDTH = 380;
export const ORB_PANEL_HEIGHT = 520;

/** The rendered VoiceOrb's pixel size in each state (the window is larger
 *  than this to leave room for the WebGL glow to bleed past the sphere). */
export const MINI_ORB_VISUAL_SIZE = 76;
export const PANEL_ORB_VISUAL_SIZE = 118;

/** App.tsx's wrapper padding + Orb.tsx's icon strip, ahead of the orb. */
export const PANEL_WRAPPER_PADDING = 8;
export const PANEL_ICON_STRIP_HEIGHT = 34;

/** Orb's visual center, relative to the window's top-left, per state. */
export function orbCenterOffset(expanded: boolean): { x: number; y: number } {
  return expanded
    ? {
        x: ORB_PANEL_WIDTH / 2,
        y: PANEL_WRAPPER_PADDING + PANEL_ICON_STRIP_HEIGHT + PANEL_ORB_VISUAL_SIZE / 2,
      }
    : { x: ORB_MINI_SIZE / 2, y: ORB_MINI_SIZE / 2 };
}

/** Fixed top-left pixel position for the orb's own box (not its center) —
 *  what components pin themselves to so they don't drift via flex/percentage
 *  centering while the window is animating between sizes. */
export function orbBoxPosition(expanded: boolean): { top: number; left: number } {
  const center = orbCenterOffset(expanded);
  const size = expanded ? PANEL_ORB_VISUAL_SIZE : MINI_ORB_VISUAL_SIZE;
  return { top: center.y - size / 2, left: center.x - size / 2 };
}
