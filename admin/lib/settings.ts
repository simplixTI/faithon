import { getSupabaseAdmin } from "./supabase/admin";

export type Settings = Record<string, unknown>;

let cache: { at: number; data: Settings } | null = null;
const TTL_MS = 30_000;

/** Reads app_settings as a plain key→value map. 30s in-process cache. */
export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("app_settings").select("key, value");
  if (error) throw error;
  const out: Settings = {};
  for (const row of data ?? []) out[row.key] = row.value;
  cache = { at: Date.now(), data: out };
  return out;
}

export function invalidateSettingsCache() {
  cache = null;
}

/** Typed getters — return the seeded default if the key is missing. */
export async function getSetting<T = unknown>(key: string, fallback: T): Promise<T> {
  const s = await getSettings();
  return (s[key] as T) ?? fallback;
}
