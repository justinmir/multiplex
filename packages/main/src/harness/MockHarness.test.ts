import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockHarness } from "./MockHarness.js";
import type { HarnessEvent } from "@app/core";

describe("MockHarness", () => {
  const harness = new MockHarness({ id: "mock" });

  it("health returns ok=true with version", async () => {
    const result = await harness.health();
    assert.equal(result.ok, true);
    assert.match(result.version ?? "", /^mock-/);
  });

  it("listModels returns at least one model", async () => {
    const models = await harness.listModels();
    assert.ok(models.length > 0);
    assert.ok(models[0].id);
  });

  it("emits events in expected order: starting → running → deltas → tool_use → tool_result → message(final) → usage → done", async () => {
    const events: HarnessEvent[] = [];
    let resolveDone: () => void;
    const donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });

    const run = await harness.start(
      { sessionId: "test-1", prompt: "hello", cwd: "/tmp" },
      (e) => {
        events.push(e);
        if (e.type === "done") resolveDone();
      }
    );

    assert.equal(run.sessionId, "test-1");

    // Wait for all events to arrive (with generous timeout)
    await Promise.race([
      donePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout waiting for done")), 5000)),
    ]);

    // Verify ordering
    const types = events.map((e) => e.type);
    assert.equal(types[0], "status");
    assert.equal(events[0].status, "starting");
    assert.equal(types[1], "status");
    assert.equal(events[1].status, "running");

    // Find first delta index and last delta index
    const firstDeltaIdx = types.indexOf("message_delta");
    const lastDeltaIdx = [...types].lastIndexOf("message_delta");
    assert.ok(firstDeltaIdx > 1, "first delta comes after status events");

    // tool_use must come after deltas
    const toolUseIdx = types.indexOf("tool_use");
    const toolResultIdx = types.indexOf("tool_result");
    assert.ok(toolUseIdx > lastDeltaIdx, "tool_use after all deltas");
    assert.ok(toolResultIdx === toolUseIdx + 1, "tool_result immediately after tool_use");

    // Final message comes after tool result
    const finalMsgEvents = events.filter((e) => e.type === "message" && e.final);
    assert.equal(finalMsgEvents.length, 1, "exactly one final message");
    const finalMsgIdx = types.indexOf("message");
    assert.ok(finalMsgIdx > toolResultIdx, "final message after tool_result");

    // Usage and done at the end
    const usageIdx = types.indexOf("usage");
    assert.ok(usageIdx > finalMsgIdx, "usage after final message");
    assert.equal(types[types.length - 1], "done", "last event is 'done'");
    assert.equal(events[events.length - 1].reason, "completed");
  });

  it("stop() emits done:stopped and cancels pending events", async () => {
    const events: HarnessEvent[] = [];
    let resolveDone: () => void;
    const donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });

    const run = await harness.start(
      { sessionId: "test-stop", prompt: "hello", cwd: "/tmp" },
      (e) => {
        events.push(e);
        if (e.type === "done") resolveDone();
      }
    );

    // Stop immediately after start resolves
    await run.stop();

    await Promise.race([
      donePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);

    const lastEvent = events[events.length - 1];
    assert.equal(lastEvent.type, "done");
    assert.equal(lastEvent.reason, "stopped");
  });

  it("send() emits a reply", async () => {
    const events: HarnessEvent[] = [];

    const run = await harness.start(
      { sessionId: "test-send", prompt: "hello", cwd: "/tmp" },
      (e) => {
        events.push(e);
      }
    );

    // Wait for initial done event to arrive, then send a message
    let doneIdx = -1;
    const checkDone = setInterval(() => {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === "done") {
          doneIdx = i;
          break;
        }
      }
    }, 20);

    // Wait briefly for initial sequence to finish
    await new Promise((r) => setTimeout(r, 1500));
    clearInterval(checkDone);

    const beforeCount = events.length;
    await run.send("follow up task");

    // After send completes, we should have more events (the reply deltas + message)
    assert.ok(events.length > beforeCount, "send produces additional events");
    run.dispose();
  });

  it("dispose() cleans up timers", async () => {
    const events: HarnessEvent[] = [];
    const run = await harness.start(
      { sessionId: "test-dispose", prompt: "hello", cwd: "/tmp" },
      (e) => { events.push(e); }
    );

    // Dispose immediately — should not throw
    run.dispose();
    assert.ok(true, "dispose does not throw");

    // Wait to ensure no more events are emitted after dispose
    await new Promise((r) => setTimeout(r, 2000));
    const hasDone = events.some((e) => e.type === "done" && e.reason === "completed");
    assert.equal(hasDone, false, "no completion event after early dispose");
  });
});
