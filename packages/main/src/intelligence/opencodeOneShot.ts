import os from "node:os";
import { OpenCodeServerManager } from "../harness/server.js";
import { recordAppTokens } from "../analytics/tokenTracker.js";

const DISABLED_TOOLS = ["write", "edit", "patch", "bash", "read", "list", "glob", "grep", "webfetch", "websearch", "task", "todowrite", "skill"];

function parseModel(model?: string): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const i = model.indexOf("/");
  if (i <= 0) return undefined;
  return { providerID: model.slice(0, i), modelID: model.slice(i + 1) };
}

interface AssistantMsg {
  info?: { role?: string; tokens?: { total?: number }; cost?: number };
  parts?: Array<{ type: string; text?: string }>;
}

/** Read the most recent assistant message's text + token usage. */
async function readLastAssistant(base: string, sessionId: string): Promise<{ text: string; tokens: number; cost: number }> {
  const resp = await fetch(`${base}/session/${sessionId}/message`);
  if (!resp.ok) return { text: "", tokens: 0, cost: 0 };
  const messages = (await resp.json()) as AssistantMsg[];
  const assistants = messages.filter((m) => m.info?.role === "assistant");
  const last = assistants[assistants.length - 1];
  if (!last) return { text: "", tokens: 0, cost: 0 };
  const text = (last.parts ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("").trim();
  return { text, tokens: last.info?.tokens?.total ?? 0, cost: last.info?.cost ?? 0 };
}

/** Stream `/event` until our session goes idle (or errors), then resolve.
 *  Cancels the reader on exit so aborting/closing never leaks a rejection. */
function waitForIdle(base: string, sessionId: string, signal: AbortSignal): Promise<void> {
  return (async () => {
    let resp: Response;
    try {
      resp = await fetch(`${base}/event`, { signal });
    } catch (e) {
      if (signal.aborted) return;
      throw e;
    }
    if (!resp.ok || !resp.body) throw new Error(`event stream failed: HTTP ${resp.status}`);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt: { type?: string; properties?: { sessionID?: string } };
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.properties?.sessionID && evt.properties.sessionID !== sessionId) continue;
          if (evt.type === "session.idle") return;
          if (evt.type === "session.error") throw new Error("opencode session error during synthesis");
        }
      }
    } catch (e) {
      if (signal.aborted) return; // timeout/teardown — not a real failure
      throw e;
    } finally {
      reader.cancel().catch(() => {});
    }
  })();
}

/**
 * Run a single tool-less opencode prompt and return the final assistant text.
 * Used for LLM synthesis (no filesystem access). Spins a transient server in a
 * neutral cwd, prompts with built-in tools disabled, waits for idle, tears down.
 */
export async function runOpencodePrompt(opts: {
  binPath: string;
  model?: string;
  system?: string;
  prompt: string;
  timeoutMs?: number;
  /** Label this one-shot's token usage as an app operation (for analytics). */
  operation?: string;
}): Promise<string> {
  const mgr = new OpenCodeServerManager();
  await mgr.start(opts.binPath, os.tmpdir());
  const base = mgr.getUrl()!;
  const abort = new AbortController();
  try {
    const created = await fetch(`${base}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "multiplex synthesis" }),
    });
    if (!created.ok) throw new Error(`session create failed: ${await created.text()}`);
    const sessionId: string = (await created.json()).id;

    const model = parseModel(opts.model);
    const tools = Object.fromEntries(DISABLED_TOOLS.map((t) => [t, false]));

    const idle = waitForIdle(base, sessionId, abort.signal);
    // Mark `idle` as handled up front so a rejection (e.g. the /event fetch
    // resetting) while we await the prompt POST below can't surface as an
    // unhandled rejection before the Promise.race attaches its handler. The race
    // still observes the rejection and fails the call.
    idle.catch(() => {});

    const promptResp = await fetch(`${base}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(model ? { model } : {}),
        ...(opts.system ? { system: opts.system } : {}),
        tools,
        parts: [{ type: "text", text: opts.prompt }],
      }),
    });
    if (!promptResp.ok) throw new Error(`prompt failed: ${await promptResp.text()}`);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(new Error("synthesis timed out")); }, opts.timeoutMs ?? 90_000);
    });
    try {
      await Promise.race([idle, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    // Stop the SSE stream cleanly (idle already returned + cancelled its reader).
    abort.abort();
    await idle.catch(() => {});
    const { text, tokens, cost } = await readLastAssistant(base, sessionId);
    if (opts.operation) recordAppTokens(opts.operation, tokens, cost);
    return text;
  } finally {
    abort.abort();
    await mgr.stop();
  }
}
