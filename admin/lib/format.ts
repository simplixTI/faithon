export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  // +15551234567 → +1 (555) ***-4567
  const m = e164.match(/^(\+\d)(\d{3})(\d{3})(\d{4})$/);
  if (!m) return e164.replace(/\d(?=\d{4})/g, "•");
  return `${m[1]} (${m[2]}) •••-${m[4]}`;
}

export function fullPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const m = e164.match(/^(\+\d)(\d{3})(\d{3})(\d{4})$/);
  return m ? `${m[1]} (${m[2]}) ${m[3]}-${m[4]}` : e164;
}

export function usd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
  }).format(cents / 100);
}

export function usdFromDollars(dollars: number | null | undefined): string {
  if (dollars == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
  }).format(dollars);
}

export function num(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return `${n.toFixed(digits)}%`;
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.round((then - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60)          return rtf.format(diff, "second");
  if (abs < 3600)        return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400)       return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30)  return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}
