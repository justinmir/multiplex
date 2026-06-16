import type { Harness, HarnessConfig, HarnessEvent, HarnessRun, HarnessRunInput } from "@app/core";

const MOCK_MODELS = [
  { id: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "anthropic" },
  { id: "anthropic/claude-opus-4-20250514", label: "Claude Opus 4", provider: "anthropic" },
  { id: "openai/gpt-4.1", label: "GPT-4.1", provider: "openai" },
];

const CANNED_RESPONSE = [
  "I'll start by analyzing the codebase to understand the current structure.",
  "Looking at the relevant files, I can see we need to make changes to three modules.",
  "Let me create a plan:\n1. Update the interface definitions\n2. Implement the new handler\n3. Add tests for the changed behavior",
  "Now implementing the changes...",
];

const DELTA_CHUNKS = CANNED_RESPONSE.flatMap((segment) => {
  const chunks: string[] = [];
  let remaining = segment;
  while (remaining.length > 20) {
    const cutIdx = Math.min(remaining.indexOf(" ", 20), 35, remaining.length);
    if (cutIdx === 0) break;
    chunks.push(remaining.slice(0, cutIdx));
    remaining = remaining.slice(cutIdx).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
});

class MockHarnessRun implements HarnessRun {
  public readonly sessionId: string;

  // Exposed to schedule() helper (same module scope)
  stopped = false;
  timers: NodeJS.Timeout[] = [];
  onEventRef!: (e: HarnessEvent) => void;

  private resolveSend?: () => void;

  constructor(sessionId: string, onEvent: (e: HarnessEvent) => void) {
    this.sessionId = sessionId;
    this.onEventRef = onEvent;
  }

  async send(_message: string): Promise<void> {
    if (this.stopped) return;
    await schedule(this, "🔁 Reply received. Continuing the task…\nI've updated the relevant files and verified the changes.");
    this.resolveSend?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.onEventRef({ type: "done", reason: "stopped" });
  }

  dispose() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}

async function schedule(run: MockHarnessRun, text: string): Promise<void> {
  if (run.stopped) return;
  const chunks = (() => {
    const c: string[] = [];
    let remaining = text;
    while (remaining.length > 15) {
      const cutIdx = Math.min(remaining.indexOf(" ", 15), 30, remaining.length);
      if (cutIdx === 0) break;
      c.push(remaining.slice(0, cutIdx));
      remaining = remaining.slice(cutIdx).trimStart();
    }
    if (remaining) c.push(remaining);
    return c;
  })();

  for (const chunk of chunks) {
    if (run.stopped) return;
    await sleep(30);
    run.onEventRef({ type: "message_delta", role: "agent", delta: chunk });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class MockHarness implements Harness {
  public readonly id = "mock" as const;
  public readonly supportsHostTools = true;

  constructor(_config: HarnessConfig) { /* options not used by mock */ }

  async start(input: HarnessRunInput, onEvent: (e: HarnessEvent) => void): Promise<HarnessRun> {
    const run = new MockHarnessRun(input.sessionId, onEvent);

    // Emit sequence with small delays to simulate a real agent run
    const emit = (delayMs: number, event: HarnessEvent) => {
      const t = setTimeout(() => {
        if (!run.stopped) onEvent(event);
      }, delayMs);
      run.timers.push(t);
    };

    // Phase 1: starting → running
    emit(50, { type: "status", status: "starting" });
    emit(120, { type: "status", status: "running" });

    // Phase 1b: declare the first available repo via the open_repo host tool,
    // then simulate an edit in the materialized worktree (exercises Workstream C).
    const openRepo = input.tools?.find((t) => t.name === "open_repo");
    const firstRepo = input.availableRepos?.[0];
    if (openRepo && firstRepo) {
      const toolId = `open_${input.sessionId.slice(-4)}`;
      emit(140, { type: "tool_use", name: "open_repo", input: { repo: firstRepo }, id: toolId });
      const t = setTimeout(async () => {
        if (run.stopped) return;
        const res = await openRepo.handler({ repo: firstRepo });
        if (run.stopped) return;
        onEvent({ type: "tool_result", id: toolId, content: res.content, isError: res.isError });
        // Simulate an edit so the Changes rail has a real diff to show.
        if (!res.isError && res.content) {
          try {
            const { writeFileSync } = await import("node:fs");
            const { join } = await import("node:path");
            writeFileSync(join(res.content, "MULTIPLEX_MOCK.md"), "Edited by MockHarness\n");
          } catch { /* best effort */ }
        }
      }, 160);
      run.timers.push(t);
    }

    // Phase 2: stream the canned response as deltas
    let cumulative = "";
    for (let i = 0; i < DELTA_CHUNKS.length; i++) {
      cumulative += (i === 0 ? "" : " ") + DELTA_CHUNKS[i];
      emit(180 + i * 60, { type: "message_delta", role: "agent", delta: `${DELTA_CHUNKS[i]} ` });
    }

    // Phase 3: tool use + result
    const toolId = `tool_${input.sessionId.slice(-4)}`;
    emit(180 + DELTA_CHUNKS.length * 60 + 50, { type: "tool_use", name: "read_file", input: { path: "src/index.ts" }, id: toolId });
    emit(180 + DELTA_CHUNKS.length * 60 + 120, { type: "tool_result", id: toolId, content: "// File contents loaded successfully\n// 42 lines read" });

    // Phase 4: final message (the complete accumulated text)
    emit(180 + DELTA_CHUNKS.length * 60 + 200, { type: "message", role: "agent", content: cumulative.trim(), final: true });

    // Phase 5: usage + done
    emit(180 + DELTA_CHUNKS.length * 60 + 280, { type: "usage", tokens: 1432, costUsd: 0.04, durationMs: 2200 });
    emit(180 + DELTA_CHUNKS.length * 60 + 350, { type: "done", reason: "completed" });

    return run;
  }

  async health(): Promise<{ ok: boolean; version?: string; detail?: string }> {
    return { ok: true, version: "mock-1.0.0", detail: "MockHarness is ready for testing" };
  }

  async listModels(): Promise<{ id: string; label?: string; provider?: string }[]> {
    return MOCK_MODELS;
  }
}
