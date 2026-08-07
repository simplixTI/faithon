import { notFound } from "next/navigation";
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { Card, CardSub, CardTitle, CardValue } from "@/components/ui/card";
import { Badge, toneForAccessStatus, toneForSubStatus } from "@/components/ui/badge";
import { dateShort, fullPhone, maskPhone, num, relTime } from "@/lib/format";
import { CustomerActions } from "./customer-actions";

export const dynamic = "force-dynamic";

export default async function CustomerDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAdmin();
  const admin = getSupabaseAdmin();

  const [{ data: user }, { data: entitlement }, { data: subs }, { data: consents },
         { data: recentSms }, { data: recentAdminLog }, { data: usage }] = await Promise.all([
    admin.from("users").select("*").eq("id", id).maybeSingle(),
    admin.from("user_entitlements").select("*").eq("user_id", id).maybeSingle(),
    admin.from("subscriptions").select("*").eq("user_id", id).order("created_at", { ascending: false }),
    admin.from("user_consents").select("*").eq("user_id", id).maybeSingle(),
    admin.from("sms_messages").select("id, direction, command, status, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(10),
    admin.from("admin_audit_logs").select("id, action, admin_email, reason, metadata, created_at").eq("target_type", "user").eq("target_id", id).order("created_at", { ascending: false }).limit(10),
    admin.from("usage_daily").select("*").eq("user_id", id).order("usage_date", { ascending: false }).limit(7),
  ]);

  if (!user) notFound();

  const activeSub = subs?.find(s => ["active", "trialing", "past_due", "grace_period"].includes(s.status)) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customers" className="text-sm text-ink-mute hover:text-ink">← All customers</Link>
        <div className="flex items-baseline justify-between mt-2">
          <h1 className="text-3xl font-serif">{fullPhone(user.phone_e164)}</h1>
          <div className="flex items-center gap-2">
            <Badge tone={user.tier === "plus" ? "gold" : "neutral"}>{user.tier === "plus" ? "Plus" : "Free"}</Badge>
            <Badge tone={toneForAccessStatus(user.access_status)}>{user.access_status}</Badge>
          </div>
        </div>
        <p className="text-sm text-ink-mute mt-1">
          Masked: <span className="font-mono">{maskPhone(user.phone_e164)}</span> · id <span className="font-mono">{user.id.slice(0, 8)}…</span>
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardTitle>Trial ends</CardTitle>
          <CardValue className="text-xl">{user.trial_ends_at ? relTime(user.trial_ends_at) : "—"}</CardValue>
          <CardSub>{user.trial_ends_at ? dateShort(user.trial_ends_at) : "no trial"}</CardSub>
        </Card>
        <Card>
          <CardTitle>Grace ends</CardTitle>
          <CardValue className="text-xl">{user.grace_period_ends_at ? relTime(user.grace_period_ends_at) : "—"}</CardValue>
          <CardSub>{user.grace_period_ends_at ? dateShort(user.grace_period_ends_at) : "not applicable"}</CardSub>
        </Card>
        <Card>
          <CardTitle>Last active</CardTitle>
          <CardValue className="text-xl">{user.last_active_at ? relTime(user.last_active_at) : "—"}</CardValue>
          <CardSub>{user.last_active_at ? dateShort(user.last_active_at) : "never"}</CardSub>
        </Card>
        <Card>
          <CardTitle>Signed up</CardTitle>
          <CardValue className="text-xl">{relTime(user.created_at)}</CardValue>
          <CardSub>{dateShort(user.created_at)} · via {user.source ?? "—"}</CardSub>
        </Card>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <section>
            <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Subscription</h2>
            {activeSub ? (
              <Card>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-xs text-ink-mute">{activeSub.stripe_subscription_id}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge tone={toneForSubStatus(activeSub.status)}>{activeSub.status}</Badge>
                      {activeSub.cancel_at_period_end && <Badge tone="amber">canceling</Badge>}
                    </div>
                  </div>
                  <a
                    href={`https://dashboard.stripe.com/subscriptions/${activeSub.stripe_subscription_id}`}
                    target="_blank" rel="noreferrer"
                    className="text-sm text-gold-deep hover:text-gold"
                  >
                    Open in Stripe ↗
                  </a>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-ink-mute text-xs">Current period</div>
                    <div>{dateShort(activeSub.current_period_start)} → {dateShort(activeSub.current_period_end)}</div>
                  </div>
                  <div>
                    <div className="text-ink-mute text-xs">Price</div>
                    <div className="font-mono text-xs">{activeSub.stripe_price_id}</div>
                  </div>
                </div>
              </Card>
            ) : (
              <Card><p className="text-sm text-ink-mute">No active subscription.</p></Card>
            )}
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Recent SMS (last 10)</h2>
            <Card className="p-0">
              {recentSms && recentSms.length > 0 ? (
                <ul className="divide-y divide-ink/5">
                  {recentSms.map(m => (
                    <li key={m.id} className="px-5 py-3 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3">
                        <Badge tone={m.direction === "inbound" ? "blue" : "neutral"}>{m.direction}</Badge>
                        {m.command && <span className="font-mono text-xs">{m.command}</span>}
                        <span className="text-ink-mute">{m.status ?? "—"}</span>
                      </div>
                      <span className="text-ink-mute text-xs">{relTime(m.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-6 text-sm text-ink-mute">No SMS yet.</p>
              )}
            </Card>
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Usage (last 7 days)</h2>
            <Card>
              <div className="grid grid-cols-7 gap-2">
                {(usage ?? []).slice().reverse().map(d => (
                  <div key={d.usage_date} className="text-center">
                    <div className="text-[10px] text-ink-mute">{new Date(d.usage_date).toLocaleDateString("en", { weekday: "short" })}</div>
                    <div className="text-xl font-serif mt-1">{d.message_count}</div>
                  </div>
                ))}
                {(usage ?? []).length === 0 && (
                  <p className="col-span-7 text-sm text-ink-mute">No usage recorded yet.</p>
                )}
              </div>
            </Card>
          </section>
        </div>

        <div className="space-y-6">
          <CustomerActions userId={id} role={session.role} isBlocked={user.access_status === "blocked"} />

          <section>
            <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Consents</h2>
            <Card className="text-sm space-y-2">
              <Row label="Opt-in"           value={consents?.opt_in ? `${dateShort(consents.opt_in_at)} · ${consents.opt_in_source ?? "—"}` : "not opted-in"} />
              <Row label="Opt-out (STOP)"    value={consents?.opt_out ? `${dateShort(consents.opt_out_at)} · ${consents.opt_out_reason ?? ""}` : "no"} />
              <Row label="Marketing"         value={consents?.consent_marketing ? "yes" : "no"} />
              <Row label="Pastoral"          value={consents?.consent_pastoral ? "yes" : "no"} />
            </Card>
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Admin history</h2>
            <Card className="p-0">
              {recentAdminLog && recentAdminLog.length > 0 ? (
                <ul className="divide-y divide-ink/5 text-sm">
                  {recentAdminLog.map(l => (
                    <li key={l.id} className="px-5 py-3">
                      <div className="font-medium">{l.action}</div>
                      <div className="text-xs text-ink-mute">
                        {l.admin_email} · {relTime(l.created_at)}
                      </div>
                      {l.reason && <div className="text-xs text-ink-mute mt-1">"{l.reason}"</div>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-5 text-sm text-ink-mute">No admin actions on this user yet.</p>
              )}
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-ink-mute text-xs uppercase tracking-wider">{label}</span>
      <span>{value}</span>
    </div>
  );
}
