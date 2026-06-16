import { handle } from "../router.js";
import { emit } from "../emit.js";
import type { ForgeService } from "@app/core";
import type { SessionRuntime } from "../../session/SessionRuntime.js";

/** Register live PR-detail + PR-action IPC handlers (M-B3/M-B4). */
export function registerPrHandlers(forge: ForgeService, runtime: SessionRuntime) {
  // M-B3 — full PR detail (files / comments / checks) for the rails
  handle("pr:get", async (req) => {
    return forge.getPR(req.repo, req.number);
  });

  // M-B4 — reply to a review/PR comment on GitHub
  handle("pr:reply", async (req) => {
    await forge.replyToComment(req.repo, req.number, req.commentId, req.body);
    emit(`pr:${req.repo}#${req.number}:changed`, {});
  });

  // M-B4 — re-run a PR's checks
  handle("pr:rerun", async (req) => {
    await forge.rerunChecks(req.repo, req.number);
    emit(`pr:${req.repo}#${req.number}:changed`, {});
  });

  // M-B4 — ask the agent to address review comments (re-enters the harness)
  handle("session:address-comments", async (req) => {
    const body = req.comments.length === 1
      ? `Please address this review comment:\n\n${req.comments[0]}`
      : `Please address these ${req.comments.length} review comments:\n\n${req.comments.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;
    await runtime.sendMessage(req.sessionId, body);
  });

  // M-B5 — open a draft PR per touched repo with changes
  handle("session:open-pr", async (req) => {
    return runtime.openPullRequests(req.sessionId);
  });
}
