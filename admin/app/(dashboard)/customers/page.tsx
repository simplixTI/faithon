import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge, toneForAccessStatus } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { dateShort, maskPhone, num, relTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; plan?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const admin = getSupabaseAdmin();
  let q = admin
    .from("users")
    .select("id, phone_e164, tier, access_status, trial_ends_at, created_at, last_active_at, stripe_customer_id", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (sp.q) {
    const digits = sp.q.replace(/\D/g, "");
    if (digits) q = q.like("phone_e164", `%${digits}%`);
  }
  if (sp.plan === "free" || sp.plan === "plus") q = q.eq("tier", sp.plan);
  if (sp.status) q = q.eq("access_status", sp.status);

  const { data: rows, count, error } = await q;

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-serif">Customers</h1>
        <div className="text-sm text-ink-mute">{num(count ?? 0)} total</div>
      </div>

      <form className="flex flex-wrap gap-3">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search phone…"
          className="rounded-lg border border-ink/10 bg-white px-4 py-2 text-sm min-w-[200px]"
        />
        <select
          name="plan"
          defaultValue={sp.plan ?? ""}
          className="rounded-lg border border-ink/10 bg-white px-4 py-2 text-sm"
        >
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="plus">Plus</option>
        </select>
        <select
          name="status"
          defaultValue={sp.status ?? ""}
          className="rounded-lg border border-ink/10 bg-white px-4 py-2 text-sm"
        >
          <option value="">Any status</option>
          <option value="trial">Trial</option>
          <option value="active">Active</option>
          <option value="free">Free</option>
          <option value="past_due">Past due</option>
          <option value="grace_period">Grace period</option>
          <option value="blocked">Blocked</option>
          <option value="opted_out">Opted out</option>
        </select>
        <button className="rounded-lg bg-ink text-paper-soft px-4 py-2 text-sm">Filter</button>
        <a href="/customers/export" className="rounded-lg border border-ink/10 px-4 py-2 text-sm hover:bg-paper-deep transition">
          Export CSV
        </a>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error.message}
        </div>
      )}

      {!rows || rows.length === 0 ? (
        <EmptyState
          title="No customers yet"
          hint={sp.q || sp.plan || sp.status
            ? "No results match those filters. Try clearing them."
            : "Users appear here as soon as they send their first PRAY SMS."}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TH>Phone</TH>
              <TH>Plan</TH>
              <TH>Status</TH>
              <TH>Trial ends</TH>
              <TH>Last seen</TH>
              <TH>Created</TH>
              <TH></TH>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="font-mono text-xs">{maskPhone(r.phone_e164)}</TD>
                  <TD>
                    <Badge tone={r.tier === "plus" ? "gold" : "neutral"}>
                      {r.tier === "plus" ? "Plus" : "Free"}
                    </Badge>
                  </TD>
                  <TD>
                    <Badge tone={toneForAccessStatus(r.access_status)}>
                      {r.access_status ?? "—"}
                    </Badge>
                  </TD>
                  <TD className="text-ink-mute">{r.trial_ends_at ? relTime(r.trial_ends_at) : "—"}</TD>
                  <TD className="text-ink-mute">{r.last_active_at ? relTime(r.last_active_at) : "—"}</TD>
                  <TD className="text-ink-mute">{dateShort(r.created_at)}</TD>
                  <TD className="text-right">
                    <Link href={`/customers/${r.id}` as never} className="text-gold-deep hover:text-gold text-sm">
                      Open →
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <Pagination page={page} totalPages={totalPages} sp={sp} />
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  sp,
}: {
  page: number;
  totalPages: number;
  sp: Record<string, string | undefined>;
}) {
  function href(p: number) {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (sp.plan) params.set("plan", sp.plan);
    if (sp.status) params.set("status", sp.status);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/customers?${s}` : "/customers";
  }
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <a
        aria-disabled={page <= 1}
        href={page > 1 ? href(page - 1) : undefined}
        className={page > 1 ? "text-ink-soft hover:text-ink" : "text-ink-mute/50 pointer-events-none"}
      >
        ← Previous
      </a>
      <span className="text-ink-mute">Page {page} of {totalPages}</span>
      <a
        aria-disabled={page >= totalPages}
        href={page < totalPages ? href(page + 1) : undefined}
        className={page < totalPages ? "text-ink-soft hover:text-ink" : "text-ink-mute/50 pointer-events-none"}
      >
        Next →
      </a>
    </div>
  );
}
