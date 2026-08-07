"use server";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

async function logAdminAction(opts: {
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  reason?: string | null;
}) {
  const s = await requireAdmin();
  const admin = getSupabaseAdmin();
  await admin.from("admin_audit_logs").insert({
    admin_id: s.userId,
    admin_email: s.email,
    action: opts.action,
    target_type: opts.targetType,
    target_id: opts.targetId,
    metadata: opts.metadata ?? {},
    reason: opts.reason ?? null,
  });
  return s;
}

export async function resetDailyLimit(userId: string) {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);
  await admin
    .from("usage_daily")
    .upsert({ user_id: userId, usage_date: today, message_count: 0, inbound_count: 0, outbound_count: 0 }, { onConflict: "user_id,usage_date" });
  await logAdminAction({ action: "user.reset_daily_limit", targetType: "user", targetId: userId });
  revalidatePath(`/customers/${userId}`);
}

export async function grantTrialDays(userId: string, days: number) {
  await requireAdmin();
  if (days < 1 || days > 30) throw new Error("days must be 1..30");
  const admin = getSupabaseAdmin();

  const { data: user } = await admin.from("users").select("trial_ends_at").eq("id", userId).maybeSingle();
  const base = user?.trial_ends_at && new Date(user.trial_ends_at) > new Date()
    ? new Date(user.trial_ends_at)
    : new Date();
  base.setUTCDate(base.getUTCDate() + days);

  await admin.from("users").update({
    trial_ends_at: base.toISOString(),
    access_status: "trial",
    tier: "plus",
  }).eq("id", userId);

  await logAdminAction({ action: "user.grant_trial", targetType: "user", targetId: userId, metadata: { days } });
  revalidatePath(`/customers/${userId}`);
}

export async function blockUser(userId: string, reason: string) {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  await admin.from("users").update({
    access_status: "blocked",
    blocked_reason: reason || "no reason given",
  }).eq("id", userId);
  await logAdminAction({ action: "user.block", targetType: "user", targetId: userId, reason });
  revalidatePath(`/customers/${userId}`);
}

export async function unblockUser(userId: string) {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  await admin.from("users").update({
    access_status: "free",
    blocked_reason: null,
  }).eq("id", userId);
  await logAdminAction({ action: "user.unblock", targetType: "user", targetId: userId });
  revalidatePath(`/customers/${userId}`);
}

export async function requestDeletion(userId: string, reason: string) {
  const s = await requireSuperAdmin();
  const admin = getSupabaseAdmin();
  const { data: user } = await admin.from("users").select("phone_e164").eq("id", userId).maybeSingle();
  await admin.from("data_deletion_requests").insert({
    user_id: userId,
    phone_e164: user?.phone_e164 ?? null,
    requested_by_admin_id: s.userId,
    requested_by_email: s.email,
    reason,
    status: "requested",
  });
  await logAdminAction({ action: "user.deletion_requested", targetType: "user", targetId: userId, reason });
  revalidatePath(`/customers/${userId}`);
}
