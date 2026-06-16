import type { SessionMsg, Workspace } from "../domain.js";

export type HarnessId = string; // "mock" | "opencode" | "claude" | "codex"

export interface HarnessRunInput {
  sessionId: string;
  prompt: string;
  model?: string;
  cwd: string;
  workspaces: Workspace[];
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
