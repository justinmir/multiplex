import { useState } from "react";
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
}

export function CreateProjectDialog({ open, onOpenChange }: Props) {
  const mutations = useDataMutations();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || submitting) return;

    // Parse GitHub repo "owner/repo" into separate fields
    let githubOwner: string | undefined;
    let githubRepoName: string | undefined;
    const trimmed = githubRepo.trim();
    if (trimmed) {
      const parts = trimmed.split("/").map((s) => s.trim());
      if (parts.length >= 2) {
        githubOwner = parts[0];
        githubRepoName = parts.slice(1).join("/"); // support nested paths like org/team/repo
      } else if (parts.length === 1) {
        // Single segment — treat as repo name with no owner
        githubRepoName = parts[0];
      }
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      description: description.trim() || "No description provided.",
      repos: githubOwner && githubRepoName ? [`${githubOwner}/${githubRepoName}`] : [],
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
      // Reset form and close dialog on success
      setName("");
      setDescription("");
      setGithubRepo("");
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to create project:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Reset form when dialog opens fresh
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && !submitting) {
      setName("");
      setDescription("");
      setGithubRepo("");
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Add a new project to track. Optionally link it to a GitHub repository for live PR data.
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

            {/* GitHub Repo field */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-github-repo">GitHub Repository</Label>
              <Input
                id="project-github-repo"
                placeholder="owner/repo"
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                disabled={submitting}
              />
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
                  Creating…
                </>
              ) : (
                "Create Project"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
