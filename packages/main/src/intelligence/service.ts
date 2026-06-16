import type { IntelligenceService } from "./IntelligenceService.js";

let instance: IntelligenceService | null = null;

export function setIntelligenceService(service: IntelligenceService): void {
  instance = service;
}

export function getIntelligenceService(): IntelligenceService | null {
  return instance;
}
