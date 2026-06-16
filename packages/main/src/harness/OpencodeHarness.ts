import { execFileSync } from "child_process";
import os from "os";
import path from "path";
import type { Harness, HarnessConfig, HarnessEvent, HarnessFactory, HarnessRun, HarnessRunInput } from "@app/core";
import { OpenCodeServerManager } from "./server.js";

const OPENCODE_PATH = process.env.OPENCODE_BIN ?? path.join(os.homedir(), ".opencode", "bin", "opencode");

function resolvePath(raw: string): string {
  if (raw.startsWith("~")) return raw.replace(/^~/, os.homedir());
  return raw;
}

/** Parse a "provider/model" id (e.g. "opencode/big-pickle") into opencode's model object. */
function parseModel(model?: string): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const idx = model.indexOf("/");
  if (idx <= 0) return undefined; // no provider prefix — let opencode use its default
  return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) };
}

/**
 * Run opencode as a harness via its headless HTTP server.
 *
 * Event handling is driven by the server's SSE stream at `GET /event` (verified
 * against opencode 1.17.6 — see notes below), NOT by polling. The real events:
 *   - `message.part.delta` { sessionID, messageID, field, delta } — streaming text
 *   - `session.idle`       { sessionID } — the turn is complete (NOT a `state` field)
 *   - `session.status`     { sessionID, status: { type: "busy" } } — running
 * `GET /session/status` reports `{ "<sid>": { type: "busy" } }` only while busy and
 * is empty otherwise — which is why the previous polling approach never completed.
 */
export class OpencodeHarness implements Harness {
  readonly id = "opencode";
  private binPath: string;
  private serverManager: OpenCodeServerManager | null = null;

  constructor(config: HarnessConfig) {
    const opts = config.options ?? {};
    const rawBinPath = (opts as Record<string, unknown>).binPath;
    this.binPath = resolvePath(typeof rawBinPath === "string" ? rawBinPath : OPENCODE_PATH);
  }

