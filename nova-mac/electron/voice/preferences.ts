import { getSupabase } from "../supabase";
import { getUserId } from "../memory/client";
import { DEFAULT_VOICE_PREFERENCES, type VoicePreferences } from "@shared/types";

export async function getVoicePreferences(): Promise<VoicePreferences> {
  try {
    const userId = await getUserId();
    const { data, error } = await getSupabase()
      .from("user_preferences")
      .select("voice")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("[nova] getVoicePreferences failed:", error.message);
      return DEFAULT_VOICE_PREFERENCES;
    }
    const stored = (data?.voice ?? {}) as Partial<VoicePreferences>;
    return { ...DEFAULT_VOICE_PREFERENCES, ...stored };
  } catch (err) {
    console.error("[nova] getVoicePreferences failed:", err);
    return DEFAULT_VOICE_PREFERENCES;
  }
}
