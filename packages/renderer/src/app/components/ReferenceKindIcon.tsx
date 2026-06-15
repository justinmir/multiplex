import { FileText, GitPullRequest, Link as LinkIcon, Users, CheckSquare, CircleDot } from "lucide-react";
import { ReferenceKind } from "../data/mockData";

const meta: Record<ReferenceKind, { Icon: any; tone: string; label: string }> = {
  pr:      { Icon: GitPullRequest, tone: "text-[var(--info)] bg-[var(--info)]/10",       label: "PR" },
  doc:     { Icon: FileText,       tone: "text-accent bg-accent/10",                      label: "Doc" },
  link:    { Icon: LinkIcon,       tone: "text-muted-foreground bg-secondary",            label: "Link" },
  meeting: { Icon: Users,          tone: "text-[var(--chart-4)] bg-[var(--chart-4)]/10",  label: "Meeting" },
  todo:    { Icon: CheckSquare,    tone: "text-[var(--warning)] bg-[var(--warning)]/10",  label: "TODO" },
  issue:   { Icon: CircleDot,      tone: "text-[var(--success)] bg-[var(--success)]/10",  label: "Issue" },
};

export function ReferenceKindIcon({ kind }: { kind: ReferenceKind }) {
  const m = meta[kind];
  const Icon = m.Icon;
  return (
    <span className={`flex h-5 w-5 items-center justify-center rounded-md ${m.tone}`}>
      <Icon className="h-3 w-3" />
    </span>
  );
}

export function referenceKindLabel(kind: ReferenceKind): string {
  return meta[kind].label;
}
