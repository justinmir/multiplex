/**
 * Pre-canned starting points for a project's agent instructions. Shared by the
 * Create/Edit Project dialog and the project Instructions tab so both surfaces
 * offer the same presets. Each preset sets a synthesis *lens* (not a task);
 * clicking one appends it so they can be combined (e.g. PR-focused + standup).
 */
export const AGENT_INSTRUCTION_PRESETS: { label: string; text: string }[] = [
  {
    label: "Shipping / PR-focused",
    text: "Focus on what PRs are in flight for my status — flag anything blocked on review or failing checks.",
  },
  {
    label: "Audience-shaped",
    text: "Write this as a Monday standup update: what moved, what's next, what's blocked.",
  },
  {
    label: "Prioritization style",
    text: "Rank next steps by what unblocks the most other work first.",
  },
];

/** A row of preset chips that append their text into the instructions field. */
export function AgentInstructionPresetChips({
  value,
  onApply,
  disabled,
}: {
  value: string;
  onApply: (next: string) => void;
  disabled?: boolean;
}) {
  const add = (text: string) => {
    const cur = value.trim();
    if (cur.includes(text)) return; // already present — don't duplicate
    onApply(cur ? `${cur}\n${text}` : text);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {AGENT_INSTRUCTION_PRESETS.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => add(p.text)}
          disabled={disabled}
          title={p.text}
          className="rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-border-strong hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
