"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdminRole } from "@/lib/auth";

const NAV = [
  { href: "/",              label: "Dashboard",     needs: null as AdminRole | null },
  { href: "/customers",     label: "Customers",     needs: null },
  { href: "/subscriptions", label: "Subscriptions", needs: null },
  { href: "/messages",      label: "Messages",      needs: null },
  { href: "/operations",    label: "Operations",    needs: null },
  { href: "/audit-logs",    label: "Audit logs",    needs: null },
  { href: "/settings",      label: "Settings",      needs: "super_admin" as AdminRole },
];

export function MobileNavToggle({ role }: { role: AdminRole }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="md:hidden fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full bg-ink text-paper-soft shadow-lg flex items-center justify-center"
        aria-label="Toggle menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {open ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
        </svg>
      </button>

      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-ink/50" onClick={() => setOpen(false)}>
          <div className="absolute bottom-20 right-4 bg-paper rounded-xl shadow-xl p-4 w-56" onClick={e => e.stopPropagation()}>
            <nav>
              <ul className="space-y-1">
                {NAV.filter(n => !n.needs || n.needs === role).map(n => (
                  <li key={n.href}>
                    <Link
                      href={n.href as never}
                      onClick={() => setOpen(false)}
                      className="block rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-paper-soft hover:text-ink transition"
                    >
                      {n.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
