"use client";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import type { AdminRole } from "@/lib/auth";
import { blockUser, grantTrialDays, requestDeletion, resetDailyLimit, unblockUser } from "./actions";

export function CustomerActions({
  userId,
  role,
  isBlocked,
}: {
  userId: string;
  role: AdminRole;
  isBlocked: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null); setErr(null);
    start(async () => {
      try { await fn(); setMsg(ok); }
      catch (e) { setErr(e instanceof Error ? e.message : "Action failed"); }
    });
  }

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-mute mb-3">Actions</h2>
      <Card className="space-y-3">
        <ActionButton
          label="Reset today's message counter"
          onClick={() => run(() => resetDailyLimit(userId), "Daily counter reset.")}
          disabled={pending}
        />
        <ActionButton
          label="Grant 3 extra Plus trial days"
          onClick={() => run(() => grantTrialDays(userId, 3), "Trial extended by 3 days.")}
          disabled={pending}
        />
        {isBlocked ? (
          <ActionButton
            label="Unblock user"
            tone="green"
            onClick={() => run(() => unblockUser(userId), "User unblocked.")}
            disabled={pending}
          />
        ) : (
          <BlockButton userId={userId} pending={pending} run={run} />
        )}
        {role === "super_admin" && (
          <DeletionButton userId={userId} pending={pending} run={run} />
        )}

        {msg && <div className="text-xs text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{msg}</div>}
        {err && <div className="text-xs text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
      </Card>
    </section>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  tone = "neutral",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "red" | "green";
}) {
  const cls =
    tone === "red"   ? "border-red-200 text-red-800 hover:bg-red-50" :
    tone === "green" ? "border-green-200 text-green-800 hover:bg-green-50" :
                       "border-ink/10 text-ink-soft hover:bg-paper-deep";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition disabled:opacity-50 ${cls}`}
    >
      {label}
    </button>
  );
}

function BlockButton({ userId, pending, run }: any) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <ActionButton
        label="Block user"
        tone="red"
        onClick={() => setConfirm(true)}
        disabled={pending}
      />
    );
  }
  return (
    <div className="space-y-2">
      <input
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason (required)"
        className="w-full rounded border border-ink/10 px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          disabled={pending || !reason.trim()}
          onClick={() => run(() => blockUser(userId, reason.trim()), "User blocked.")}
          className="flex-1 rounded-lg bg-red-600 text-white px-3 py-2 text-sm disabled:opacity-50"
        >
          Confirm block
        </button>
        <button onClick={() => setConfirm(false)} className="rounded-lg border border-ink/10 px-3 py-2 text-sm">Cancel</button>
      </div>
    </div>
  );
}

function DeletionButton({ userId, pending, run }: any) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <ActionButton
        label="Request account deletion (privacy)"
        tone="red"
        onClick={() => setConfirm(true)}
        disabled={pending}
      />
    );
  }
  return (
    <div className="space-y-2">
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason for the deletion request (audited)"
        rows={2}
        className="w-full rounded border border-ink/10 px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          disabled={pending || !reason.trim()}
          onClick={() => run(() => requestDeletion(userId, reason.trim()), "Deletion request queued.")}
          className="flex-1 rounded-lg bg-red-600 text-white px-3 py-2 text-sm disabled:opacity-50"
        >
          Queue deletion
        </button>
        <button onClick={() => setConfirm(false)} className="rounded-lg border border-ink/10 px-3 py-2 text-sm">Cancel</button>
      </div>
    </div>
  );
}
