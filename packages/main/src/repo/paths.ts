import { app } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(app.getPath("userData"), "multiplex");
export const DB_PATH = join(DATA_DIR, "db.json");

/** Ensure the directory exists. */
export function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function dataDir(): string { return DATA_DIR; }

/** Root under which per-session workspaces (and their worktrees) live. */
export function sessionsDir(): string { return join(DATA_DIR, "sessions"); }
