import { execSync } from "child_process";
import os from "os";
import path from "path";
import type { Harness, HarnessConfig, HarnessEvent, HarnessFactory, HarnessRun, HarnessRunInput } from "@app/core";
import { OpenCodeServerManager } from "./server.js";

const OPENCODE_PATH = process.env.OPENCODE_BIN ?? path.join(os.homedir(), ".opencode", "bin", "opencode");

function resolvePath(raw: string): string {
  if (raw.startsWith("~")) return raw.replace(/^~/, os.homedir());
  return raw;
}

/** Run opencode as a harness via its headless HTTP server. */
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

    // Create a session in opencode
    const resp = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: input.prompt.slice(0, 100) }),
    });

    if (!resp.ok) throw new Error(`Failed to create session: ${await resp.text()}`);
    const sessionData = await resp.json();
    const sessionId = sessionData.id;

    // Poll for session status and messages until completion
    let lastMessageCount = 0;
    let polling = true;

    const pollInterval = setInterval(async () => {
      try {
        const [statusResp, msgResp] = await Promise.all([
          fetch(`${baseUrl}/session/status`),
          fetch(`${baseUrl}/session/${sessionId}/message`),
        ]);

        if (statusResp.ok) {
          const statusData = await statusResp.json();
          const sessionStatus = statusData[sessionId];
          if (sessionStatus?.state === "complete" || sessionStatus?.state === "error") {
            polling = false;
            clearInterval(pollInterval);
            onEvent({ type: "done", reason: sessionStatus.state === "error" ? "failed" : "completed" });
          } else if (sessionStatus?.state) {
            const mapped = mapOpencodeStatus(sessionStatus.state);
            if (mapped) onEvent({ type: "status", status: mapped });
          }
        }

        if (msgResp.ok) {
          const msgData = await msgResp.json();
          const messages = Array.isArray(msgData) ? msgData : [];
          // Send new messages as events
          for (let i = lastMessageCount; i < messages.length; i++) {
            const m = messages[i];
            if (m?.info?.role === "assistant") {
              const parts = m.parts ?? [];
              const textParts = parts.filter((p: { type: string }) => p.type === "text");
              const content = textParts.map((p: { text: string }) => p.text).join("\n");
              if (content) onEvent({ type: "message", role: "agent", content });
            }
          }
          lastMessageCount = messages.length;
        }
      } catch {
        // Network error during polling — ignore and retry next interval
      }
    }, 500);

    // Send the initial prompt asynchronously so we don't block
    await fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts: [{ type: "text", text: input.prompt }] }),
    });

    return {
      sessionId,
      async send(message: string) {
        await fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parts: [{ type: "text", text: message }] }),
        });
      },
      async stop() {
        polling = false;
        clearInterval(pollInterval);
        await fetch(`${baseUrl}/session/${sessionId}/abort`, { method: "POST" });
      },
      dispose() {
        polling = false;
        clearInterval(pollInterval);
        serverManager.stop();
      },
    };
  }

  async health(): Promise<{ ok: boolean; version?: string; detail?: string }> {
    try {
      const url = this.serverManager?.getUrl();
      if (!url) return { ok: false, detail: "Server not started" };
      const resp = await fetch(`${url}/global/health`);
      if (resp.ok) return { ok: true, version: (await resp.json()).version ?? undefined };
      return { ok: false, detail: `HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : "Unknown" };
    }
  }

  async listModels(): Promise<{ id: string; label?: string; provider?: string }[]> {
    try {
      const url = this.serverManager?.getUrl();
      if (!url) return [];
      const resp = await fetch(`${url}/provider`);
      if (resp.ok) {
        const data = await resp.json();
        return extractModels(data);
      }
    } catch { /* ignore */ }

    // Fallback: call opencode CLI directly for model list
    try {
      const output = execSync(`${this.binPath} models`, { shell: "bash", timeout: 10_000 }).toString().trim();
      return output.split("\n").filter(Boolean).map((line) => ({ id: line }));
    } catch {
      return [];
    }
  }
}

/** Map opencode session status to our HarnessStatus. */
function mapOpencodeStatus(status: string): "starting" | "running" | "awaiting_input" | "completed" | "failed" | "stopped" | null {
  switch (status) {
    case "initializing": return "starting";
    case "running": return "running";
    case "awaiting_input": return "awaiting_input";
    case "complete": return "completed";
    case "error": return "failed";
    case "stopped": return "stopped";
    default: return null;
  }
}

/** Extract usable models from opencode provider data. */
function extractModels(data: unknown): { id: string; label?: string; provider?: string }[] {
  const prov = (data as Record<string, unknown>).all as Array<{ id: string; models?: Array<{ id: string }> }>;
  if (!Array.isArray(prov)) return [];
  return prov.flatMap((p) =>
    (p.models ?? []).map((m) => ({
      id: `${p.id}/${m.id}`,
      label: m.id,
      provider: p.id,
    })),
  );
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
