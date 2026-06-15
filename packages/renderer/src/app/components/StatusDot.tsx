interface StatusDotProps {
  tone: "success" | "warning" | "info" | "danger" | "muted" | "accent";
  pulse?: boolean;
}

const toneClass: Record<StatusDotProps["tone"], string> = {
  success: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]",
  info: "bg-[var(--info)]",
  danger: "bg-destructive",
  muted: "bg-muted-foreground/50",
  accent: "bg-accent",
};

export function StatusDot({ tone, pulse }: StatusDotProps) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${toneClass[tone]}`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${toneClass[tone]}`} />
    </span>
  );
}
