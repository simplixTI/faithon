"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * Handles BOTH auth flows:
 *   - PKCE (?code=xxx): exchangeCodeForSession
 *   - Implicit (#access_token=xxx&refresh_token=xxx): setSession
 *
 * We need this client-side because URL fragments are never sent to
 * the server. admin.generateLink() (used by our Resend flow) returns
 * tokens via the implicit flow — they arrive in the fragment.
 */
export default function AuthCallback() {
  const router = useRouter();
  const [status, setStatus] = useState<string>("Signing you in…");

  useEffect(() => {
    (async () => {
      const supabase = getSupabaseBrowser();

      // 1) Implicit flow — tokens in the URL fragment
      const hash = window.location.hash?.replace(/^#/, "") ?? "";
      if (hash.includes("access_token=")) {
        const params = new URLSearchParams(hash);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        const errorDescription = params.get("error_description");

        if (errorDescription) {
          router.replace(`/login?e=${encodeURIComponent(errorDescription)}`);
          return;
        }
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) { router.replace(`/login?e=${encodeURIComponent(error.message)}`); return; }
          // Clear the hash from the URL for cleanliness before navigating
          history.replaceState(null, "", window.location.pathname);
          router.replace("/");
          return;
        }
      }

      // 2) PKCE flow — ?code=xxx in the query
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) { router.replace(`/login?e=${encodeURIComponent(error.message)}`); return; }
        router.replace("/");
        return;
      }

      // 3) Nothing usable — bounce to login
      setStatus("No sign-in token found in the URL. Returning to login…");
      setTimeout(() => router.replace("/login?e=no_token"), 1500);
    })();
  }, [router]);

  return (
    <main className="min-h-screen grid place-items-center bg-paper-soft px-6">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 mb-4">
          <span className="w-9 h-9 rounded-full bg-paper-deep grid place-items-center text-gold-deep">✦</span>
        </div>
        <p className="text-ink-mute text-sm">{status}</p>
      </div>
    </main>
  );
}
