import { cn } from "@/lib/cn";

type Tone = "neutral" | "gold" | "green" | "amber" | "red" | "blue";

const tones: Record<Tone, string> = {
  neutral: "bg-paper-deep text-ink-soft",
  gold:    "bg-gold/15 text-gold-deep",
  green:   "bg-green-100 text-green-800",
  amber:   "bg-amber-100 text-amber-900",
  red:     "bg-red-100 text-red-800",
  blue:    "bg-blue-100 text-blue-800",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
      tones[tone],
      className,
    )}>
      {children}
    </span>
  );
}

/** Map access_status to a badge tone. */
export function toneForAccessStatus(status: string | null | undefined): Tone {
  switch (status) {
    case "active":         return "green";
    case "trial":          return "blue";
    case "past_due":       return "amber";
    case "grace_period":   return "amber";
    case "free":           return "neutral";
    case "blocked":        return "red";
    case "opted_out":      return "red";
    case "deleted":        return "red";
    default:               return "neutral";
  }
}

/** Map subscription status to a badge tone. */
export function toneForSubStatus(status: string | null | undefined): Tone {
  switch (status) {
    case "active":              return "green";
    case "trialing":            return "blue";
    case "past_due":            return "amber";
    case "unpaid":              return "red";
    case "canceled":            return "neutral";
    case "incomplete":          return "amber";
    case "incomplete_expired":  return "red";
    case "paused":              return "neutral";
    default:                    return "neutral";
  }
}
