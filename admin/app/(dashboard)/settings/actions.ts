"use server";
import { requireSuperAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { invalidateSettingsCache } from "@/lib/settings";
import { revalidatePath } from "next/cache";

export async function updateSetting(key: string, value: unknown) {
  const s = await requireSuperAdmin();
  const admin = getSupabaseAdmin();

  const { data: before } = await admin
    .from("app_settings").select("value").eq("key", key).maybeSingle();

  const { error } = await admin
    .from("app_settings")
    .update({ value, updated_by: s.userId, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (error) throw error;

  await admin.from("admin_audit_logs").insert({
    admin_id: s.userId, admin_email: s.email,
    action: "settings.update",
    target_type: "setting", target_id: key,
    metadata: { before: before?.value, after: value },
  });
  invalidateSettingsCache();
  revalidatePath("/settings");
}
