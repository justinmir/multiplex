import { useState } from "react";
import { Plus, ExternalLink, Sparkles } from "lucide-react";
import { Reference } from "../../data/mockData";
import { ReferenceKindIcon, referenceKindLabel } from "../ReferenceKindIcon";

interface Props {
  references: Reference[];
  onAdd?: (r: Reference) => void;
}

export function ReferencesTab({ references, onAdd }: Props) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground">References</h2>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-accent" />
            Indexed by the agent — used as context on every run. PRs, design docs, meeting notes, TODOs, anything relevant.
          </p>
        </div>
        <AddReferenceButton onAdd={onAdd} />
      </div>

      {references.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-[13px] text-muted-foreground">
          No references yet. Add design docs, related PRs, meeting notes, or external links the agent should consult.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {references.map((r, i) => (
            <ReferenceRow key={r.id} reference={r} divider={i < references.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ReferenceRow({ reference, divider, compact }: { reference: Reference; divider?: boolean; compact?: boolean }) {
  return (
    <div className={`grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-4 ${compact ? "py-2" : "py-2.5"} ${divider ? "border-b border-border/60" : ""}`}>
      <ReferenceKindIcon kind={reference.kind} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-foreground">{reference.title}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {referenceKindLabel(reference.kind)}
          </span>
        </div>
        {(reference.summary || reference.source) && (
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
            {reference.source && <span>{reference.source}</span>}
            {reference.summary && reference.source && <span className="text-muted-foreground/40"> · </span>}
            {reference.summary && <span className="text-foreground/70">{reference.summary}</span>}
          </div>
        )}
      </div>
      <span className="font-mono text-[10.5px] text-muted-foreground">{reference.addedAt}</span>
      {reference.url ? (
        <a href={reference.url} className="rounded-sm p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <span className="w-5" />
      )}
    </div>
  );
}

function AddReferenceButton({ onAdd }: { onAdd?: (r: Reference) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");

  const submit = () => {
    if (!title.trim()) return;
    onAdd?.({
      id: `ref_${Date.now().toString(36)}`,
      kind: url.includes("github.com") && url.includes("/pull/") ? "pr"
          : url.includes("docs.google.com") ? "doc"
          : url ? "link" : "todo",
      title: title.trim(),
      url: url.trim() || undefined,
      source: url ? new URL(url.startsWith("http") ? url : `https://${url}`).host : undefined,
      addedAt: "just now",
      addedBy: "you",
    });
    setTitle("");
    setUrl("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] text-foreground hover:bg-secondary"
      >
        <Plus className="h-3.5 w-3.5" />
        Add reference
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-40 bg-transparent text-[12.5px] placeholder:text-muted-foreground/70 focus:outline-none"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder="URL (optional)"
        className="w-52 bg-transparent font-mono text-[11.5px] placeholder:text-muted-foreground/70 focus:outline-none"
      />
      <button onClick={submit} className="rounded-md bg-accent px-2 py-1 font-mono text-[10.5px] text-accent-foreground hover:bg-accent/90">
        Add
      </button>
      <button onClick={() => setOpen(false)} className="rounded-md px-2 py-1 font-mono text-[10.5px] text-muted-foreground hover:bg-secondary hover:text-foreground">
        Cancel
      </button>
    </div>
  );
}
