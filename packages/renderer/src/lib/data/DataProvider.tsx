import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Project, Session } from "@app/core";
import type { DataSource } from "./types.js";
import { MockDataSource } from "./MockDataSource.js";

interface DataContextValue {
  projects: Project[];
  standaloneSessions: Session[];
  loading: boolean;
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
  // Create the default source exactly once. Using a default parameter
  // (`source = new MockDataSource()`) would build a fresh instance on every
  // render, invalidating the loadData/useEffect deps below and triggering an
  // infinite update loop. The lazy useState initializer gives a stable ref.
  const [defaultSource] = useState(() => new MockDataSource());
  const activeSource = source ?? defaultSource;

  const [projects, setProjects] = useState<Project[]>([]);
  const [standaloneSessions, setStandaloneSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [projects, sessions] = await Promise.all([
        activeSource.listProjects(),
        activeSource.listStandaloneSessions(),
      ]);
      setProjects(projects);
      setStandaloneSessions(sessions);
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
