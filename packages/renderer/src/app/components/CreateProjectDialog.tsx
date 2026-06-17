import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Loader2 } from "lucide-react";
import type { Project, PullRequest, Session, Note, Reference, ActivityItem } from "@app/core";
import { useDataMutations } from "../../lib/data/DataProvider.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new project's id after a successful create, so the caller
   *  can open it immediately. */
  onCreated?: (projectId: string) => void;
  /** When set, the dialog edits this project's name + description instead of
   *  creating a new one. */
  editProject?: Project | null;
}

export function CreateProjectDialog({ open, onOpenChange, onCreated, editProject }: Props) {
  const mutations = useDataMutations();
  const isEditing = !!editProject;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentInstructions, setAgentInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Initialize the form from the project being edited (or blank) when opened.
  useEffect(() => {
    if (open) {
      setName(editProject?.name ?? "");
      setDescription(editProject && editProject.description !== "No description provided." ? editProject.description : "");
      setAgentInstructions(editProject?.agentInstructions ?? "");
    }
  }, [open, editProject]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || submitting) return;

    const now = new Date().toISOString();
    const project: Project = editProject
      ? {
          ...editProject,
          name: name.trim(),
          slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          description: description.trim() || "No description provided.",
          agentInstructions: agentInstructions.trim() || undefined,
        }
      : {
          id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: name.trim(),
          slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          description: description.trim() || "No description provided.",
          agentInstructions: agentInstructions.trim() || undefined,
          repos: [],
          status: "active",
          color: "#6366f1",
          progress: 0,
          openPRs: 0,
          activeSessions: 0,
          lastActivity: now,
          prs: [] as PullRequest[],
          sessions: [] as Session[],
          notes: [] as Note[],
          references: [] as Reference[],
          activity: [] as ActivityItem[],
          summary: "",
          nextSteps: [],
        };

    setSubmitting(true);
    try {
      await mutations.upsertProject(project);
      setName("");
      setDescription("");
      setAgentInstructions("");
      onOpenChange(false);
      if (!isEditing) onCreated?.(project.id);
    } catch (err) {
      console.error("Failed to save project:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && !submitting) {
      setName("");
      setDescription("");
      setAgentInstructions("");
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Project" : "Create Project"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update the project name and description." : "Add a new project to organize sessions and notes."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4 pt-2">
            {/* Name field */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                placeholder="My Project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                disabled={submitting}
              />
            </div>

            {/* Description field */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                placeholder="Brief description of the project…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
                rows={3}
              />
            </div>

            {/* Agent instructions field */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-agent-instructions">Agent instructions</Label>
              <Textarea
                id="project-agent-instructions"
                placeholder="How should the agent synthesize this project? e.g. “Focus on what PRs are in flight for my status.”"
                value={agentInstructions}
                onChange={(e) => setAgentInstructions(e.target.value)}
                disabled={submitting}
                rows={3}
              />
              <p className="text-[11.5px] text-muted-foreground">
                Steers the project summary, next steps, and suggested prompts.
              </p>
            </div>

          </div>

          {/* Actions */}
          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {isEditing ? "Saving…" : "Creating…"}
                </>
              ) : (
                isEditing ? "Save" : "Create Project"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
