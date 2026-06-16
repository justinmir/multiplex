import { useState } from "react";
import { Plus, FileText, ArrowLeft, Loader2 } from "lucide-react";
import type { Note, Project } from "@app/core";
import { useDataMutations } from "../../../lib/data/DataProvider.js";
import { formatRelativeTime } from "../../../lib/format/time.js";

interface Props {
  project: Project;
  focusedId: string | null;
  onFocus: (id: string | null) => void;
}

export function NotesTab({ project, focusedId, onFocus }: Props) {
  const mutations = useDataMutations();
  const focused = focusedId ? project.notes.find((n) => n.id === focusedId) : null;

  // ---- Note creation form state ----
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newTags, setNewTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || submitting) return;

    const tags = newTags.split(",").map((t) => t.trim()).filter(Boolean);

    const note: Note = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: newTitle.trim(),
      body: newBody.trim() || "No content.",
      author: "you",
      updatedAt: new Date().toISOString(),
      tags: tags.length > 0 ? tags : [],
    };

    setSubmitting(true);
    try {
      await mutations.upsertNote(project.id, note);
      // Reset form and close editor on success
      setNewTitle("");
      setNewBody("");
      setNewTags("");
      setIsCreating(false);
    } catch (err) {
      console.error("Failed to create note:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelCreate = () => {
    setNewTitle("");
    setNewBody("");
    setNewTags("");
    setIsCreating(false);
  };

  if (focused) {
    return (
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => onFocus(null)}
          className="mb-4 flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All notes
        </button>
        <article className="rounded-lg border border-border bg-card p-6">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 className="text-foreground">{focused.title}</h2>
            <span className="font-mono text-[10.5px] text-muted-foreground">{formatRelativeTime(focused.updatedAt)}</span>
          </div>
          <p className="text-[14px] leading-relaxed text-foreground/90">{focused.body}</p>
          <div className="mt-5 flex items-center gap-2 border-t border-border pt-3">
            {focused.tags.map((t) => (
              <span key={t} className="rounded-sm bg-secondary px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                #{t}
              </span>
            ))}
            <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">by {focused.author}</span>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground">Notes</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Long-lived context the agent reads on every run — design decisions, open questions, runbooks.
          </p>
        </div>

        {isCreating ? (
          <form onSubmit={handleCreateNote} className="flex flex-col gap-2 w-full max-w-sm">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title"
              required
              className="bg-transparent text-[12.5px] placeholder:text-muted-foreground/70 focus:outline-none border-b border-border pb-1"
            />
            <textarea
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Content (markdown)"
              rows={4}
              className="resize-none bg-transparent text-[12.5px] placeholder:text-muted-foreground/70 focus:outline-none border-b border-border pb-1"
            />
            <input
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="Tags (comma-separated)"
              className="bg-transparent font-mono text-[11.5px] placeholder:text-muted-foreground/70 focus:outline-none border-b border-border pb-1"
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                type="submit"
                disabled={!newTitle.trim() || submitting}
                className="rounded-md bg-accent px-3 py-1 font-mono text-[10.5px] text-accent-foreground hover:bg-accent/90 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5"
              >
                {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </button>
              <button
                type="button"
                onClick={handleCancelCreate}
                disabled={submitting}
                className="rounded-md px-3 py-1 font-mono text-[10.5px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] text-foreground hover:bg-secondary"
          >
            <Plus className="h-3.5 w-3.5" />
            New note
          </button>
        )}
      </div>

      {project.notes.length === 0 && !isCreating ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center">
          <FileText className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">No notes yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {project.notes.map((n) => (
            <button
              key={n.id}
              onClick={() => onFocus(n.id)}
              className="group rounded-lg border border-border bg-card p-4 text-left hover:border-border-strong"
            >
              <div className="mb-2 flex items-start justify-between">
                <h3 className="text-foreground">{n.title}</h3>
                <span className="font-mono text-[10.5px] text-muted-foreground">{formatRelativeTime(n.updatedAt)}</span>
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{n.body}</p>
              <div className="mt-3 flex items-center gap-2">
                {n.tags.map((t) => (
                  <span key={t} className="rounded-sm bg-secondary px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                    #{t}
                  </span>
                ))}
                <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{n.author}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
