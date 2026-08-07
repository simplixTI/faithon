import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge, toneForSubStatus } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/dashboard/metric-card";
import { dateShort, maskPhone, num, usdFromDollars } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const admin = getSupabaseAdmin();
  const [{ data: counts }, { data: mrr }] = await Promise.all([
    admin.from("v_subscription_counts").select("*").maybeSingle(),
    admin.from("v_mrr").select("*").maybeSingle(),
  ]);

  let q = admin
    .from("subscriptions")
    .select("id, stripe_subscription_id, status, current_period_start, current_period_end, cancel_at_period_end, user_id, users(phone_e164)", { count: "exact" })
    .order("current_period_end", { ascending: false })
    .range(from, to);
  if (sp.status) q = q.eq("status", sp.status);

  const { data: rows, count } = await q;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const c = counts ?? {};

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-serif">Subscriptions</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="MRR (est.)"   value={usdFromDollars(mrr?.mrr_usd)} sub={`${num(mrr?.billed_subs)} billed`} />
        <MetricCard label="Active"       value={num(c.active)}   sub={`${num(c.trialing)} trialing`} />
        <MetricCard label="Past due"     value={num(c.past_due)} sub={`${num(c.unpaid)} unpaid`} />
        <MetricCard label="Canceled"     value={num(c.canceled)} sub={`${num(c.canceling)} canceling`} />
      </div>

      <form className="flex gap-3">
        <select name="status" defaultValue={sp.status ?? ""} className="rounded-lg border border-ink/10 bg-white px-4 py-2 text-sm">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="past_due">Past due</option>
          <option value="unpaid">Unpaid</option>
          <option value="canceled">Canceled</option>
          <option value="incomplete">Incomplete</option>
          <option value="incomplete_expired">Incomplete expired</option>
          <option value="paused">Paused</option>
        </select>
        <button className="rounded-lg bg-ink text-paper-soft px-4 py-2 text-sm">Filter</button>
      </form>

      {!rows || rows.length === 0 ? (
        <EmptyState
          title="No subscriptions yet"
          hint="Subscriptions land here as Stripe processes checkouts."
        />
      ) : (
        <Table>
          <THead>
            <TH>Phone</TH>
            <TH>Status</TH>
            <TH>Period</TH>
            <TH>Stripe ID</TH>
            <TH></TH>
          </THead>
          <TBody>
            {rows.map(r => (
              <TR key={r.id}>
                <TD className="font-mono text-xs">
                  <Link href={`/customers/${r.user_id}` as never} className="hover:text-ink">
                    {maskPhone((r as any).users?.phone_e164)}
                  </Link>
                </TD>
                <TD>
                  <Badge tone={toneForSubStatus(r.status)}>{r.status}</Badge>
                  {r.cancel_at_period_end && <Badge tone="amber" className="ml-2">canceling</Badge>}
                </TD>
                <TD className="text-ink-mute text-xs">
                  {dateShort(r.current_period_start)} → {dateShort(r.current_period_end)}
                </TD>
                <TD className="font-mono text-xs">
                  <a href={`https://dashboard.stripe.com/subscriptions/${r.stripe_subscription_id}`} target="_blank" rel="noreferrer" className="text-gold-deep hover:text-gold">
                    {r.stripe_subscription_id.slice(0, 20)}… ↗
                  </a>
                </TD>
                <TD className="text-right">
                  <Link href={`/customers/${r.user_id}` as never} className="text-gold-deep hover:text-gold text-sm">Open →</Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
