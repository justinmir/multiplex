import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryRepository } from "../repo/InMemoryRepository.js";
import { IntelligenceService } from "./IntelligenceService.js";
import type { AppSettingsData, IntelligenceProvider, Project } from "@app/core";

function project(id: string): Project {
  return {
    id, name: id, slug: id, description: "", repos: [], status: "active", color: "#fff",
    progress: 0, openPRs: 0, activeSessions: 0, lastActivity: "", prs: [], sessions: [],
    notes: [], references: [], activity: [], summary: "", nextSteps: [],
  };
}

const fakeProvider: IntelligenceProvider = {
  async summarizeProject() {
    return { summary: "Synthesized summary.", nextSteps: ["Step A", "Step B"], synthesizedAtMs: 12345 };
  },
  async summarizeReference() {
    return "A one-line reference summary.";
  },
};

const onSettings = (overrides: Partial<AppSettingsData> = {}): AppSettingsData => ({
  repoRoots: [], intelligenceEnabled: true, autoSynthesizeOnActivity: true, ...overrides,
});

test("resynthesize persists summary, nextSteps, and the freshness stamp", async () => {
  const repo = new InMemoryRepository();
  await repo.upsertProject(project("p1"));
  const svc = new IntelligenceService(repo, fakeProvider, () => onSettings(), () => {});

  const result = await svc.resynthesize("p1");
  assert.ok(result);
  assert.equal(result!.summary, "Synthesized summary.");

  const p = await repo.getProject("p1");
  assert.equal(p!.summary, "Synthesized summary.");
  assert.deepEqual(p!.nextSteps, ["Step A", "Step B"]);
  assert.equal(p!.summarySynthesizedAtMs, 12345);
  svc.stop();
});

test("ingestReference attaches a one-line summary (when enabled)", async () => {
  const repo = new InMemoryRepository();
  await repo.upsertReference({ projectId: "p1" }, { id: "r1", kind: "link", title: "Doc", url: "https://e.com", addedAt: "t" });
  const svc = new IntelligenceService(repo, fakeProvider, () => onSettings(), () => {});

  await svc.ingestReference({ projectId: "p1" }, { id: "r1", kind: "link", title: "Doc", url: "https://e.com", addedAt: "t" });
  const refs = await repo.getReferences({ projectId: "p1" });
  assert.equal(refs[0].summary, "A one-line reference summary.");
  svc.stop();
});

test("ingestReference is a no-op when intelligence is disabled", async () => {
  const repo = new InMemoryRepository();
  const svc = new IntelligenceService(repo, fakeProvider, () => onSettings({ intelligenceEnabled: false }), () => {});
  await svc.ingestReference({ projectId: "p1" }, { id: "r1", kind: "link", title: "Doc", addedAt: "t" });
  const refs = await repo.getReferences({ projectId: "p1" });
  assert.equal(refs.length, 0); // nothing persisted
  svc.stop();
});

test("notifyActivity does nothing when auto-synthesis is off", async () => {
  const repo = new InMemoryRepository();
  await repo.upsertProject(project("p1"));
  let called = 0;
  const countingProvider: IntelligenceProvider = {
    async summarizeProject() { called++; return { summary: "x", nextSteps: [], synthesizedAtMs: 1 }; },
    async summarizeReference() { return ""; },
  };
  const svc = new IntelligenceService(repo, countingProvider, () => onSettings({ autoSynthesizeOnActivity: false }), () => {});
  svc.notifyActivity("p1");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(called, 0);
  svc.stop();
});
