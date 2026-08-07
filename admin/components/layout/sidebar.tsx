import Link from "next/link";
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

export function Sidebar({ role }: { role: AdminRole }) {
  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-ink/8 bg-paper">
      <div className="px-5 py-6">
        <Link href="/" className="inline-flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-paper-deep grid place-items-center text-gold-deep">✦</span>
          <span className="font-serif text-lg">FaithOn</span>
        </Link>
        <div className="mt-1 text-[11px] uppercase tracking-widest text-ink-mute">Admin</div>
      </div>
      <nav className="px-3 flex-1">
        <ul className="space-y-1">
          {NAV.filter(n => !n.needs || n.needs === role).map(n => (
            <li key={n.href}>
              <Link
                href={n.href as never}
                className="block rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-paper-soft hover:text-ink transition"
              >
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="px-5 py-4 border-t border-ink/8 text-[11px] text-ink-mute">
        v0.1 · MVP
      </div>
    </aside>
  );
}
