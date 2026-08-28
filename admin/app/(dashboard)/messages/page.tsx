import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { maskPhone, num, relTime } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

const PROVIDERS = [
  { value: "", label: "All" },
  { value: "smsgate", label: "SMS" },
  { value: "uzapi", label: "WhatsApp" },
];

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>;
}) {
  const sp = await searchParams;
  const provider = sp.provider ?? "";

  const admin = getSupabaseAdmin();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const start24h = new Date(Date.now() - 24 * 3600 * 1000);

  function baseQuery() {
    let q = admin.from("sms_messages").select("id", { count: "exact", head: true });
    if (provider) q = q.eq("provider", provider);
    return q;
  }

  const [
    inTotal, outTotal,
    inToday, outToday,
    delivered24h, failed24h,
    stopCount, prayCount,
    smsCount, whatsappCount,
    { data: recent },
  ] = await Promise.all([
    baseQuery().eq("direction", "inbound"),
    baseQuery().eq("direction", "outbound"),
    baseQuery().eq("direction", "inbound").gte("created_at", startOfDay.toISOString()),
    baseQuery().eq("direction", "outbound").gte("created_at", startOfDay.toISOString()),
    baseQuery().eq("status", "delivered").gte("created_at", start24h.toISOString()),
    baseQuery().in("status", ["failed","undelivered"]).gte("created_at", start24h.toISOString()),
    baseQuery().eq("command", "STOP"),
    baseQuery().eq("command", "PRAY"),
    admin.from("sms_messages").select("id", { count: "exact", head: true }).eq("provider", "smsgate"),
    admin.from("sms_messages").select("id", { count: "exact", head: true }).eq("provider", "uzapi"),
    (() => {
      let q = admin.from("sms_messages").select("id, direction, command, status, from_e164, to_e164, num_segments, error_code, created_at, user_id, provider")
        .order("created_at", { ascending: false })
        .limit(50);
      if (provider) q = q.eq("provider", provider);
      return q;
    })(),
  ]);

  const delivered = delivered24h.count ?? 0;
  const failed = failed24h.count ?? 0;
  const deliveryRate = delivered + failed > 0 ? (delivered / (delivered + failed)) * 100 : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif">Messages</h1>
        <div className="text-sm text-ink-mute">
          {num(smsCount.count ?? 0)} SMS · {num(whatsappCount.count ?? 0)} WhatsApp
        </div>
      </div>

      <div className="flex gap-2">
        {PROVIDERS.map((p) => (
          <Link
            key={p.value}
            href={p.value ? `/messages?provider=${p.value}` : "/messages"}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              provider === p.value
                ? "bg-ink text-paper-soft"
                : "bg-paper-soft text-ink-mute hover:bg-paper-deep"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

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
            title="No messages yet"
            hint="Send PRAY via SMS or WhatsApp to see traffic here."
          />
        ) : (
          <Table>
            <THead>
              <TH>Time</TH>
              <TH>Channel</TH>
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
                  <TD>
                    <Badge tone={m.provider === "uzapi" ? "gold" : "neutral"}>
                      {m.provider === "uzapi" ? "WhatsApp" : "SMS"}
                    </Badge>
                  </TD>
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
