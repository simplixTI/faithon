import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { num, relTime } from "@/lib/format";
import { AlertActions } from "./alert-actions";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const admin = getSupabaseAdmin();

  const [
    { data: health },
    { data: alerts },
    { data: workflows },
    { data: recentWebhooks },
    { data: recentSmsWebhooks },
  ] = await Promise.all([
    admin.from("system_health").select("component, status, last_heartbeat_at, details").order("component"),
    admin.from("system_alerts").select("id, severity, code, title, message, status, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(50),
    admin.from("workflow_executions").select("id, workflow_name, execution_id, status, started_at, finished_at, error").order("started_at", { ascending: false }).limit(20),
    admin.from("stripe_webhook_events").select("id, type, received_at, processed_at").order("received_at", { ascending: false }).limit(10),
    admin.from("sms_webhook_events").select("id, type, received_at, processed_at").order("received_at", { ascending: false }).limit(10),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-serif">Operations</h1>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Component health</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {(health ?? []).map(h => (
            <div key={h.component} className="rounded-xl border border-ink/8 bg-white p-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-widest text-ink-mute">{h.component}</div>
              <div className={
                h.status === "ok" ? "text-green-700 text-sm mt-1" :
                h.status === "degraded" ? "text-amber-700 text-sm mt-1" :
                h.status === "down" ? "text-red-700 text-sm mt-1" :
                "text-ink-mute text-sm mt-1"
              }>{h.status}</div>
              <div className="mt-1 text-[10px] text-ink-mute">{h.last_heartbeat_at ? relTime(h.last_heartbeat_at) : "no heartbeat"}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs uppercase tracking-widest text-ink-mute">Open alerts</h2>
          <span className="text-xs text-ink-mute">{num(alerts?.length ?? 0)} open</span>
        </div>
        {alerts && alerts.length > 0 ? (
          <Card className="p-0">
            <ul className="divide-y divide-ink/5">
              {alerts.map(a => (
                <li key={a.id} className="p-5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={a.severity === "critical" ? "red" : a.severity === "warning" ? "amber" : "blue"}>
                        {a.severity}
                      </Badge>
                      <span className="font-medium">{a.title}</span>
                      <span className="text-xs text-ink-mute">· {a.code}</span>
                    </div>
                    <p className="text-sm text-ink-mute mt-1">{a.message}</p>
                    <p className="text-[10px] text-ink-mute mt-1">{relTime(a.created_at)}</p>
                  </div>
                  <AlertActions alertId={a.id} />
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card><p className="text-sm text-ink-mute">No open alerts. All clear.</p></Card>
        )}
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">n8n workflow executions (last 20)</h2>
        {workflows && workflows.length > 0 ? (
          <Table>
            <THead>
              <TH>Workflow</TH>
              <TH>Status</TH>
              <TH>Started</TH>
              <TH>Finished</TH>
              <TH>Error</TH>
            </THead>
            <TBody>
              {workflows.map(w => (
                <TR key={w.id}>
                  <TD className="text-sm">{w.workflow_name}</TD>
                  <TD>
                    <Badge tone={w.status === "success" ? "green" : w.status === "failed" || w.status === "timeout" ? "red" : "amber"}>
                      {w.status}
                    </Badge>
                  </TD>
                  <TD className="text-ink-mute text-xs">{relTime(w.started_at)}</TD>
                  <TD className="text-ink-mute text-xs">{w.finished_at ? relTime(w.finished_at) : "—"}</TD>
                  <TD className="text-red-700 text-xs">{w.error ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Card><p className="text-sm text-ink-mute">No workflow executions recorded. Point n8n to POST /api/n8n/execution.</p></Card>
        )}
      </section>

      <section className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Recent Stripe webhooks</h2>
          <Card className="p-0">
            {recentWebhooks && recentWebhooks.length > 0 ? (
              <ul className="divide-y divide-ink/5 text-sm">
                {recentWebhooks.map(w => (
                  <li key={w.id} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <div className="font-mono text-xs text-ink-mute">{w.id.slice(0, 20)}…</div>
                      <div>{w.type}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-ink-mute">{relTime(w.received_at)}</div>
                      <Badge tone={w.processed_at ? "green" : "amber"}>{w.processed_at ? "processed" : "pending"}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (<p className="p-5 text-sm text-ink-mute">No Stripe webhooks received yet.</p>)}
          </Card>
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Recent Twilio webhooks</h2>
          <Card className="p-0">
            {recentSmsWebhooks && recentSmsWebhooks.length > 0 ? (
              <ul className="divide-y divide-ink/5 text-sm">
                {recentSmsWebhooks.map(w => (
                  <li key={w.id} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <div className="font-mono text-xs text-ink-mute">{w.id.slice(0, 20)}…</div>
                      <div>{w.type}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-ink-mute">{relTime(w.received_at)}</div>
                      <Badge tone={w.processed_at ? "green" : "amber"}>{w.processed_at ? "processed" : "pending"}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (<p className="p-5 text-sm text-ink-mute">No Twilio webhooks received yet.</p>)}
          </Card>
        </div>
      </section>
    </div>
  );
}
