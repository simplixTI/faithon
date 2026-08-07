"use client";
import { useState, useTransition } from "react";
import { relTime } from "@/lib/format";
import { updateSetting } from "./actions";

export function SettingRow({
  keyName,
  value,
  description,
  updatedAt,
}: {
  keyName: string;
  value: unknown;
  description?: string;
  updatedAt: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [raw, setRaw] = useState(JSON.stringify(value));
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setErr("Invalid JSON. Wrap strings in double quotes.");
      return;
    }
    start(async () => {
      try {
        await updateSetting(keyName, parsed);
        setEditing(false);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Update failed");
      }
    });
  }

  return (
    <div className="px-5 py-4 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono text-ink-soft">{keyName}</code>
          <span className="text-[10px] text-ink-mute">· updated {relTime(updatedAt)}</span>
        </div>
        {description && <p className="text-xs text-ink-mute mt-1">{description}</p>}
        {editing ? (
          <div className="mt-2 space-y-2">
            <textarea
              value={raw}
              onChange={e => setRaw(e.target.value)}
              rows={raw.length > 60 ? 3 : 1}
              className="w-full font-mono text-xs rounded border border-ink/10 bg-white px-3 py-2"
              disabled={pending}
            />
            {err && <p className="text-xs text-red-700">{err}</p>}
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={pending}
                className="text-xs rounded bg-ink text-paper-soft px-3 py-1 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setEditing(false); setRaw(JSON.stringify(value)); setErr(null); }}
                disabled={pending}
                className="text-xs rounded border border-ink/10 px-3 py-1"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <code className="mt-2 block text-xs font-mono text-ink truncate">
            {JSON.stringify(value)}
          </code>
        )}
      </div>
      {!editing && (
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-ink-mute hover:text-ink shrink-0"
        >
          Edit
        </button>
      )}
    </div>
  );
}
