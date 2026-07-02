import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

// Two orb window states: a tiny floating Siri-like orb, and the expanded chat panel.
export const ORB_MINI_SIZE = 96;
export const ORB_PANEL_WIDTH = 380;
export const ORB_PANEL_HEIGHT = 520;
// Tight to the corner, hugging the menu bar the way Siri's own icon does.
const ORB_MARGIN = 8;

function orbBounds(expanded: boolean): { width: number; height: number } {
  return expanded
    ? { width: ORB_PANEL_WIDTH, height: ORB_PANEL_HEIGHT }
    : { width: ORB_MINI_SIZE, height: ORB_MINI_SIZE };
}

// Where the orb's visual center sits relative to the window's top-left, per
// state — must track the actual rendered layout so resizeOrb can keep the
// *orb* visually anchored across expand/collapse, not just a window corner.
// MiniOrb (src/components/orb/MiniOrb.tsx) fills the whole mini window and
// centers its content, so it's simply the window's center. The expanded
// panel (src/components/orb/Orb.tsx, wrapped by src/App.tsx) stacks, from
// the window's top: the App.tsx wrapper's 8px padding, then a 34px icon
// strip (10px top padding + 24px buttons), then the orb itself at 118px —
// horizontally it's simply centered (the 8px wrapper padding is symmetric).
const PANEL_WRAPPER_PADDING = 8;
const PANEL_ICON_STRIP_HEIGHT = 34;
const PANEL_ORB_SIZE = 118;

function orbCenterOffset(expanded: boolean): { x: number; y: number } {
  return expanded
    ? {
        x: ORB_PANEL_WIDTH / 2,
        y: PANEL_WRAPPER_PADDING + PANEL_ICON_STRIP_HEIGHT + PANEL_ORB_SIZE / 2,
      }
    : { x: ORB_MINI_SIZE / 2, y: ORB_MINI_SIZE / 2 };
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

/**
 * Resize in place, keeping the *orb itself* visually anchored — not a window
 * corner. Anchoring the top-right corner made the orb appear to jump ~140px
 * left and ~50px down on expand, because it sits near the top of the tall
 * panel rather than centered in the whole window; solving for the window
 * position that keeps `orbCenterOffset` at the same screen pixel before and
 * after resizing keeps the orb visually still while the panel grows around it.
 */
export function resizeOrb(win: BrowserWindow, expanded: boolean): void {
  const current = win.getBounds();
  const size = orbBounds(expanded);
  const from = orbCenterOffset(!expanded);
  const to = orbCenterOffset(expanded);
  win.setBounds(
    {
      x: current.x + from.x - to.x,
      y: current.y + from.y - to.y,
      ...size,
    },
    false,
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
    resizable: false,
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
