import type { SessionRuntime } from "./SessionRuntime.js";

/** Singleton session runtime, set once during IpcModule.enable(). */
let instance: SessionRuntime | null = null;

export function setSessionRuntime(runtime: SessionRuntime): void {
  instance = runtime;
}

export function getSessionRuntime(): SessionRuntime | null {
  return instance;
}
