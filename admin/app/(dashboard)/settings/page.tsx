import { requireSuperAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { Card } from "@/components/ui/card";
import { SettingRow } from "./setting-row";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("app_settings")
    .select("key, value, description, category, updated_at")
    .order("category").order("key");

  const grouped = new Map<string, typeof data>();
  for (const row of data ?? []) {
    const list = grouped.get(row.category) ?? [];
    list.push(row);
    grouped.set(row.category, list as any);
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-serif">Settings</h1>
        <p className="text-sm text-ink-mute mt-1">
          Non-secret configuration. All changes are audited. Secrets belong in .env.
        </p>
      </div>

      {[...grouped.entries()].map(([category, rows]) => (
        <section key={category}>
          <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">{category}</h2>
          <Card className="p-0">
            <div className="divide-y divide-ink/5">
              {rows!.map(r => (
                <SettingRow
                  key={r.key}
                  keyName={r.key}
                  value={r.value}
                  description={r.description ?? undefined}
                  updatedAt={r.updated_at}
                />
              ))}
            </div>
          </Card>
        </section>
      ))}
    </div>
  );
}
