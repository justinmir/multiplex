import type { SessionMsg, Workspace } from "../domain.js";

export type HarnessId = string; // "mock" | "opencode" | "claude" | "codex"

/**
 * A tool the agent can invoke whose execution is handled in main (the host),
 * not by the model. The result is returned to the agent AND surfaced as a
 * tool_use/tool_result pair in the transcript. Used by Workstream C's
 * `open_repo` to lazily materialize a per-repo worktree on first touch.
 */
export interface HostTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: unknown) => Promise<{ content: string; isError?: boolean }>;
}

export interface HarnessRunInput {
  sessionId: string;
  prompt: string;
  model?: string;
  /** The SESSION WORKSPACE ROOT (not a worktree). Per-repo worktrees live under it. */
  cwd: string;
  workspaces: Workspace[];
  /** Repo identifiers the agent may declare (the registered catalog). */
  availableRepos?: string[];
  /** Host-executed tools surfaced to the agent. */
  tools?: HostTool[];
  references?: { title: string; url?: string; body?: string }[];
  notes?: { title: string; body: string }[];
}

export type HarnessStatus =
  | "starting"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "stopped";

export type HarnessEvent =
  | { type: "status"; status: HarnessStatus }
  | { type: "message"; role: SessionMsg["role"]; content: string; final?: boolean }
  | { type: "message_delta"; role: "agent"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "tool_use"; name: string; input: unknown; id: string }
  | { type: "tool_result"; id: string; content: string; isError?: boolean }
  | { type: "usage"; tokens?: number; costUsd?: number; durationMs?: number }
  | { type: "workspace"; workspace: Workspace }
  | { type: "pr"; repo: string; number: number; url?: string }
  | { type: "awaiting_input"; question?: string }
  | { type: "error"; message: string; recoverable?: boolean }
  | { type: "done"; reason: "completed" | "failed" | "stopped" };

export interface HarnessRun {
  readonly sessionId: string;
  send(message: string): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
}

export interface Harness {
  readonly id: HarnessId;
  /**
   * Whether this harness surfaces host tools to the agent so it can declare
   * repos lazily via `open_repo`. When false, the runtime pre-materializes the
   * session's in-scope repos up front instead.
   */
  readonly supportsHostTools?: boolean;
  start(input: HarnessRunInput, onEvent: (e: HarnessEvent) => void): Promise<HarnessRun>;
  health(): Promise<{ ok: boolean; version?: string; detail?: string }>;
  listModels(): Promise<{ id: string; label?: string; provider?: string }[]>;
}

export interface HarnessConfig {
  id: HarnessId;
  options?: Record<string, unknown>;
}

export interface HarnessFactory {
  create(config: HarnessConfig): Harness;
  supports(id: HarnessId): boolean;
}
