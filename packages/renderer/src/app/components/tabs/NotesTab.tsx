import { useEffect, useState } from "react";
import { Plus, FileText, ArrowLeft, Eye, Pencil } from "lucide-react";
import type { Note, Project } from "@app/core";
import { useDataMutations } from "../../../lib/data/DataProvider.js";
import { formatRelativeTime } from "../../../lib/format/time.js";
import { Markdown } from "../../../lib/markdown/Markdown.js";

interface Props {
  project: Project;
  focusedId: string | null;
  onFocus: (id: string | null) => void;
}

export function NotesTab({ project, focusedId, onFocus }: Props) {
  const mutations = useDataMutations();
  const focused = focusedId ? project.notes.find((n) => n.id === focusedId) : null;

  // ---- Editor draft (autosaved) ----
  const [draft, setDraft] = useState({ title: "", body: "", tags: "" });
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  // Load the draft whenever a different note is opened.
  useEffect(() => {
    if (focused) setDraft({ title: focused.title, body: focused.body, tags: focused.tags.join(", ") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId]);

  // Debounced autosave — notes are always editable, so persist as the user types.
  useEffect(() => {
    if (!focused) return;
    const tags = draft.tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (draft.title === focused.title && draft.body === focused.body && tags.join(",") === focused.tags.join(",")) return;
    const t = setTimeout(() => {
      mutations
        .upsertNote(project.id, { ...focused, title: draft.title.trim() || "Untitled note", body: draft.body, tags, updatedAt: new Date().toISOString() })
        .catch((e) => console.error("Failed to save note:", e));
    }, 600);
    return () => clearTimeout(t);
  }, [draft, focused, project.id, mutations]);

  const handleNewNote = async () => {
    const note: Note = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: "Untitled note",
      body: "",
      author: "you",
      updatedAt: new Date().toISOString(),
      tags: [],
    };
    try {
      await mutations.upsertNote(project.id, note);
      onFocus(note.id); // open the editor immediately
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  };

  // ---- Editor (center panel) ----
  if (focused) {
    const draftTags = draft.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const dirty = draft.title !== focused.title || draft.body !== focused.body || draftTags.join(",") !== focused.tags.join(",");
    return (
      <div className="mx-auto flex h-full max-w-4xl flex-col">
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => onFocus(null)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All notes
          </button>
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Untitled note"
            className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <span className="font-mono text-[10.5px] text-muted-foreground">{dirty ? "Saving…" : "Saved"}</span>
          <button
            onClick={() => setMode((m) => (m === "edit" ? "preview" : "edit"))}
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            title={mode === "edit" ? "Preview rendered markdown" : "Back to editing"}
          >
            {mode === "edit" ? <><Eye className="h-3.5 w-3.5" /> Preview</> : <><Pencil className="h-3.5 w-3.5" /> Edit</>}
          </button>
        </div>

        {mode === "edit" ? (
          <textarea
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            placeholder="Write in markdown…"
            className="min-h-[60vh] flex-1 resize-none rounded-md border border-border bg-card/40 p-4 font-mono text-[13px] leading-relaxed text-foreground/90 placeholder:text-muted-foreground/60 focus:outline-none"
          />
        ) : (
          <div className="min-h-[60vh] flex-1 overflow-y-auto rounded-md border border-border bg-card/40 p-4">
            <Markdown content={draft.body || "_Nothing here yet._"} />
          </div>
        )}

        <input
          value={draft.tags}
          onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
          placeholder="tags (comma-separated)"
          className="mt-3 border-t border-border bg-transparent pt-2 font-mono text-[11.5px] text-muted-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
      </div>
    );
  }

  // ---- List ----
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground">Notes</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Long-lived context the agent reads on every run — design decisions, open questions, runbooks.
          </p>
        </div>
        <button
          onClick={handleNewNote}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] text-foreground hover:bg-secondary"
        >
          <Plus className="h-3.5 w-3.5" />
          New note
        </button>
      </div>

      {project.notes.length === 0 ? (
        <button
          onClick={handleNewNote}
          className="flex w-full flex-col items-center rounded-lg border border-dashed border-border bg-card/40 p-10 text-center hover:bg-card/60"
        >
          <FileText className="mb-3 h-6 w-6 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">No notes yet — create one.</p>
        </button>
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
              <p className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">{n.body}</p>
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
