import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
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
        <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Acquisition (last 14 days)</h2>
        <AcquisitionBlock />
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">System health</h2>
        <HealthGrid />
      </section>
    </div>
  );
}

// Launch cutoff: pre-launch data is test noise, ignore it in acquisition totals.
const LAUNCH_DATE = new Date("2026-08-20T00:00:00");

async function AcquisitionBlock() {
  const admin = getSupabaseAdmin();
  const days = 14;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));
  const tableSince = since < LAUNCH_DATE ? LAUNCH_DATE : since;

  const [{ data: windowData }, { data: launchData }] = await Promise.all([
    admin
      .from("users")
      .select("created_at, source")
      .is("deleted_at", null)
      .gte("created_at", tableSince.toISOString())
      .order("created_at", { ascending: false }),
    admin
      .from("users")
      .select("created_at, source")
      .is("deleted_at", null)
      .gte("created_at", LAUNCH_DATE.toISOString()),
  ]);

  // Bucket per local day (only from launch onward)
  const buckets = new Map<string, { total: number; pray: number; other: number; bySource: Record<string, number> }>();
  const startDate = new Date(tableSince);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
    buckets.set(dayKey(d), { total: 0, pray: 0, other: 0, bySource: {} });
  }
  for (const u of windowData ?? []) {
    const key = dayKey(new Date(u.created_at));
    const b = buckets.get(key);
    if (!b) continue;
    b.total += 1;
    const src = (u.source ?? "").toString();
    if (src.endsWith(":pray")) b.pray += 1;
    else b.other += 1;
    b.bySource[src || "(none)"] = (b.bySource[src || "(none)"] ?? 0) + 1;
  }

  const rows = Array.from(buckets.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, v]) => ({ day, ...v }));

  const totalWindow = rows.reduce((s, r) => s + r.total, 0);
  const prayWindow = rows.reduce((s, r) => s + r.pray, 0);
  const total7 = rows.slice(0, 7).reduce((s, r) => s + r.total, 0);
  const todayRow = rows[0];
  const totalSinceLaunch = (launchData ?? []).length;
  const praySinceLaunch = (launchData ?? []).filter((u) => (u.source ?? "").toString().endsWith(":pray")).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="New users today"        value={num(todayRow?.total ?? 0)} sub={`${num(todayRow?.pray ?? 0)} via PRAY`} />
        <MetricCard label="Last 7 days"             value={num(total7)} />
        <MetricCard label="Window (14d clean)"      value={num(totalWindow)} sub={`${num(prayWindow)} via PRAY`} />
        <MetricCard label="Since launch (08/20)"    value={num(totalSinceLaunch)} sub={`${num(praySinceLaunch)} via PRAY`} />
      </div>

      <Table>
        <THead>
          <TH>Day</TH>
          <TH className="text-right">New users</TH>
          <TH className="text-right">via PRAY (CTA)</TH>
          <TH className="text-right">Other</TH>
          <TH>Breakdown by source</TH>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.day}>
              <TD className="font-mono text-xs">{r.day}</TD>
              <TD className="text-right font-medium">{num(r.total)}</TD>
              <TD className="text-right">{num(r.pray)}</TD>
              <TD className="text-right text-ink-mute">{num(r.other)}</TD>
              <TD className="text-xs text-ink-mute">
                {Object.entries(r.bySource).length === 0
                  ? "—"
                  : Object.entries(r.bySource)
                      .sort((a, b) => b[1] - a[1])
                      .map(([s, n]) => `${s}:${n}`)
                      .join("  ·  ")}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function dayKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
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
