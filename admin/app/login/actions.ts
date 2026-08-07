"use server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { magicLinkEmail } from "@/lib/email-template";

/**
 * Sends a magic link email via Resend, using Supabase Admin API to
 * generate the signed link (so Supabase's own SMTP is never used).
 * This gives us full control over the branded template.
 */
export async function sendBrandedMagicLink(rawEmail: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Please enter a valid email." };
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { ok: false, error: "RESEND_API_KEY not configured on server." };
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: "https://www.faithon.ai/admin/auth/callback",
    },
  });

  if (error) return { ok: false, error: error.message };
  const actionUrl = data?.properties?.action_link;
  if (!actionUrl) return { ok: false, error: "No action_link returned from Supabase." };

  const { html, text } = magicLinkEmail(actionUrl);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "FaithOn Admin <noreply@faithon.ai>",
      to: [email],
      subject: "Your FaithOn Admin sign-in link",
      html,
      text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `Resend send failed (${res.status}): ${detail.slice(0, 200)}` };
  }
  return { ok: true };
}
