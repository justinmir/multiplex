import { spawn } from "child_process";
import type { ChildProcess, StdioOptions } from "child_process";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";

/** Manages the opencode serve server lifecycle. */
export class OpenCodeServerManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private port: number | null = null;
  private started = false;

  /** Start the opencode serve server on a random port. */
  async start(opencodePath: string): Promise<number> {
    if (this.started) return this.port!;

    const stdio: StdioOptions = ["pipe", "pipe", "pipe"];
    this.child = spawn(
      opencodePath,
      ["serve", "--port", "0", "--hostname", "127.0.0.1"],
      { stdio },
    );

    const portPromise = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("opencode serve startup timed out")), 15_000);

      this.child?.stdout?.on("data", (chunk) => {
        const text = chunk.toString();
        const match = text.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(parseInt(match[1], 10));
        }
      });

      this.child?.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        // Also check stderr for the listening message
        const match = text.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(parseInt(match[1], 10));
        }
      });

      this.child?.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.child?.on("exit", () => {
        clearTimeout(timeout);
        if (!this.started) reject(new Error("opencode serve exited before starting"));
      });
    });

    const port = await portPromise;
    this.port = port;
    this.started = true;
    return port;
  }

  /** Stop the opencode serve server gracefully (SIGTERM, then SIGKILL after 2s). */
  async stop(): Promise<void> {
    if (this.child) {
      const child = this.child;
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const t = setTimeout(() => { child.kill("SIGKILL"); resolve(undefined); }, 2000);
        child.once("exit", () => { clearTimeout(t); resolve(undefined); });
      });
      this.child = null;
    }
    this.started = false;
    this.port = null;
  }

  /** Kill the server immediately and synchronously (for app-quit cleanup, where
   *  there's no time to await a graceful shutdown — avoids orphaned processes). */
  killNow(): void {
    if (this.child) {
      try { this.child.kill("SIGKILL"); } catch { /* already gone */ }
      this.child = null;
    }
    this.started = false;
    this.port = null;
  }

  /** Get the base URL for the server. */
  getUrl(): string | null {
    if (this.started && this.port) return `http://127.0.0.1:${this.port}`;
    return null;
  }

  /** Check if the server is running. */
  isRunning(): boolean {
    return this.started && !!this.child?.kill(0);
  }
}
