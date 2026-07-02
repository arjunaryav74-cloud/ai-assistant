import { BrowserWindow } from "electron";
import { getSupabase } from "./supabase";
import { saveSession, loadSession, clearSession } from "./session-store";
import { IpcChannel, type AuthState } from "@shared/types";
import { resetConversationCache } from "./conversation";
import { resetUserIdCache } from "./memory/client";

function emit(channel: IpcChannel, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

/**
 * The web app creates this row via ensureAppUser() in its auth callback
 * route; nova-mac has its own separate callback (nova://auth-callback) that
 * never did the same thing. Every other table's user_id references
 * public.users(id), so a user whose very first sign-in happens through this
 * app (not the web app) would hit a foreign-key violation on the first
 * write anywhere — reminders, memories, and Settings saves would all
 * silently fail. Safe to call on every sign-in: upsert-with-onConflict is a
 * no-op once the row exists.
 */
async function ensureAppUser(userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("users")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
  if (error) console.error("[nova] ensureAppUser failed:", error.message);
}

export async function startSignIn(email: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: "nova://auth-callback" },
  });
  if (error) throw error;
}

export async function handleAuthCallback(url: string): Promise<void> {
  console.log("[nova] auth callback url:", url);
  // Supabase can deliver tokens as hash (#access_token=...) or query param (?code=...)
  const hashPart = url.split("#")[1] ?? "";
  const queryPart = url.split("?")[1]?.split("#")[0] ?? "";
  const hashParams = new URLSearchParams(hashPart);
  const queryParams = new URLSearchParams(queryPart);

  const access_token = hashParams.get("access_token");
  const refresh_token = hashParams.get("refresh_token");
  const code = queryParams.get("code");

  if (access_token && refresh_token) {
    const { data, error } = await getSupabase().auth.setSession({ access_token, refresh_token });
    if (error) { console.error("[nova] setSession error:", error); throw error; }
    if (data.user) await ensureAppUser(data.user.id);
    saveSession({ access_token, refresh_token });
    emit(IpcChannel.AuthChanged, await getAuthState());
    return;
  }

  if (code) {
    const { data, error } = await getSupabase().auth.exchangeCodeForSession(code);
    if (error) { console.error("[nova] exchangeCode error:", error); throw error; }
    if (data.session) {
      if (data.user) await ensureAppUser(data.user.id);
      saveSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
      emit(IpcChannel.AuthChanged, await getAuthState());
    }
    return;
  }

  console.warn("[nova] auth callback: no tokens or code found in url");
}

export async function restoreSession(): Promise<void> {
  const stored = loadSession();
  if (!stored) return;
  // If this silently fails (e.g. an expired refresh token), every DB call
  // for the rest of the session runs unauthenticated — RLS then makes every
  // read/write behave like there's no signed-in user at all, including
  // every Settings save. Log it loudly since there's nowhere else for a
  // user to see this.
  const { error } = await getSupabase().auth.setSession(stored);
  if (error) console.error("[nova] restoreSession failed — starting signed out:", error.message);
}

export async function getAuthState(): Promise<AuthState> {
  const { data } = await getSupabase().auth.getUser();
  return { signedIn: !!data.user, email: data.user?.email ?? null };
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
  clearSession();
  resetConversationCache();
  resetUserIdCache();
  emit(IpcChannel.AuthChanged, { signedIn: false, email: null });
}
