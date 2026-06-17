import type { Repository, TokenUsageEvent } from "@app/core";

/**
 * Lightweight sink for token-usage events. Wired to the repository in IpcModule
 * so modules that can't easily reach the repo (the one-shot opencode helpers,
 * harnesses) can record usage without plumbing the repo everywhere.
 */
let repo: Repository | null = null;

export function setTokenRepo(r: Repository): void {
  repo = r;
}

function record(e: TokenUsageEvent): void {
  if (!repo) return;
  if (e.tokens <= 0 && e.costUsd <= 0) return;
  void repo.recordTokenUsage(e).catch((err) => console.error("[analytics] recordTokenUsage failed:", err));
}

/** Tokens consumed by an application operation (title/branch/synthesis/…). */
export function recordAppTokens(operation: string, tokens: number, costUsd: number): void {
  record({ ts: Date.now(), source: "app", operation, tokens, costUsd });
}

/** Tokens consumed by an agent session turn. */
export function recordSessionTokens(sessionId: string, tokens: number, costUsd: number): void {
  record({ ts: Date.now(), source: "session", sessionId, tokens, costUsd });
}
