import { requireAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * CSV export of customers (all rows). Phone numbers are masked;
 * unmasking would require a Super Admin data-export request.
 */
export async function GET() {
  await requireAdmin();
  const admin = getSupabaseAdmin();

  const { data, error } = await admin
    .from("users")
    .select(
      "id, phone_e164, first_name, tier, access_status, trial_ends_at, created_at, last_active_at, source, stripe_customer_id, user_consents(opt_out, opt_out_at)"
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(10_000);

  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  const header = [
    "id","phone_masked","first_name","tier","access_status","opt_out","opt_out_at",
    "trial_ends_at","created_at","last_active_at","source","stripe_customer_id",
  ];
  const lines: string[] = [header.join(",")];
  for (const r of data ?? []) {
    const maskedPhone = r.phone_e164 ? r.phone_e164.replace(/\d(?=\d{4})/g, "•") : "";
    const consent = (r.user_consents as unknown as { opt_out?: boolean; opt_out_at?: string }[] | undefined)?.[0];
    lines.push([
      r.id,
      maskedPhone,
      r.first_name ?? "",
      r.tier ?? "",
      r.access_status ?? "",
      consent?.opt_out ? "yes" : "no",
      consent?.opt_out_at ?? "",
      r.trial_ends_at ?? "",
      r.created_at ?? "",
      r.last_active_at ?? "",
      r.source ?? "",
      r.stripe_customer_id ?? "",
    ].map(csvEscape).join(","));
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="faithon-customers-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
}

function csvEscape(v: string): string {
  if (v == null) return "";
  const needs = /[",\n]/.test(v);
  return needs ? `"${v.replace(/"/g, '""')}"` : v;
}
