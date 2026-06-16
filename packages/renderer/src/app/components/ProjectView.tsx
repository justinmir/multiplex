import { useState, useEffect } from "react";
import { MoreHorizontal, Play, Star, RefreshCw } from "lucide-react";
import { Project, Reference } from "../data/mockData";
import { OverviewTab } from "./tabs/OverviewTab";
import { SessionsTab } from "./tabs/SessionsTab";
import { NotesTab } from "./tabs/NotesTab";
import { ReferencesTab } from "./tabs/ReferencesTab";

type TabId = "overview" | "sessions" | "notes" | "references";

const tabs: { id: TabId; label: string; count?: (p: Project) => number }[] = [
  { id: "overview", label: "Overview" },
  { id: "sessions", label: "Sessions", count: (p) => p.sessions.length },
  { id: "notes", label: "Notes", count: (p) => p.notes.length },
  { id: "references", label: "References", count: (p) => p.references.length },
];

interface ProjectViewProps {
  project: Project;
  initialSessionId?: string | null;
  onSync?: () => void;
  isSyncing?: boolean;
  /** Called when the user creates a new session from within this project view. */
  onCreateProjectSession?: (prompt: string) => void;
}

export function ProjectView({ project, initialSessionId, onSync, isSyncing, onCreateProjectSession }: ProjectViewProps) {
  const [tab, setTab] = useState<TabId>(initialSessionId ? "sessions" : "overview");
  const [sessionOpen, setSessionOpen] = useState<string | "new" | null>(initialSessionId ?? null);
  const [noteFocus, setNoteFocus] = useState<string | null>(null);
  const [references, setReferences] = useState<Reference[]>(project.references);

  useEffect(() => {
    setTab(initialSessionId ? "sessions" : "overview");
    setSessionOpen(initialSessionId ?? null);
    setNoteFocus(null);
    setReferences(project.references);
  }, [project.id, initialSessionId]);

  const openSession = (id: string | "new") => {
    setSessionOpen(id);
    setTab("sessions");
  };
  const openNote = (id: string) => {
    setNoteFocus(id);
    setTab("notes");
  };

  const isSessionsTab = tab === "sessions";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
      {/* Project header */}
      <header className="border-b border-border px-8 pb-0 pt-6">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-foreground">{project.name}</h1>
            <p className="mt-1.5 max-w-3xl text-[13.5px] text-muted-foreground">
              {project.description}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {onSync && (
              <button
                onClick={onSync}
                disabled={isSyncing || false}
                className={`flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] text-foreground hover:bg-secondary ${
                  isSyncing ? "opacity-60" : ""
                }`}
              >
                <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing..." : "Sync PRs"}
              </button>
            )}
            <button className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Star className="h-3.5 w-3.5" />
            </button>
            <button className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => openSession("new")}
              className="ml-1 flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] text-accent-foreground hover:bg-accent/90"
            >
              <Play className="h-3.5 w-3.5" />
              New session
            </button>
          </div>
        </div>

        <nav className="-mb-px mt-5 flex items-center gap-1">
          {tabs.map((t) => {
            const active = tab === t.id;
            const count = t.count?.(project);
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-2 px-3 py-2.5 text-[12.5px] transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>{t.label}</span>
                {count !== undefined && (
                  <span className="font-mono text-[10.5px] text-muted-foreground/70">{count}</span>
                )}
                {active && <span className="absolute inset-x-2 -bottom-px h-px bg-accent" />}
              </button>
            );
          })}
        </nav>
      </header>

      <div className={`flex-1 overflow-hidden ${isSessionsTab && sessionOpen !== null ? "" : "overflow-y-auto"}`}>
        {tab === "overview" && (
          <div className="px-8 py-6">
            <OverviewTab
              project={project}
              onOpenSession={openSession}
              onOpenNote={openNote}
              onOpenTab={(t) => setTab(t)}
              references={references}
            />
          </div>
        )}
        {tab === "sessions" && (
          sessionOpen !== null ? (
            <SessionsTab project={project} openId={sessionOpen} onOpen={setSessionOpen} onStartSession={onCreateProjectSession} />
          ) : (
            <div className="px-8 py-6"><SessionsTab project={project} openId={null} onOpen={setSessionOpen} onStartSession={onCreateProjectSession} /></div>
          )
        )}
        {tab === "notes" && <div className="px-8 py-6"><NotesTab project={project} focusedId={noteFocus} onFocus={setNoteFocus} /></div>}
        {tab === "references" && (
          <div className="px-8 py-6">
            <ReferencesTab
              references={references}
              onAdd={(r) => setReferences((prev) => [r, ...prev])}
            />
          </div>
        )}
      </div>
    </div>
  );
}
