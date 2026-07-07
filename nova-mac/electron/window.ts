import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { ORB_MINI_SIZE, ORB_PANEL_WIDTH, ORB_PANEL_HEIGHT, orbCenterOffset } from "@shared/orb-geometry";

export { ORB_MINI_SIZE, ORB_PANEL_WIDTH, ORB_PANEL_HEIGHT };

// Tight to the corner, hugging the menu bar the way Siri's own icon does.
const ORB_MARGIN = 8;

function orbBounds(expanded: boolean): { width: number; height: number } {
  return expanded
    ? { width: ORB_PANEL_WIDTH, height: ORB_PANEL_HEIGHT }
    : { width: ORB_MINI_SIZE, height: ORB_MINI_SIZE };
}

/**
 * Position (and size) the orb at the top-right of the display the cursor is on
 * (Siri-style corner popup), just under the menu bar. The top-right corner
 * stays anchored when toggling between mini and expanded.
 */
export function positionOrbTopRight(win: BrowserWindow, expanded: boolean): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  const size = orbBounds(expanded);
  win.setBounds(
    {
      x: x + width - size.width - ORB_MARGIN,
      y: y + ORB_MARGIN,
      width: size.width,
      height: size.height,
    },
    false,
  );
}

const RESIZE_ANIMATION_MS = 220;
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * Step a window's bounds from its current rect to `target` over `durationMs`,
 * always with `setBounds(..., false)` (no native animation flag). Electron's
 * native `animate: true` resize is well known to break window transparency
 * on macOS mid-animation — a transparent, frameless window flashes an opaque
 * white/black backing for the animation's duration, which is worse than the
 * instant snap it was meant to fix. Stepping manually keeps every individual
 * `setBounds` call in the always-transparent-safe `animate: false` mode
 * while still reading as a smooth resize.
 */
function animateWindowBounds(
  win: BrowserWindow,
  target: { x: number; y: number; width: number; height: number },
  durationMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const from = win.getBounds();
    const start = Date.now();
    function step() {
      if (win.isDestroyed()) {
        resolve();
        return;
      }
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const e = easeOutCubic(t);
      win.setBounds(
        {
          x: Math.round(from.x + (target.x - from.x) * e),
          y: Math.round(from.y + (target.y - from.y) * e),
          width: Math.round(from.width + (target.width - from.width) * e),
          height: Math.round(from.height + (target.height - from.height) * e),
        },
        false,
      );
      if (t < 1) {
        setTimeout(step, 1000 / 60);
      } else {
        resolve();
      }
    }
    step();
  });
}

/**
 * Resize in place, keeping the *orb itself* visually anchored — not a window
 * corner. Anchoring the top-right corner made the orb appear to jump ~140px
 * left and ~50px down on expand, because it sits near the top of the tall
 * panel rather than centered in the whole window; solving for the window
 * position that keeps `orbCenterOffset` at the same screen pixel before and
 * after resizing keeps the orb visually still while the panel grows around it.
 * Resolves once the animation finishes — callers use that to delay swapping
 * which React component is mounted until the window is at its final size, so
 * the panel's percentage-based layout never has to reflow against an
 * intermediate window size mid-animation.
 */
export function resizeOrb(win: BrowserWindow, expanded: boolean): Promise<void> {
  const current = win.getBounds();
  const size = orbBounds(expanded);
  const from = orbCenterOffset(!expanded);
  const to = orbCenterOffset(expanded);
  return animateWindowBounds(
    win,
    {
      x: current.x + from.x - to.x,
      y: current.y + from.y - to.y,
      ...size,
    },
    RESIZE_ANIMATION_MS,
  );
}

/**
 * Notify the caller when the display setup changes — an external monitor
 * gets connected/disconnected, resolution or arrangement changes, etc.
 * (Moving between virtual desktops/Spaces on the same display needs no
 * handling: `setVisibleOnAllWorkspaces` already keeps the window present
 * there without repositioning.) The caller decides what to do: reposition to
 * the default corner, or leave a user-dragged position alone if it's still
 * on-screen (see `isPointOnAnyDisplay`).
 */
export function watchDisplayChanges(onChange: () => void): () => void {
  screen.on("display-added", onChange);
  screen.on("display-removed", onChange);
  screen.on("display-metrics-changed", onChange);
  return () => {
    screen.removeListener("display-added", onChange);
    screen.removeListener("display-removed", onChange);
    screen.removeListener("display-metrics-changed", onChange);
  };
}

/** True if the point falls within any connected display's bounds. */
export function isPointOnAnyDisplay(point: { x: number; y: number }): boolean {
  return screen.getAllDisplays().some((d) => {
    const { x, y, width, height } = d.bounds;
    return point.x >= x && point.x < x + width && point.y >= y && point.y < y + height;
  });
}

export function createOrbWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: ORB_MINI_SIZE,
    height: ORB_MINI_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    // Deliberately NOT resizable:false — this is a frameless window so there
    // are no visible OS resize handles to disable anyway, and macOS's
    // NSWindowStyleMaskResizable bit (what this maps to) has been known to
    // interfere with purely-programmatic setBounds calls on some Electron/
    // macOS combinations. resizeOrb animates the window between mini and
    // panel sizes entirely via setBounds, so this needs to be unconstrained.
    fullscreenable: false,
    focusable: true,
    skipTaskbar: true,
    // No vibrancy: the mini state must be a fully transparent window with only
    // the orb visible (panel styling comes from CSS).
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Float above full-screen apps like Siri does.
  win.setAlwaysOnTop(true, "screen-saver");
  positionOrbTopRight(win, false);

  // Allow mic + camera access — without this Electron silently denies getUserMedia.
  // macOS will still show its own permission dialog on first use.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "mediaKeySystem");
  });

  // Stays hidden until a wake word, timer, or hotkey activates it — never
  // shown just because the window finished loading (same in dev and prod).
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  return win;
}

export function createAppWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    show: false,
    frame: true,
    transparent: false,
    vibrancy: "under-window",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#080808",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

  win.once("ready-to-show", () => win.show());
  return win;
}
