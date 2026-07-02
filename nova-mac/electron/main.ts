import { config as loadEnv } from "dotenv";
// Load env into the main process BEFORE anything reads process.env (e.g. Supabase,
// Anthropic, OpenAI). electron-vite does not populate process.env for the main
// process the way Next.js auto-loads .env.local — we must do it explicitly.
// .env.local takes precedence; .env is a fallback (dotenv never overrides set vars).
loadEnv({ path: [".env.local", ".env"] });

import { app, BrowserWindow, globalShortcut, ipcMain, Notification } from "electron";
import { join } from "node:path";
import { createOrbWindow, createAppWindow, positionOrbTopRight, resizeOrb } from "./window";
import { initTimerManager } from "./timers";
import { createTray } from "./tray";
import { registerIpcHandlers, registerChatBridge, registerWakeBridge, registerWindowHandlers } from "./ipc";
import { streamChat, cancelChat } from "./chat";
import { startSignIn, signOut, getAuthState, handleAuthCallback, restoreSession } from "./auth";
import { WakeWordController } from "./wakeword/index";
import { IpcChannel } from "@shared/types";

let orbWin: BrowserWindow | null = null;
let appWin: BrowserWindow | null = null;
// Hold a reference so the tray is not garbage-collected.
let _trayRef: ReturnType<typeof createTray> | null = null;

// Siri-style orb lifecycle: a tiny orb floats permanently at the top-right of
// the screen. It expands into the chat panel when clicked, when a reply is
// showing (renderer requests it), on hotkey, or when a timer fires — and
// collapses back to just the orb afterwards. Main owns the expanded state:
// every change resizes the window (top-right anchored) and is broadcast to the
// renderer via OrbExpandedChanged.
let orbExpanded = false;

function setOrbExpanded(on: boolean): void {
  if (!orbWin || orbWin.isDestroyed()) return;
  orbExpanded = on;
  resizeOrb(orbWin, on);
  orbWin.webContents.send(IpcChannel.OrbExpandedChanged, on);
}

function ensureOrbVisible(): void {
  if (!orbWin || orbWin.isDestroyed()) return;
  if (!orbWin.isVisible()) {
    positionOrbTopRight(orbWin, orbExpanded);
    // showInactive: don't steal focus from whatever the user is doing.
    orbWin.showInactive();
  }
}

app.dock?.hide(); // no Dock icon — tray-only

app.setAsDefaultProtocolClient("nova");
// macOS delivers deep links via open-url
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (url.startsWith("nova://auth-callback")) {
    void handleAuthCallback(url);
  } else if (url.startsWith("nova://connections-callback")) {
    void import("./google/connections").then((m) => m.handleConnectionsCallback(url, appWin));
  }
});

