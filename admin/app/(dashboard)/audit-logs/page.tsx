import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { num, relTime } from "@/lib/format";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; admin?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const admin = getSupabaseAdmin();
  let q = admin
    .from("admin_audit_logs")
    .select("id, admin_email, action, target_type, target_id, reason, metadata, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (sp.action) q = q.eq("action", sp.action);
  if (sp.admin) q = q.ilike("admin_email", `%${sp.admin}%`);

  const { data: rows, count } = await q;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-serif">Audit logs</h1>
        <div className="text-sm text-ink-mute">{num(count ?? 0)} entries</div>
      </div>

      <form className="flex flex-wrap gap-3">
        <input name="action" defaultValue={sp.action ?? ""} placeholder="Action (e.g. user.block)" className="rounded-lg border border-ink/10 bg-white px-4 py-2 text-sm" />
        <input name="admin" defaultValue={sp.admin ?? ""} placeholder="Admin email contains…" className="rounded-lg border border-ink/10 bg-white px-4 py-2 text-sm" />
        <button className="rounded-lg bg-ink text-paper-soft px-4 py-2 text-sm">Filter</button>
      </form>

      {!rows || rows.length === 0 ? (
        <EmptyState
          title="No audit entries yet"
          hint="Every admin action gets logged here — grants, blocks, settings changes, alert acks, etc."
        />
      ) : (
        <Table>
          <THead>
            <TH>Time</TH>
            <TH>Admin</TH>
            <TH>Action</TH>
            <TH>Target</TH>
            <TH>Reason</TH>
          </THead>
          <TBody>
            {rows.map(r => (
              <TR key={r.id}>
                <TD className="text-ink-mute text-xs">{relTime(r.created_at)}</TD>
                <TD className="text-xs">{r.admin_email ?? "system"}</TD>
                <TD className="font-mono text-xs">{r.action}</TD>
                <TD className="font-mono text-xs">{r.target_type ? `${r.target_type}:${r.target_id?.slice(0,8)}…` : "—"}</TD>
                <TD className="text-xs text-ink-mute">{r.reason ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
