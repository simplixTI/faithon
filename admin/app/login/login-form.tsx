"use client";
import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const supabase = getSupabaseBrowser();
    // basePath is /admin — Supabase Auth needs the full URL including it.
    const redirectTo = `${window.location.origin}/admin/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-800">
        Sign-in link sent to <b>{email}</b>. Open it on this device.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="text-xs text-ink-mute uppercase tracking-wider">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@faithon.ai"
          className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
          autoComplete="email"
          disabled={busy}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || !email}
        className="w-full rounded-lg bg-ink text-paper-soft px-4 py-3 text-sm font-medium disabled:opacity-50 hover:bg-ink-soft transition"
      >
        {busy ? "Sending…" : "Send sign-in link"}
      </button>
    </form>
  );
}
