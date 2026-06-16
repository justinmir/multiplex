import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryRepository } from "./InMemoryRepository.js";
import type { Project } from "@app/core";

function makeProject(id: string): Project {
  return {
    id, name: id, slug: id, description: "", repos: [], status: "active",
    color: "#fff", progress: 0, openPRs: 0, activeSessions: 0, lastActivity: "",
    prs: [], sessions: [], notes: [], references: [], activity: [],
    summary: "", nextSteps: [],
  };
}

// Regression: notes/references/sessions live in dedicated maps and must be
// hydrated onto the Project on read. Previously listProjects/getProject returned
// the stored Project verbatim, so freshly-added items were persisted but never
// surfaced — looking to the user like "saving doesn't work".

test("getProject hydrates newly added notes", async () => {
  const repo = new InMemoryRepository();
  await repo.upsertProject(makeProject("p1"));
  await repo.upsertNote("p1", { id: "n1", title: "Note", body: "b", author: "you", updatedAt: "t", tags: [] });

  const p = await repo.getProject("p1");
  assert.equal(p?.notes.length, 1);
  assert.equal(p?.notes[0].id, "n1");
});

test("getProject hydrates newly added project references", async () => {
  const repo = new InMemoryRepository();
  await repo.upsertProject(makeProject("p1"));
  await repo.upsertReference({ projectId: "p1" }, { id: "r1", kind: "link", title: "Ref", addedAt: "t" });

  const p = await repo.getProject("p1");
  assert.equal(p?.references.length, 1);
  assert.equal(p?.references[0].id, "r1");
});

test("getProject hydrates project-scoped sessions", async () => {
  const repo = new InMemoryRepository();
  await repo.upsertProject(makeProject("p1"));
  await repo.upsertSession(
    { id: "s1", title: "S", status: "running", model: "m", workspaces: [], startedAt: "t", createdAtMs: 1, durationMin: 0, tokens: 0, cost: 0, messages: [] },
    "p1",
  );

  const p = await repo.getProject("p1");
  assert.equal(p?.sessions.length, 1);
  assert.equal(p?.sessions[0].id, "s1");
});

test("getSession hydrates session-scoped references", async () => {
  const repo = new InMemoryRepository();
  await repo.upsertSession(
    { id: "s1", title: "S", status: "running", model: "m", workspaces: [], startedAt: "t", createdAtMs: 1, durationMin: 0, tokens: 0, cost: 0, messages: [] },
    null,
  );
  await repo.upsertReference({ sessionId: "s1" }, { id: "r1", kind: "doc", title: "Doc", addedAt: "t" });

  const s = await repo.getSession("s1");
  assert.equal(s?.references?.length, 1);
  assert.equal(s?.references?.[0].id, "r1");
});

test("deleting a note removes it from the hydrated project", async () => {
  const repo = new InMemoryRepository();
  await repo.upsertProject(makeProject("p1"));
  await repo.upsertNote("p1", { id: "n1", title: "Note", body: "b", author: "you", updatedAt: "t", tags: [] });
  await repo.deleteNote("p1", "n1");

  const p = await repo.getProject("p1");
  assert.equal(p?.notes.length, 0);
});
