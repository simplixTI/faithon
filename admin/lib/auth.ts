import { redirect } from "next/navigation";
import { getSupabaseServer } from "./supabase/server";
import { getSupabaseAdmin } from "./supabase/admin";

export type AdminRole = "super_admin" | "support_admin";

export type AdminSession = {
  userId: string;
  email: string;
  role: AdminRole;
  fullName: string | null;
};

/**
 * Gate a Server Component / Route Handler: returns the AdminSession
 * or redirects to /login. Verifies the user is in admin_users AND active.
 *
 * Uses the service-role client to read admin_users (bypasses RLS —
 * avoids chicken-and-egg where the user can't read their own row yet).
 */
export async function requireAdmin(): Promise<AdminSession> {
  const supa = await getSupabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login");

  const admin = getSupabaseAdmin();
  const { data: row, error } = await admin
    .from("admin_users")
    .select("id, email, role, full_name, active")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!row || !row.active) {
    // Signed in but not (yet) provisioned as admin — sign out and bounce.
    await supa.auth.signOut();
    redirect("/login?e=not_admin");
  }

  // Fire-and-forget: touch last_login_at (don't block render).
  admin
    .from("admin_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id)
    .then(() => {});

  return {
    userId: row.id,
    email: row.email,
    role: row.role as AdminRole,
    fullName: row.full_name,
  };
}

export async function requireSuperAdmin(): Promise<AdminSession> {
  const s = await requireAdmin();
  if (s.role !== "super_admin") {
    redirect("/?e=forbidden");
  }
  return s;
}
