import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryRepository } from "../repo/InMemoryRepository.js";
import { SessionRuntime } from "./SessionRuntime.js";
import type { AppSettingsData } from "@app/core";

const settings: AppSettingsData = {
  harnessId: "mock",
  defaultModel: "mock/x",
  repoRoots: [],
  intelligenceEnabled: false,
  autoSynthesizeOnActivity: false,
};

function makeRuntime(repo: InMemoryRepository) {
  // No WorkspaceManager → the mock run skips repo materialization; we only
  // exercise the message/stream/persist flow here (deterministic, no network).
  return new SessionRuntime(repo, () => settings, () => {}, undefined, undefined, {
    maxConcurrentSessions: 5,
    crashDetectionIntervalMs: 9_000_000,
    crashTimeoutMs: 9_000_000,
  });
}

async function waitForStatus(repo: InMemoryRepository, id: string, target: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await repo.getSession(id);
    if (s && s.status === target) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for status="${target}"`);
}

async function waitUntil(repo: InMemoryRepository, id: string, pred: (s: import("@app/core").Session) => boolean, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await repo.getSession(id);
    if (s && pred(s)) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for predicate");
}

// the core flow on the deterministic mock harness (CI-safe: no opencode,
// no network, no keys).
test("mock session: start → stream → complete → persisted transcript", async () => {
  const repo = new InMemoryRepository();
  const rt = makeRuntime(repo);

  const { sessionId } = await rt.startSession({ prompt: "do the thing" });
  // User prompt is persisted immediately.
  let s = await repo.getSession(sessionId);
  assert.ok(s, "session should exist");
  assert.equal(s!.messages[0].role, "user");
  assert.equal(s!.messages[0].content, "do the thing");

  // The mock streams an agent reply and completes.
  s = await waitForStatus(repo, sessionId, "completed");
  const agentMsgs = s!.messages.filter((m) => m.role === "agent");
  assert.ok(agentMsgs.length >= 1, "an agent message should be persisted");
  assert.ok(agentMsgs.some((m) => m.content.trim().length > 0), "agent message has content");

  rt.disposeAll();
});

test("mock session: follow-up message is appended and answered", async () => {
  const repo = new InMemoryRepository();
  const rt = makeRuntime(repo);

  const { sessionId } = await rt.startSession({ prompt: "first" });
  await waitForStatus(repo, sessionId, "completed");

  await rt.sendMessage(sessionId, "second");
  const after = await repo.getSession(sessionId);
  const userMsgs = after!.messages.filter((m) => m.role === "user").map((m) => m.content);
  assert.deepEqual(userMsgs, ["first", "second"], "both user turns persisted in order");

  await waitForStatus(repo, sessionId, "completed");
  rt.disposeAll();
});

test("mock session: thinking + tool steps are persisted in order", async () => {
  const repo = new InMemoryRepository();
  const rt = makeRuntime(repo);

  const { sessionId } = await rt.startSession({ prompt: "do the thing" });
  const s = await waitForStatus(repo, sessionId, "completed");
  const roles = s!.messages.map((m) => m.role);

  // A thinking block, the tool call, and the agent reply all survive the turn.
  const thinkingIdx = roles.indexOf("thinking");
  const toolIdx = roles.indexOf("tool");
  const agentIdx = roles.lastIndexOf("agent");
  assert.ok(thinkingIdx >= 0, "a thinking message is persisted");
  assert.ok(toolIdx >= 0, "a tool message is persisted");
  assert.ok(agentIdx >= 0, "an agent message is persisted");
  assert.ok(thinkingIdx < toolIdx && toolIdx < agentIdx, "ordered thinking → tool → agent");

  const toolMsg = s!.messages[toolIdx];
  assert.equal(toolMsg.tool?.name, "read_file", "tool call carries its name");
  assert.equal(toolMsg.tool?.status, "ok", "tool result marked ok");
  assert.ok(toolMsg.content.trim().length > 0, "tool result content captured");

  rt.disposeAll();
});

test("messages sent while a turn runs are queued and drained in order", async () => {
  const repo = new InMemoryRepository();
  const rt = makeRuntime(repo);

  const { sessionId } = await rt.startSession({ prompt: "first" });
  // The first turn is active → these queue (persisted) rather than send.
  await rt.sendMessage(sessionId, "second");
  await rt.sendMessage(sessionId, "third");

  const queuedNow = await repo.getSession(sessionId);
  assert.deepEqual(queuedNow!.queuedMessages, ["second", "third"], "both queued while busy");

  // The queue drains one turn at a time; wait until empty + all three handled.
  const done = await waitUntil(
    repo,
    sessionId,
    (s) => (s.queuedMessages?.length ?? 0) === 0 && s.messages.filter((m) => m.role === "user").length === 3 && s.status === "completed",
  );
  const userMsgs = done.messages.filter((m) => m.role === "user").map((m) => m.content);
  assert.deepEqual(userMsgs, ["first", "second", "third"], "all three ran in FIFO order");

  rt.disposeAll();
});

test("queued messages persist for a fresh runtime and drain on recovery", async () => {
  const repo = new InMemoryRepository();
  const rt1 = makeRuntime(repo);
  const { sessionId } = await rt1.startSession({ prompt: "first" });
  await rt1.sendMessage(sessionId, "queued-before-restart");
  // Simulate a crash mid-turn: drop the runtime without completing.
  rt1.disposeAll();

  const mid = await repo.getSession(sessionId);
  assert.ok((mid!.queuedMessages?.length ?? 0) >= 1, "queue survives into the repo");

  // A fresh runtime recovers stale sessions and drains the persisted queue.
  const rt2 = makeRuntime(repo);
  await rt2.recoverStaleSessions();
  const drained = await waitUntil(
    repo,
    sessionId,
    (s) => (s.queuedMessages?.length ?? 0) === 0 && s.messages.some((m) => m.role === "user" && m.content === "queued-before-restart"),
  );
  assert.ok(drained, "queued message ran after recovery");
  rt2.disposeAll();
});

test("session persists across a fresh runtime (simulated restart)", async () => {
  const repo = new InMemoryRepository();
  const rt1 = makeRuntime(repo);
  const { sessionId } = await rt1.startSession({ prompt: "persist me" });
  await waitForStatus(repo, sessionId, "completed");
  rt1.disposeAll();

  // A new runtime over the same repo still sees the session + transcript.
  const rt2 = makeRuntime(repo);
  const reloaded = await repo.getSession(sessionId);
  assert.ok(reloaded, "session survives into a new runtime");
  assert.ok(reloaded!.messages.length >= 2, "transcript survives");
  rt2.disposeAll();
});
