"use client";
import { useTransition } from "react";
import { acknowledgeAlert, resolveAlert } from "./actions";

export function AlertActions({ alertId }: { alertId: number }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2 shrink-0">
      <button
        disabled={pending}
        onClick={() => start(async () => { await acknowledgeAlert(alertId); })}
        className="text-xs rounded border border-ink/10 px-3 py-1 hover:bg-paper-deep disabled:opacity-50"
      >
        Ack
      </button>
      <button
        disabled={pending}
        onClick={() => start(async () => { await resolveAlert(alertId); })}
        className="text-xs rounded bg-ink text-paper-soft px-3 py-1 disabled:opacity-50"
      >
        Resolve
      </button>
    </div>
  );
}
