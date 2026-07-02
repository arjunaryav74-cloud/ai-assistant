import { getSupabase } from "../supabase";
import { getUserId } from "../memory/client";
import type { VoicePreferences, ProactivePrefs } from "@shared/types";
import { DEFAULT_PROACTIVE_PREFS } from "@shared/types";

function proactiveToRow(p: Partial<ProactivePrefs>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (p.proactiveMode !== undefined) row["proactive_tier"] = p.proactiveMode;
  if (p.dailyBriefEnabled !== undefined) row["brief_enabled"] = p.dailyBriefEnabled;
  if (p.briefTimeLocal !== undefined) row["brief_time_local"] = p.briefTimeLocal;
  if (p.timezone !== undefined) row["timezone"] = p.timezone;
  if (p.quietHoursStart !== undefined) row["quiet_hours_start"] = p.quietHoursStart;
  if (p.quietHoursEnd !== undefined) row["quiet_hours_end"] = p.quietHoursEnd;
  return row;
}

function rowToProactive(row: Record<string, unknown> | null): ProactivePrefs {
  return {
    ...DEFAULT_PROACTIVE_PREFS,
    ...(row?.proactive_tier !== undefined ? { proactiveMode: row.proactive_tier as ProactivePrefs["proactiveMode"] } : {}),
    ...(row?.brief_enabled !== undefined ? { dailyBriefEnabled: row.brief_enabled as boolean } : {}),
    ...(row?.brief_time_local !== undefined ? { briefTimeLocal: row.brief_time_local as string } : {}),
    ...(row?.timezone !== undefined ? { timezone: row.timezone as string } : {}),
    ...(row?.quiet_hours_start !== undefined ? { quietHoursStart: row.quiet_hours_start as string } : {}),
    ...(row?.quiet_hours_end !== undefined ? { quietHoursEnd: row.quiet_hours_end as string } : {}),
  };
}

// Every write here THROWS on a Supabase error instead of swallowing it —
// PrefsSet's ipcMain.handle propagates that rejection back to the renderer,
// which is what lets SettingsPage's existing try/catch actually show "Save
// failed" instead of a false "Saved" when a write silently didn't happen.

export async function saveVoicePreferences(patch: Partial<VoicePreferences>): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { data: existing, error: readError } = await supabase
    .from("user_preferences")
    .select("voice")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw new Error(`Reading existing voice prefs failed: ${readError.message}`);

  const merged = { ...(existing?.voice ?? {}), ...patch };

  const { error: writeError } = await supabase
    .from("user_preferences")
    .upsert({ user_id: userId, voice: merged }, { onConflict: "user_id" });
  if (writeError) throw new Error(`Saving voice prefs failed: ${writeError.message}`);
}

export async function saveProactivePreferences(patch: Partial<ProactivePrefs>): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: userId, ...proactiveToRow(patch) }, { onConflict: "user_id" });
  if (error) throw new Error(`Saving proactive prefs failed: ${error.message}`);
}

export async function getAllPreferences(): Promise<{ voice: VoicePreferences; proactive: ProactivePrefs }> {
  const { getVoicePreferences } = await import("./preferences");
  const supabase = getSupabase();
  const userId = await getUserId();
  const { data, error } = await supabase
    .from("user_preferences")
    .select("proactive_tier, brief_enabled, brief_time_local, timezone, quiet_hours_start, quiet_hours_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) console.error("[nova] getAllPreferences (proactive) failed:", error.message);

  return {
    voice: await getVoicePreferences(),
    proactive: rowToProactive(error ? null : (data as Record<string, unknown> | null)),
  };
}
