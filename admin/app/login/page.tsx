import { getSupabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; sent?: string }>;
}) {
  const params = await searchParams;
  const supa = await getSupabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (user) redirect("/");

  const errorMsg =
    params.e === "not_admin" ? "This account isn't provisioned as an admin. Ask a Super Admin to promote it." :
    params.e === "code_exchange_failed" ? "That login link is expired or invalid. Request a new one." :
    null;

  return (
    <main className="min-h-screen grid place-items-center bg-paper-soft px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="w-9 h-9 rounded-full bg-paper-deep grid place-items-center text-gold-deep">✦</span>
          </div>
          <h1 className="text-3xl font-serif font-medium">FaithOn Admin</h1>
          <p className="text-ink-mute text-sm mt-2">Enter your admin email to receive a sign-in link.</p>
        </div>
        {errorMsg && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errorMsg}
          </div>
        )}
        {params.sent && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Check your inbox for the sign-in link.
          </div>
        )}
        <LoginForm />
        <p className="mt-6 text-xs text-ink-mute text-center">
          Protected area. Access is logged and audited.
        </p>
      </div>
    </main>
  );
}
