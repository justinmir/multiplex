import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Project, Session } from "@app/core";
import type { DataSource } from "./types.js";

interface DataContextValue {
  projects: Project[];
  standaloneSessions: Session[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DataContext = createContext<DataContextValue>(null!);

export function DataProvider({
  children,
  source,
}: {
  children: React.ReactNode;
  source?: DataSource;
}) {
  const activeSource = source!; // caller (main.tsx) always provides a source

  const [projects, setProjects] = useState<Project[]>([]);
  const [standaloneSessions, setStandaloneSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectsData, sessions] = await Promise.all([
        activeSource.listProjects(),
        activeSource.listStandaloneSessions(),
      ]);
      setProjects(projectsData);
      setStandaloneSessions(sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [activeSource]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const value: DataContextValue = {
    projects,
    standaloneSessions,
    loading,
    error,
    refresh: loadData,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useProjects(): Project[] {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useProjects must be used within DataProvider");
  return ctx.projects;
}

export function useProject(id: string): Project | undefined {
  const projects = useProjects();
  return projects.find((p) => p.id === id);
}

export function useStandaloneSessions(): Session[] {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useStandaloneSessions must be used within DataProvider");
  return ctx.standaloneSessions;
}

export function useSession(id: string): Session | undefined {
  const sessions = useStandaloneSessions();
  return sessions.find((s) => s.id === id);
}

/** Returns loading + error state for use in top-level UI (e.g. AppShell). */
export function useDataLoading(): Pick<DataContextValue, "loading" | "error"> {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useDataLoading must be used within DataProvider");
  return { loading: ctx.loading, error: ctx.error };
}
