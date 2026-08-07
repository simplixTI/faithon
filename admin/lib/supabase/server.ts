import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieEntry = { name: string; value: string; options?: CookieOptions };

/**
 * SSR Supabase client bound to the request cookies.
 * Uses the anon key + user JWT — all queries flow through RLS.
 * Import from Server Components / Route Handlers / Server Actions.
 */
export async function getSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(entries: CookieEntry[]) {
          try {
            entries.forEach(({ name, value, options }: CookieEntry) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — Next disallows setting cookies here.
            // Middleware will refresh the session on the next request.
          }
        },
      },
    },
  );
}
