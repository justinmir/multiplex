import { registerHarness } from "@app/core";
import type { HarnessConfig } from "@app/core";
import { MockHarness } from "./MockHarness.js";
import { OpencodeHarness, OpencodeHarnessFactory } from "./OpencodeHarness.js";

/** Register all built-in harnesses. Call once at app startup. */
export function registerBuiltInHarnesses(): void {
  registerHarness("mock", {
    create(config: HarnessConfig) { return new MockHarness(config); },
    supports(id: string) { return id === "mock"; },
  });

  // Register opencode harness adapter
  const factory = new OpencodeHarnessFactory();
  registerHarness("opencode", factory);
}