app.whenReady().then(async () => {
  registerIpcHandlers({
    ping: async () => "pong",
    authStatus: getAuthState,
    authSignIn: startSignIn,
    authSignOut: signOut,
    syncConversations: () => import("./sync").then((m) => m.listConversations()),
    syncMemories: () => import("./sync").then((m) => m.listMemories()),
    transcribe: (req, provider) => import("./voice/stt").then((m) => m.transcribe(req, provider)),
    synthesize: (req) => import("./voice/tts").then((m) => m.synthesize(req)),
    getVoicePreferences: () => import("./voice/preferences").then((m) => m.getVoicePreferences()),
  });
  registerChatBridge({
    start: (req, sender) =>
      void streamChat(req, (channel, payload) => sender.send(channel, payload)),
    cancel: cancelChat,
  });

  registerWindowHandlers(
    () => orbWin,
    () => appWin,
    () => {
      appWin = createAppWindow();
      appWin.on("closed", () => {
        appWin = null;
        ensureOrbVisible(); // bring the corner orb back when the app window closes
      });
      return appWin;
    },
  );

  // Prefs
  ipcMain.handle(IpcChannel.PrefsGet, () =>
    import("./voice/save-preferences").then((m) => m.getAllPreferences()),
  );
  ipcMain.handle(IpcChannel.PrefsSet, async (_e, patch: { voice?: unknown; proactive?: unknown }) => {
    const mod = await import("./voice/save-preferences");
    if (patch.voice) await mod.saveVoicePreferences(patch.voice as never);
    if (patch.proactive) await mod.saveProactivePreferences(patch.proactive as Record<string, unknown>);
    const updated = await mod.getAllPreferences();
    // Broadcast to all windows so orb voice prefs stay in sync
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IpcChannel.PrefsChanged, updated.voice);
    }
    return updated;
  });

  // Reminders
  ipcMain.handle(IpcChannel.RemindersGet, () =>
    import("./memory/reminders").then((m) => m.listRemindersIpc()),
  );
  ipcMain.handle(IpcChannel.RemindersDone, (_e, id: string) =>
    import("./memory/reminders").then((m) => m.completeReminderIpc(id)),
  );
  ipcMain.handle(IpcChannel.RemindersDelete, (_e, id: string) =>
    import("./memory/reminders").then((m) => m.deleteReminderIpc(id)),
  );

  // Connections
  ipcMain.handle(IpcChannel.ConnectionsStatus, () =>
    import("./google/connections").then((m) => m.getConnectionsStatus()),
  );
  ipcMain.handle(IpcChannel.ConnectionsConnect, (_e, req: { service: string }) =>
    import("./google/connections").then((m) =>
      m.startOAuthFlow(req.service as import("./google/scopes").GoogleService),
    ),
  );
  ipcMain.handle(IpcChannel.ConnectionsDisconnect, (_e, req: { service: string }) =>
    import("./google/connections").then((m) =>
      m.disconnectService(req.service as import("./google/scopes").GoogleService),
    ),
  );

  // Memory
  ipcMain.handle(IpcChannel.MemorySearch, (_e, req: { query: string }) =>
    import("./memory/manage").then((m) => m.searchMemoriesIpc(req.query)),
  );
  ipcMain.handle(IpcChannel.MemoryPin, (_e, req: { id: string; pinned: boolean }) =>
    import("./memory/manage").then((m) => m.pinMemoryIpc(req.id, req.pinned)),
  );
  ipcMain.handle(IpcChannel.MemoryArchive, (_e, req: { id: string; archived: boolean }) =>
    import("./memory/manage").then((m) => m.archiveMemoryIpc(req.id, req.archived)),
  );
  ipcMain.handle(IpcChannel.MemoryDelete, (_e, id: string) =>
    import("./memory/manage").then((m) => m.deleteMemoryIpc(id)),
  );

  // Wake-word controller: resolve models dir for dev vs packaged builds
  const modelsDir = app.isPackaged
    ? join(process.resourcesPath, "wakeword-models")
    : join(app.getAppPath(), "electron", "wakeword", "models");
  const wake = new WakeWordController(modelsDir);
  wake.start(() => {
    wake.pauseForTurn(); // stop ingesting frames during the voice turn
    ensureOrbVisible(); // orb animates in place; renderer expands when the reply lands
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IpcChannel.WakeDetected);
  });
  registerWakeBridge({
    pushFrame: (buf) => wake.pushFrame(buf),
    setEnabled: (on) => wake.setEnabled(on),
  });
  // Resume wake detection once the voice turn completes.
  ipcMain.on(IpcChannel.VoiceTurnEnded, () => {
    wake.resume();
  });

  // Renderer requests to grow/shrink the orb (orb click, auto-expand on reply,
  // collapse chevron).
  ipcMain.on(IpcChannel.OrbSetExpanded, (_e, on: boolean) => setOrbExpanded(on));

  // Session timers (set via the set_timer tool). On fire: notification + orb popup;
  // the orb renderer plays the chime and shows the label (and collapses after).
  initTimerManager((timer) => {
    if (Notification.isSupported()) {
      new Notification({ title: "Timer done", body: timer.label }).show();
    }
    ensureOrbVisible();
    // The renderer expands the panel itself when the notice lands (and
    // collapses it again after the notice dismisses).
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IpcChannel.TimerFired, { id: timer.id, label: timer.label });
    }
  });

  try {
    const { probeNative } = await import("./native-probe/index.js");
    console.log("[nova] native probe:", probeNative());
  } catch {
    console.warn("[nova] native probe not built (expected in dev)");
  }
  await restoreSession();
  orbWin = createOrbWindow();
  _trayRef = createTray(orbWin, () => {
    // "Open Nova" tray item callback
    let app = appWin;
    if (!app || app.isDestroyed()) {
      app = createAppWindow();
      appWin = app;
      app.on("closed", () => {
        appWin = null;
        ensureOrbVisible();
      });
    }
    orbWin?.hide();
    app.show();
    app.focus();
  });
  void _trayRef; // Keep reference to prevent garbage collection
  // Hotkey toggles the chat panel: mini orb ↔ expanded chat.
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (!orbWin) return;
    if (!orbWin.isVisible()) {
      positionOrbTopRight(orbWin, true);
      orbWin.show();
      setOrbExpanded(true);
      return;
    }
    setOrbExpanded(!orbExpanded);
    if (orbExpanded) orbWin.focus();
  });
  orbWin.once("ready-to-show", () => console.log("[nova] orb window ready"));
});

app.on("will-quit", () => globalShortcut.unregisterAll());
// Tray-only app: do not quit when the window closes.
app.on("window-all-closed", () => {});
