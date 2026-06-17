import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRepository } from "./SqliteRepository.js";
import type { Project, Session } from "@app/core";

function freshDb(): string {
  return join(mkdtempSync(join(tmpdir(), "mx-sqlite-")), "db.sqlite");
}
function project(id: string): Project {
  return {
    id, name: id, slug: id, description: "", repos: [], status: "active", color: "#fff",
    progress: 0, openPRs: 0, activeSessions: 0, lastActivity: "", prs: [], sessions: [],
    notes: [], references: [], activity: [], summary: "", nextSteps: [],
  };
}
function session(id: string): Session {
  return { id, title: id, status: "running", model: "m", workspaces: [], startedAt: "", createdAtMs: 1, durationMin: 0, tokens: 0, cost: 0, messages: [] };
}

test("seeds on first run when MULTIPLEX_SEED is set", async () => {
  const prev = process.env.MULTIPLEX_SEED;
  process.env.MULTIPLEX_SEED = "1";
  try {
    const repo = new SqliteRepository(freshDb());
    const projects = await repo.listProjects();
    assert.ok(projects.length >= 2, "seed projects present");
    const standalone = await repo.listSessions({ projectId: null });
    assert.ok(standalone.length >= 1, "seed standalone sessions present");
  } finally {
    if (prev === undefined) delete process.env.MULTIPLEX_SEED;
    else process.env.MULTIPLEX_SEED = prev;
  }
});

test("starts empty on first run without MULTIPLEX_SEED", async () => {
  const prev = process.env.MULTIPLEX_SEED;
  delete process.env.MULTIPLEX_SEED;
  try {
    const repo = new SqliteRepository(freshDb());
    assert.equal((await repo.listProjects()).length, 0, "no seed projects");
    assert.equal((await repo.listSessions({ projectId: null })).length, 0, "no seed sessions");
  } finally {
    if (prev !== undefined) process.env.MULTIPLEX_SEED = prev;
  }
});

test("hydrates notes/references/sessions/activity onto a project", async () => {
  const repo = new SqliteRepository(freshDb());
  await repo.upsertProject(project("p1"));
  await repo.upsertNote("p1", { id: "n1", title: "Note", body: "b", author: "you", updatedAt: "t", tags: [] });
  await repo.upsertReference({ projectId: "p1" }, { id: "r1", kind: "link", title: "Ref", addedAt: "t" });
  await repo.upsertSession(session("s1"), "p1");
  await repo.appendActivity("p1", { id: "a1", kind: "note", text: "did a thing", ts: "t" });

  const p = await repo.getProject("p1");
  assert.equal(p!.notes.length, 1);
  assert.equal(p!.references.length, 1);
  assert.equal(p!.sessions.length, 1);
  assert.equal(p!.activity.length, 1);
  assert.equal(p!.sessions[0].id, "s1");
});

test("session-scoped references hydrate; project association preserved", async () => {
  const repo = new SqliteRepository(freshDb());
  await repo.upsertSession(session("s1"), "p1");
  await repo.upsertReference({ sessionId: "s1" }, { id: "r1", kind: "doc", title: "Doc", addedAt: "t" });
  const s = await repo.getSession("s1");
  assert.equal(s!.references?.length, 1);
  assert.equal(await repo.getSessionProjectId("s1"), "p1");
});

test("delete note/reference removes from hydration; archive flips flag", async () => {
  const repo = new SqliteRepository(freshDb());
  await repo.upsertProject(project("p1"));
  await repo.upsertNote("p1", { id: "n1", title: "N", body: "", author: "", updatedAt: "", tags: [] });
  await repo.deleteNote("p1", "n1");
  assert.equal((await repo.getProject("p1"))!.notes.length, 0);

  await repo.upsertSession(session("s2"), null);
  await repo.archiveSession("s2");
  assert.equal((await repo.getSession("s2"))!.archived, true);
});

test("persists across reopen (durability)", async () => {
  const path = freshDb();
  const r1 = new SqliteRepository(path);
  await r1.upsertProject(project("keep"));
  await r1.upsertNote("keep", { id: "n1", title: "kept", body: "", author: "", updatedAt: "", tags: [] });
  const r2 = new SqliteRepository(path);
  const p = await r2.getProject("keep");
  assert.ok(p);
  assert.equal(p!.notes[0].title, "kept");
});

test("migrates from a db.json snapshot, then backs it up", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mx-mig-"));
  const sqlitePath = join(dir, "db.sqlite");
  const jsonPath = join(dir, "db.json");
  // Snapshot in JsonRepository's serialized shape (hydrated projects + flat collections).
  const snap = {
    version: 1,
    projects: [{ ...project("p1"), sessions: [session("ps1")] }],
    standaloneSessions: [session("ss1")],
    notes: [{ projectId: "p1", note: { id: "n1", title: "Migrated note", body: "", author: "", updatedAt: "", tags: [] } }],
    references: [{ scope: { projectId: "p1" }, reference: { id: "r1", kind: "link", title: "Migrated ref", addedAt: "t" } }],
    activity: { p1: [{ id: "a1", kind: "note", text: "migrated activity", ts: "t" }] },
  };
  writeFileSync(jsonPath, JSON.stringify(snap));

  const repo = new SqliteRepository(sqlitePath, jsonPath);
  const p = await repo.getProject("p1");
  assert.ok(p, "migrated project present");
  assert.equal(p!.sessions.length, 1, "project session migrated");
  assert.equal(p!.notes[0].title, "Migrated note");
  assert.equal(p!.references[0].title, "Migrated ref");
  assert.equal(p!.activity[0].text, "migrated activity");
  const standalone = await repo.listSessions({ projectId: null });
  assert.ok(standalone.some((s) => s.id === "ss1"), "standalone session migrated");

  // db.json was backed up (so we don't re-migrate next boot).
  assert.equal(existsSync(jsonPath), false);
  assert.equal(existsSync(`${jsonPath}.bak`), true);
  rmSync(dir, { recursive: true, force: true });
});
