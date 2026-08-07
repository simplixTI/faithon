import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { maskPhone, num, relTime } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const admin = getSupabaseAdmin();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const start24h = new Date(Date.now() - 24 * 3600 * 1000);

  const [
    inTotal, outTotal,
    inToday, outToday,
    delivered24h, failed24h,
    stopCount, prayCount,
    { data: recent },
  ] = await Promise.all([
    admin.from("sms_messages").select("id", { count: "exact", head: true }).eq("direction", "inbound"),
    admin.from("sms_messages").select("id", { count: "exact", head: true }).eq("direction", "outbound"),
    admin.from("sms_messages").select("id", { count: "exact", head: true }).eq("direction", "inbound").gte("created_at", startOfDay.toISOString()),
    admin.from("sms_messages").select("id", { count: "exact", head: true }).eq("direction", "outbound").gte("created_at", startOfDay.toISOString()),
    admin.from("sms_messages").select("id", { count: "exact", head: true }).eq("status", "delivered").gte("created_at", start24h.toISOString()),
    admin.from("sms_messages").select("id", { count: "exact", head: true }).in("status", ["failed","undelivered"]).gte("created_at", start24h.toISOString()),
    admin.from("sms_messages").select("id", { count: "exact", head: true }).eq("command", "STOP"),
    admin.from("sms_messages").select("id", { count: "exact", head: true }).eq("command", "PRAY"),
    admin.from("sms_messages").select("id, direction, command, status, from_e164, to_e164, num_segments, error_code, created_at, user_id")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const delivered = delivered24h.count ?? 0;
  const failed = failed24h.count ?? 0;
  const deliveryRate = delivered + failed > 0 ? (delivered / (delivered + failed)) * 100 : null;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-serif">Messages</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Inbound (total)"  value={num(inTotal.count ?? 0)}   sub={`${num(inToday.count ?? 0)} today`} />
        <MetricCard label="Outbound (total)" value={num(outTotal.count ?? 0)}  sub={`${num(outToday.count ?? 0)} today`} />
        <MetricCard label="Delivery rate (24h)"
          value={deliveryRate == null ? "—" : `${deliveryRate.toFixed(1)}%`}
          sub={`${num(delivered)} ok · ${num(failed)} failed`} />
        <MetricCard label="Commands"
          value={num((prayCount.count ?? 0) + (stopCount.count ?? 0))}
          sub={`${num(prayCount.count ?? 0)} PRAY · ${num(stopCount.count ?? 0)} STOP`} />
      </div>

      <div>
        <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Latest 50 messages</h2>
        {!recent || recent.length === 0 ? (
          <EmptyState
            title="No SMS traffic yet"
            hint="Enable Twilio and point the inbound webhook at /api/twilio/inbound to see traffic here."
          />
        ) : (
          <Table>
            <THead>
              <TH>Time</TH>
              <TH>Dir</TH>
              <TH>Cmd</TH>
              <TH>From → To</TH>
              <TH>Status</TH>
              <TH>Seg</TH>
              <TH></TH>
            </THead>
            <TBody>
              {recent.map(m => (
                <TR key={m.id}>
                  <TD className="text-ink-mute text-xs">{relTime(m.created_at)}</TD>
                  <TD><Badge tone={m.direction === "inbound" ? "blue" : "neutral"}>{m.direction}</Badge></TD>
                  <TD className="font-mono text-xs">{m.command ?? "—"}</TD>
                  <TD className="font-mono text-xs">
                    {maskPhone(m.from_e164)} → {maskPhone(m.to_e164)}
                  </TD>
                  <TD>
                    <span className={
                      m.status === "delivered" ? "text-green-700 text-xs" :
                      m.status === "failed" || m.status === "undelivered" ? "text-red-700 text-xs" :
                      "text-ink-mute text-xs"
                    }>{m.status ?? "—"}{m.error_code ? ` (${m.error_code})` : ""}</span>
                  </TD>
                  <TD className="text-xs">{m.num_segments ?? "—"}</TD>
                  <TD>{m.user_id && <Link className="text-gold-deep text-sm hover:text-gold" href={`/customers/${m.user_id}` as never}>Customer →</Link>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}
