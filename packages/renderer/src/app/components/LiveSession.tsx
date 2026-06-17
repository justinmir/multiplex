import { useEffect, useState } from "react";
import type { AppSettingsData, Session, SessionMsg } from "@app/core";
import { SessionDetail } from "./SessionDetail";
import { useDataMutations } from "../../lib/data/DataProvider.js";
import { useSessionStream } from "../../lib/session/useSessionStream.js";
import { useChanges } from "../../lib/session/useChanges.js";
import { usePrDetails } from "../../lib/pr/usePr.js";
import { useHarnessInfo } from "../../lib/session/useHarnessInfo.js";
import { call } from "../../lib/ipc/client.js";

/**
 * The full live session view: subscribes to the harness event stream, renders
 * the in-flight turn (thinking / tools / streaming reply), wires the composer,
 * queue, prompt-editing, working-tree diffs and PR detail. Shared by the
 * standalone-session view and the in-project session view so both behave
 * identically.
 */
export function LiveSession({ session, projectName, backLabel = "Home", onClose }: {
  session: Session;
  projectName?: string;
  backLabel?: string;
  onClose: () => void;
}) {
  const mutations = useDataMutations();

  // Harness/model state.
  const [settings, setSettings] = useState<AppSettingsData | null>(null);
  useEffect(() => { call("settings:get", undefined).then(setSettings).catch(() => {}); }, []);
  const { info: harnessInfo } = useHarnessInfo(settings?.harnessId, !!settings);
  const selectModel = (modelId: string) => call("settings:set", { defaultModel: modelId }).then(setSettings).catch(() => {});

  // Live turn (thinking → tools → streaming reply), reset per session.
  const [liveSteps, setLiveSteps] = useState<SessionMsg[]>([]);
  useEffect(() => { setLiveSteps([]); }, [session.id]);

  useSessionStream(session.id, (event) => {
    setLiveSteps((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      switch (event.type) {
        case "message_delta":
          if (last?.role === "agent") next[next.length - 1] = { ...last, content: last.content + event.delta };
          else next.push({ role: "agent", content: event.delta, ts: new Date().toISOString() });
          return next;
        case "reasoning_delta":
          if (last?.role === "thinking") next[next.length - 1] = { ...last, content: last.content + event.delta };
          else next.push({ role: "thinking", content: event.delta, ts: new Date().toISOString() });
          return next;
        case "tool_use":
          next.push({ role: "tool", content: "", ts: new Date().toISOString(), tool: { name: event.name, input: event.input, callId: event.id, status: "running" } });
          return next;
        case "tool_result": {
          const idx = next.findIndex((m) => m.tool?.callId === event.id);
          if (idx < 0) return prev;
          const m = next[idx];
          next[idx] = { ...m, content: event.content, tool: { ...m.tool!, status: event.isError ? "error" : "ok" } };
          return next;
        }
        default:
          return prev;
      }
    });
  });

  // Drop the live turn once the persisted transcript has caught up.
  const lastPersisted = session.messages[session.messages.length - 1];
  const persistedEndsWithAgent = lastPersisted?.role === "agent";
  useEffect(() => {
    if (persistedEndsWithAgent && liveSteps.length > 0) setLiveSteps([]);
  }, [persistedEndsWithAgent, liveSteps.length]);

  const { changes: worktreeChanges } = useChanges(session.id, true);
  const enrichedPRs = usePrDetails(session.linkedPRs ?? [], mutations.githubConnected);
  const visibleLiveSteps = persistedEndsWithAgent ? [] : liveSteps;

  return (
    <SessionDetail
      projectName={projectName}
      backLabel={backLabel}
      session={session}
      liveSteps={visibleLiveSteps}
      queuedMessages={session.queuedMessages ?? []}
      onInterruptQueued={(i) => mutations.interruptQueuedMessage(session.id, i)}
      onDeleteQueued={(i) => mutations.removeQueuedMessage(session.id, i)}
      onEditPrompt={(t) => mutations.editSessionPrompt(session.id, t)}
      prs={enrichedPRs}
      references={session.references ?? []}
      worktreeChanges={worktreeChanges}
      currentModel={settings?.defaultModel}
      availableModels={harnessInfo.models ?? []}
      onSelectModel={selectModel}
      onAddReference={(r) => mutations.upsertSessionReference(session.id, r)}
      onSendMessage={(m) => mutations.sendToSession(session.id, m)}
      onStopAgent={() => mutations.stopSessionViaRuntime(session.id)}
      onReplyToComment={(repo, number, commentId, body) => mutations.replyToComment(repo, number, commentId, body)}
      onRerunChecks={(repo, number) => mutations.rerunChecks(repo, number)}
      onAddressComments={(comments) => mutations.addressComments(session.id, comments)}
      onOpenPR={() => mutations.openSessionPR(session.id)}
      onClose={onClose}
    />
  );
}
