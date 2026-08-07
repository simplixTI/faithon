import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { MetricCard } from "@/components/dashboard/metric-card";
import { num, usdFromDollars } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const admin = getSupabaseAdmin();

  const [
    userCounts,
    subCounts,
    mrr,
    msgToday,
    smsToday,
    aiToday,
    openAlerts,
  ] = await Promise.all([
    admin.from("v_user_counts").select("*").maybeSingle(),
    admin.from("v_subscription_counts").select("*").maybeSingle(),
    admin.from("v_mrr").select("*").maybeSingle(),
    admin.from("messages").select("id", { count: "exact", head: true })
      .gte("created_at", new Date(new Date().setHours(0,0,0,0)).toISOString()),
    admin.from("sms_messages").select("id", { count: "exact", head: true })
      .gte("created_at", new Date(new Date().setHours(0,0,0,0)).toISOString()),
    admin.from("ai_usage_events")
      .select("estimated_cost_cents.sum(), tokens_input.sum(), tokens_output.sum()")
      .gte("created_at", new Date(new Date().setHours(0,0,0,0)).toISOString())
      .maybeSingle(),
    admin.from("system_alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  const u = userCounts.data ?? {};
  const s = subCounts.data ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-serif">Dashboard</h1>
        <span className="text-xs text-ink-mute">Live · service_role</span>
      </div>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Users</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total users"        value={num(u.total_users)}    sub={`${num(u.new_today)} new today`} />
          <MetricCard label="Active (24h)"       value={num(u.active_24h)}     sub={`${num(u.active_7d)} in 7d`} />
          <MetricCard label="Plus subscribers"   value={num(u.plus_users)}     sub={`${num(u.trial_users)} on trial`} />
          <MetricCard label="Blocked / opted-out" value={num((u.blocked_users || 0) + (u.opted_out_users || 0))} sub={`${num(u.blocked_users)} blocked · ${num(u.opted_out_users)} STOP`} />
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Revenue</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="MRR (est.)"         value={usdFromDollars(mrr.data?.mrr_usd)} sub={`${num(mrr.data?.billed_subs)} billed subs`} />
          <MetricCard label="Active subs"        value={num(s.active)}          sub={`${num(s.trialing)} trialing`} />
          <MetricCard label="Past-due / unpaid"  value={num((s.past_due || 0) + (s.unpaid || 0))} sub={`${num(s.past_due)} past_due · ${num(s.unpaid)} unpaid`} />
          <MetricCard label="Canceling"          value={num(s.canceling)}       sub={`${num(s.canceled)} canceled total`} />
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Today</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Messages (chat)"    value={num(msgToday.count ?? 0)} />
          <MetricCard label="SMS in/out"         value={num(smsToday.count ?? 0)} />
          <MetricCard
            label="OpenAI tokens"
            value={num(((aiToday.data as any)?.sum ?? 0))}
            sub={`~ ${usdFromDollars((((aiToday.data as any)?.sum_1 ?? 0)) / 100)}`}
          />
          <MetricCard label="Open alerts"        value={num(openAlerts.count ?? 0)} />
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">System health</h2>
        <HealthGrid />
      </section>
    </div>
  );
}

async function HealthGrid() {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("system_health")
    .select("component, status, last_heartbeat_at, details")
    .order("component");
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      {(data ?? []).map((h) => (
        <div
          key={h.component}
          className="rounded-xl border border-ink/8 bg-white p-3 shadow-sm"
        >
          <div className="text-[11px] uppercase tracking-widest text-ink-mute">{h.component}</div>
          <div className={
            h.status === "ok" ? "text-green-700 text-sm mt-1" :
            h.status === "degraded" ? "text-amber-700 text-sm mt-1" :
            h.status === "down" ? "text-red-700 text-sm mt-1" :
            "text-ink-mute text-sm mt-1"
          }>{h.status}</div>
          <div className="mt-1 text-[10px] text-ink-mute">
            {h.last_heartbeat_at ? new Date(h.last_heartbeat_at).toLocaleTimeString() : "no heartbeat"}
          </div>
        </div>
      ))}
    </div>
  );
}
