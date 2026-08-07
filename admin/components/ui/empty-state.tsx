export function EmptyState({
  title,
  hint,
  icon = "✦",
}: {
  title: string;
  hint?: string;
  icon?: string;
}) {
  return (
    <div className="py-16 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-paper-deep grid place-items-center text-gold-deep text-xl">
        {icon}
      </div>
      <h3 className="mt-4 font-serif text-lg">{title}</h3>
      {hint && <p className="mt-1 text-sm text-ink-mute max-w-md mx-auto">{hint}</p>}
    </div>
  );
}
