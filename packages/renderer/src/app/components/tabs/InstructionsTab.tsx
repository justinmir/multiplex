import { useEffect, useState } from "react";
import { Sparkles, Target } from "lucide-react";
import type { Project } from "@app/core";
import { useDataMutations } from "../../../lib/data/DataProvider.js";
import { AgentInstructionPresetChips } from "../agentInstructionPresets";

interface Props {
  project: Project;
}

/**
 * Project-level steering for the intelligence layer. Saved on the project and
 * folded into synthesis (summary, next steps, suggested prompts) so the user
 * can shape their status — e.g. "Focus on what PRs are in flight."
 */
export function InstructionsTab({ project }: Props) {
  const mutations = useDataMutations();
  const [draft, setDraft] = useState(project.agentInstructions ?? "");
  const [saving, setSaving] = useState(false);

  // Re-seed the draft if the project (or its stored instructions) changes.
  useEffect(() => {
    setDraft(project.agentInstructions ?? "");
  }, [project.id, project.agentInstructions]);

  const dirty = draft.trim() !== (project.agentInstructions ?? "").trim();

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await mutations.upsertProject({ ...project, agentInstructions: draft.trim() || undefined });
    } catch (err) {
      console.error("Failed to save agent instructions:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-foreground">
          <Target className="h-4 w-4 text-muted-foreground" /> Agent instructions
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Steer how the agent synthesizes this project. These instructions shape the summary,
          the suggested next steps, and the session prompts — for example,
          <span className="text-foreground"> “Focus on what PRs are in flight for my status.”</span>
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">Start from a preset</span>
        <AgentInstructionPresetChips value={draft} onApply={setDraft} />
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Tell the agent what to emphasize when summarizing this project…"
        className="min-h-[40vh] w-full resize-none rounded-md border border-border bg-card/40 p-4 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save instructions"}
        </button>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Re-synthesize from the Overview tab to apply.
        </span>
      </div>
    </div>
  );
}
