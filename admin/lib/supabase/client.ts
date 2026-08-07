import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (Client Components only).
 * Anon key — all queries flow through RLS.
 */
export function getSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
