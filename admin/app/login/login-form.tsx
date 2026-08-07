"use client";
import { useState } from "react";
import { sendBrandedMagicLink } from "./actions";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    // Server action: Supabase generates the link (admin API) and Resend
    // sends the email with our branded template. Supabase SMTP is bypassed.
    const result = await sendBrandedMagicLink(email);
    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.error);
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
