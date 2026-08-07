import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * Supabase Auth PKCE callback: exchanges the ?code param for a session,
 * writes cookies, then redirects to the intended destination.
 *
 * Because this app runs behind a rewrite (faithon.ai/admin →
 * faithon-admin-simplix.vercel.app/admin), we can't trust
 * request.url's host — it's the internal Vercel URL. Use the
 * x-forwarded-host header (set by the parent Vercel project's
 * rewrite) to reconstruct the public URL, and always include the
 * /admin basePath since NextResponse.redirect() doesn't prefix it.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin: internalOrigin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const publicOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : internalOrigin;
  const bp = "/admin"; // matches next.config.mjs basePath

  const loginErrUrl = `${publicOrigin}${bp}/login?e=code_exchange_failed`;

  if (!code) return NextResponse.redirect(loginErrUrl);

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(loginErrUrl);

  return NextResponse.redirect(`${publicOrigin}${bp}${next}`);
}
