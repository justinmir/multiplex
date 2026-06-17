import { test } from "node:test";
import assert from "node:assert/strict";
import type { ForgeService, PullRequest, PRStatus, Session } from "@app/core";
import { InMemoryRepository } from "../repo/InMemoryRepository.js";
import { PrPoller } from "./PrPoller.js";

function makePR(repo: string, number: number, status: PRStatus = "open"): PullRequest {
  return {
    id: `${repo}#${number}`,
    number,
    title: `PR ${number}`,
    repo,
    branch: "feature",
    status,
    author: "octocat",
    additions: 1,
    deletions: 0,
    updatedAt: new Date().toISOString(),
    checks: { passed: 0, failed: 0, pending: 0 },
  };
}

function makeSession(id: string, linkedPRs: PullRequest[]): Session {
  return {
    id,
    title: id,
    status: "running",
    model: "test",
    workspaces: [],
    linkedPRs,
    startedAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    durationMin: 0,
    tokens: 0,
    cost: 0,
    messages: [],
  };
}

/** Forge stub that records calls and returns whatever `impl` decides. */
function fakeForge(impl: (repo: string, number: number) => PullRequest | null) {
  const calls: string[] = [];
  const forge = {
    async getPR(repo: string, number: number) {
      calls.push(`${repo}#${number}`);
      return impl(repo, number);
    },
  } as unknown as ForgeService;
  return { forge, calls };
}

test("PrPoller caches PR detail and serves get() without a refetch", async () => {
  const repo = new InMemoryRepository();
  await repo.upsertSession(makeSession("s1", [makePR("o/r", 1)]), null);
  const { forge, calls } = fakeForge(() => ({ ...makePR("o/r", 1), title: "enriched" }));
  const events: string[] = [];
  const poller = new PrPoller(repo, forge, (t) => events.push(t), () => true);

  // Cold cache before any fetch.
  assert.equal(poller.get("o/r", 1), null);

  const fresh = await poller.refreshSession("s1");
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].title, "enriched");
  assert.equal(calls.length, 1);
  assert.equal(poller.get("o/r", 1)?.title, "enriched"); // now cached
  assert.ok(events.includes("pr:o/r#1:changed")); // change event emitted
});

test("PrPoller falls back to the stored PR when a fetch returns nothing", async () => {
  const repo = new InMemoryRepository();
  await repo.upsertSession(makeSession("s1", [makePR("o/r", 2)]), null);
  const { forge } = fakeForge(() => null); // simulate failure / rate limit
  const poller = new PrPoller(repo, forge, () => {}, () => true);

  const fresh = await poller.refreshSession("s1");
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].number, 2); // stored PR, not dropped
  assert.equal(poller.get("o/r", 2), null); // nothing cached on failure
});

test("PrPoller only refreshes open, non-merged PRs", async () => {
  const repo = new InMemoryRepository();
  await repo.upsertSession(
    makeSession("s1", [makePR("o/r", 1, "open"), makePR("o/r", 2, "merged"), makePR("o/r", 3, "closed")]),
    null,
  );
  const { forge, calls } = fakeForge((r, n) => makePR(r, n));
  const poller = new PrPoller(repo, forge, () => {}, () => true);

  await poller.refreshSession("s1");
  assert.deepEqual(calls, ["o/r#1"]); // merged + closed skipped
});
