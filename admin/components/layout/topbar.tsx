"use client";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { AdminSession } from "@/lib/auth";
import { useRouter } from "next/navigation";

export function Topbar({ session }: { session: AdminSession }) {
  const router = useRouter();
  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <header className="h-14 border-b border-ink/8 bg-paper-soft/80 backdrop-blur flex items-center justify-end px-6">
      <button
        onClick={signOut}
        className="text-sm text-ink-mute hover:text-ink transition"
      >
        Sign out
      </button>
    </header>
  );
}
