import type { Harness, HarnessConfig, HarnessFactory } from "./types.js";

const factories = new Map<string, HarnessFactory>();

/** Register a harness factory for a given id. */
export function registerHarness(id: string, factory: HarnessFactory): void {
  factories.set(id, factory);
}

/** Create a harness instance from config by finding the first matching registered factory. */
export function createHarness(config: HarnessConfig): Harness | null {
  const factory = factories.get(config.id);
  if (!factory) return null;
  if (!factory.supports(config.id)) return null;
  return factory.create(config);
}

/** Return the list of registered harness ids. */
export function listRegisteredHarnessIds(): string[] {
  return Array.from(factories.keys());
}
