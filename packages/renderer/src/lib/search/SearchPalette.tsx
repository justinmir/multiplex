import { useEffect, useState } from "react";
import type { Project, Session, SessionStatus } from "@app/core";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "../../app/components/ui/command";
import { SessionStateLabel } from "../../app/components/SessionStateBadge";
import { call } from "../ipc/client.js";

interface SearchResult {
  kind: "session" | "project" | "pr";
  id: string;
  title: string;
  subtitle?: string;
  status?: SessionStatus;
  projectId?: string;
}

export interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Kept for API compatibility; search is now server-side via search:query.
  projects?: Project[];
  standaloneSessions?: Session[];
  onSelectProject: (id: string, sessionId?: string | null) => void;
  onSelectSession: (sessionId: string, projectId?: string) => void;
}

export function SearchPalette({
  open,
  onOpenChange,
  onSelectProject,
  onSelectSession,
}: SearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  // Debounced server-side search over real projects, sessions, and PRs.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      call("search:query", { q })
        .then((res) => { if (!cancelled) setResults(res as SearchResult[]); })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const handleSelect = (item: SearchResult) => {
    onOpenChange(false);
    setQuery("");
    if (item.kind === "session") {
      onSelectSession(item.id, item.projectId);
    } else {
      // project + pr both navigate to the owning project.
      onSelectProject(item.projectId ?? item.id, null);
    }
  };

  const sessionResults = results.filter((r) => r.kind === "session");
  const projectResults = results.filter((r) => r.kind === "project");
  const prResults = results.filter((r) => r.kind === "pr");

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      {/* Server already filtered; disable cmdk's re-filtering so prompt-only
          matches aren't hidden by the visible-text heuristic. */}
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search projects, sessions, PRs…"
      />
      <CommandList>
        <CommandEmpty>{query.trim() ? "No results found." : "Type to search."}</CommandEmpty>

        {sessionResults.length > 0 && (
          <CommandGroup heading="Sessions">
            {sessionResults.map((r) => (
              <CommandItem key={`s:${r.id}`} value={`s:${r.id}`} onSelect={() => handleSelect(r)} className="flex items-center justify-between">
                <span>{r.title}</span>
                {r.status && <SessionStateLabel status={r.status} />}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {projectResults.length > 0 && (
          <CommandGroup heading="Projects">
            {projectResults.map((r) => (
              <CommandItem key={`p:${r.id}`} value={`p:${r.id}`} onSelect={() => handleSelect(r)}>
                <div>
                  <div>{r.title}</div>
                  {r.subtitle && <div className="text-sm text-muted-foreground">{r.subtitle}</div>}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {prResults.length > 0 && (
          <CommandGroup heading="Pull requests">
            {prResults.map((r) => (
              <CommandItem key={`pr:${r.id}`} value={`pr:${r.id}`} onSelect={() => handleSelect(r)}>
                <div>
                  <div>{r.title}</div>
                  {r.subtitle && <div className="text-sm text-muted-foreground">{r.subtitle}</div>}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