  async start(input: HarnessRunInput, onEvent: (event: HarnessEvent) => void): Promise<HarnessRun> {
    const serverManager = new OpenCodeServerManager();
    await serverManager.start(this.binPath);
    this.serverManager = serverManager;
    const baseUrl = serverManager.getUrl()!;
    const model = parseModel(input.model);

    onEvent({ type: "status", status: "starting" });

    // Create a session in opencode (directory scopes the agent's workspace).
    const createResp = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: input.prompt.slice(0, 100), directory: input.cwd }),
    });
    if (!createResp.ok) {
      await serverManager.stop();
      throw new Error(`Failed to create opencode session: ${await createResp.text()}`);
    }
    const sessionId: string = (await createResp.json()).id;

    // Subscribe to the global SSE event stream BEFORE sending the prompt so no
    // early deltas are lost. The stream is filtered to our sessionId.
    const abort = new AbortController();
    let turnFinished = false; // guards one completion per turn
    let terminated = false;   // guards server/SSE teardown
    let streamedText = "";    // accumulated deltas for the current turn (fallback)

    const teardown = () => {
      if (terminated) return;
      terminated = true;
      abort.abort();
      void serverManager.stop();
    };

    // A turn finished (session.idle): persist the final answer and signal
    // "completed", but KEEP the server + SSE alive so the user can send
    // follow-up turns on the same opencode session.
    const completeTurn = async () => {
      if (turnFinished || terminated) return;
      turnFinished = true;
      // Prefer the authoritative server-side message; fall back to the text we
      // streamed so the reply is never lost if the fetch comes back empty.
      const fetched = await this.readLastAssistantText(baseUrl, sessionId).catch(() => "");
      const text = fetched || streamedText.trim();
      if (text) onEvent({ type: "message", role: "agent", content: text, final: true });
      onEvent({ type: "done", reason: "completed" });
    };

    const fail = (message: string) => {
      if (terminated) return;
      onEvent({ type: "error", message, recoverable: false });
      onEvent({ type: "done", reason: "failed" });
      teardown();
    };

    // Map SSE events → normalized HarnessEvents. Runs in the background.
    void this.consumeEvents(baseUrl, sessionId, abort.signal, (raw) => {
      const props = (raw?.properties ?? {}) as Record<string, any>;
      if (props.sessionID && props.sessionID !== sessionId) return; // not our session
      switch (raw.type) {
        case "message.part.delta":
          if (props.field === "text" && typeof props.delta === "string") {
            streamedText += props.delta;
            onEvent({ type: "message_delta", role: "agent", delta: props.delta });
          }
          break;
        case "session.status":
          if (props.status?.type === "busy") onEvent({ type: "status", status: "running" });
          break;
        case "session.error":
          fail(JSON.stringify(props.error ?? props));
          break;
        case "session.idle":
          void completeTurn();
          break;
      }
    }).catch((err) => {
      if (!abort.signal.aborted) fail(err instanceof Error ? err.message : String(err));
    });

    // Send the initial prompt (async — the SSE stream carries the response).
    const promptResp = await this.sendPrompt(baseUrl, sessionId, input.prompt, model);
    if (!promptResp.ok) {
      const detail = await promptResp.text();
      teardown();
      throw new Error(`Failed to send prompt: ${detail}`);
    }
    onEvent({ type: "status", status: "running" });

    const sendPrompt = this.sendPrompt.bind(this);
    return {
      sessionId,
      async send(message: string) {
        // A follow-up turn re-uses the same live SSE stream; idle fires again.
        turnFinished = false;
        streamedText = "";
        await sendPrompt(baseUrl, sessionId, message, model);
      },
      async stop() {
        await fetch(`${baseUrl}/session/${sessionId}/abort`, { method: "POST" }).catch(() => {});
        if (!terminated) onEvent({ type: "done", reason: "stopped" });
        teardown();
      },
      dispose() {
        // Synchronous kill — app quit can't await graceful shutdown.
        if (terminated) return;
        terminated = true;
        abort.abort();
        serverManager.killNow();
      },
    };
  }

  private sendPrompt(
    baseUrl: string,
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string },
  ): Promise<Response> {
    return fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(model ? { model } : {}),
        parts: [{ type: "text", text }],
      }),
    });
  }

  /** Read + concatenate the text parts of the most recent assistant message. */
  private async readLastAssistantText(baseUrl: string, sessionId: string): Promise<string> {
    const resp = await fetch(`${baseUrl}/session/${sessionId}/message`);
    if (!resp.ok) return "";
    const messages = (await resp.json()) as Array<{ info?: { role?: string }; parts?: Array<{ type: string; text?: string }> }>;
    const assistants = messages.filter((m) => m.info?.role === "assistant");
    const last = assistants[assistants.length - 1];
    if (!last) return "";
    return (last.parts ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("").trim();
  }

  /** Stream and parse the SSE `/event` endpoint, dispatching each parsed event. */
  private async consumeEvents(
    baseUrl: string,
    _sessionId: string,
    signal: AbortSignal,
    dispatch: (evt: { type: string; properties?: unknown }) => void,
  ): Promise<void> {
    const resp = await fetch(`${baseUrl}/event`, { signal });
    if (!resp.ok || !resp.body) throw new Error(`event stream failed: HTTP ${resp.status}`);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json) continue;
        try {
          dispatch(JSON.parse(json));
        } catch {
          // ignore malformed frame
        }
      }
    }
  }

  async health(): Promise<{ ok: boolean; version?: string; detail?: string }> {
    try {
      const version = execFileSync(this.binPath, ["--version"], { timeout: 10_000 }).toString().trim();
      return { ok: true, version };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : "opencode binary not found" };
    }
  }

  async listModels(): Promise<{ id: string; label?: string; provider?: string }[]> {
    // `opencode models` prints "provider/model" per line, already filtered to
    // connected/authenticated providers — no running server required.
    try {
      const output = execFileSync(this.binPath, ["models"], { timeout: 10_000 }).toString().trim();
      return output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((id) => {
          const slash = id.indexOf("/");
          return slash > 0
            ? { id, provider: id.slice(0, slash), label: id.slice(slash + 1) }
            : { id };
        });
    } catch {
      return [];
    }
  }
}

/** Factory for opencode harness. */
export class OpencodeHarnessFactory implements HarnessFactory {
  create(config: HarnessConfig): Harness {
    return new OpencodeHarness(config);
  }
  supports(id: string): boolean {
    return id === "opencode";
  }
}
