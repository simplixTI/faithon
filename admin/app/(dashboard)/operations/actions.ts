"use server";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function acknowledgeAlert(id: number) {
  const s = await requireAdmin();
  const admin = getSupabaseAdmin();
  await admin.from("system_alerts").update({
    status: "acknowledged",
    acknowledged_at: new Date().toISOString(),
    acknowledged_by: s.userId,
  }).eq("id", id).eq("status", "open");
  await admin.from("admin_audit_logs").insert({
    admin_id: s.userId, admin_email: s.email,
    action: "alert.acknowledge", target_type: "alert", target_id: String(id),
  });
  revalidatePath("/operations");
}

export async function resolveAlert(id: number) {
  const s = await requireAdmin();
  const admin = getSupabaseAdmin();
  await admin.from("system_alerts").update({
    status: "resolved",
    resolved_at: new Date().toISOString(),
    resolved_by: s.userId,
  }).eq("id", id);
  await admin.from("admin_audit_logs").insert({
    admin_id: s.userId, admin_email: s.email,
    action: "alert.resolve", target_type: "alert", target_id: String(id),
  });
  revalidatePath("/operations");
}
