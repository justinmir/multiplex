import { useMemo, useState } from "react";
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

interface SearchResult {
  kind: "session" | "project";
  id: string;
  title: string;
  subtitle?: string;
  status?: SessionStatus;
  projectId?: string;
  /**
   * Concatenated searchable text. cmdk re-filters items by their `value`
   * (defaulting to visible text), so without this a session matched only by
   * its prompt — not its title — would be hidden. Including the id keeps
   * values unique across items with identical titles.
   */
  value: string;
}

export interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  standaloneSessions: Session[];
  onSelectProject: (id: string, sessionId?: string | null) => void;
  onSelectSession: (sessionId: string, projectId?: string) => void;
}

export function SearchPalette({
  open,
  onOpenChange,
  projects,
  standaloneSessions,
  onSelectProject,
  onSelectSession,
}: SearchPaletteProps) {
  const [query, setQuery] = useState("");

  // Flatten all searchable entities from loaded data
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase().trim();

    // Standalone sessions
    const standaloneResults: SearchResult[] = standaloneSessions
      .filter(
        (s) =>
          (s.title ?? "").toLowerCase().includes(q) ||
          (s.prompt ?? "").toLowerCase().includes(q),
      )
      .map((s) => ({
        kind: "session" as const,
        id: s.id,
        title: s.title || "Untitled Session",
        status: s.status,
        value: `${s.title ?? ""} ${s.prompt ?? ""} ${s.id}`,
      }));

    // Project-scoped sessions (flattened with projectId tag)
    const projectSessionResults: SearchResult[] = projects.flatMap((p) =>
      p.sessions
        .filter(
          (s) =>
            (s.title ?? "").toLowerCase().includes(q) ||
            (s.prompt ?? "").toLowerCase().includes(q),
        )
        .map((s) => ({
          kind: "session" as const,
          id: s.id,
          title: s.title || "Untitled Session",
          status: s.status,
          projectId: p.id,
          value: `${s.title ?? ""} ${s.prompt ?? ""} ${s.id}`,
        })),
    );

    // Projects
    const projectResults: SearchResult[] = projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q),
    ).map((p) => ({
      kind: "project" as const,
      id: p.id,
      title: p.name,
      subtitle: p.description,
      value: `${p.name} ${p.description ?? ""} ${p.id}`,
    }));

    return [...standaloneResults, ...projectSessionResults, ...projectResults];
  }, [query, projects, standaloneSessions]);

  const handleSelect = (item: SearchResult) => {
    onOpenChange(false);
    setQuery(""); // clear query for next time

    if (item.kind === "session") {
      onSelectSession(item.id, item.projectId);
    } else if (item.kind === "project") {
      onSelectProject(item.id, null);
    }
  };

  const sessionResults = results.filter((r) => r.kind === "session");
  const projectSearchResults = results.filter((r) => r.kind === "project");

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={query}
        onValueChange={(value) => setQuery(value)}
        placeholder="Search projects, sessions..."
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {sessionResults.length > 0 && (
          <CommandGroup heading="Sessions">
            {sessionResults.map((r) => (
              <CommandItem
                key={r.id}
                value={r.value}
                onSelect={() => handleSelect(r)}
                className="flex items-center justify-between"
              >
                <span>{r.title}</span>
                {r.status && <SessionStateLabel status={r.status} />}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {projectSearchResults.length > 0 && (
          <CommandGroup heading="Projects">
            {projectSearchResults.map((r) => (
              <CommandItem key={r.id} value={r.value} onSelect={() => handleSelect(r)}>
                <div>
                  <div>{r.title}</div>
                  {r.subtitle && (
                    <div className="text-sm text-muted-foreground">{r.subtitle}</div>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
