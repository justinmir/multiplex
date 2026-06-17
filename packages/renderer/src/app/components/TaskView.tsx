import { Session, PullRequest, Reference, FileChange, SessionMsg } from "../data/mockData";
import { SessionDetail } from "./SessionDetail";

interface Props {
  session: Session;
  /** Ordered steps of the in-flight turn (thinking, tool calls, streaming reply). */
  liveSteps?: SessionMsg[];
  /** Messages queued while the agent is busy (shown above the composer). */
  queuedMessages?: string[];
  onInterruptQueued?: (index: number) => void;
  onDeleteQueued?: (index: number) => void;
  /** Replace + re-run the in-progress prompt. */
  onEditPrompt?: (newText: string) => void;
  prs: PullRequest[];
  onAddReference: (r: Reference) => void;
  /** Called when user sends a message in this session. Receives the raw message text. */
  onSendMessage?: (message: string) => void;
  /** Called when user clicks Stop while agent is running. */
  onStopAgent?: () => void;
  onClose: () => void;
  // model selection
  currentModel?: string;
  availableModels?: Array<{ id: string; label?: string; provider?: string }>;
  onSelectModel?: (modelId: string) => void;
  // real working-tree diffs
  worktreeChanges?: Array<{ repo: string; files: FileChange[] }>;
  // PR actions
  onReplyToComment?: (repo: string, number: number, commentId: string, body: string) => void;
  onRerunChecks?: (repo: string, number: number) => void;
  onAddressComments?: (comments: string[]) => void;
  onOpenPR?: () => void;
}

export function TaskView({ session, liveSteps, queuedMessages, onInterruptQueued, onDeleteQueued, onEditPrompt, prs, onAddReference, onSendMessage, onStopAgent, onClose, currentModel, availableModels, onSelectModel, worktreeChanges, onReplyToComment, onRerunChecks, onAddressComments, onOpenPR }: Props) {
  return (
    <SessionDetail
      backLabel="Home"
      session={session}
      liveSteps={liveSteps}
      queuedMessages={queuedMessages}
      onInterruptQueued={onInterruptQueued}
      onDeleteQueued={onDeleteQueued}
      onEditPrompt={onEditPrompt}
      prs={prs}
      references={session.references ?? []}
      onAddReference={onAddReference}
      onSendMessage={onSendMessage}
      onStopAgent={onStopAgent}
      onClose={onClose}
      currentModel={currentModel}
      availableModels={availableModels}
      onSelectModel={onSelectModel}
      worktreeChanges={worktreeChanges}
      onReplyToComment={onReplyToComment}
      onRerunChecks={onRerunChecks}
      onAddressComments={onAddressComments}
      onOpenPR={onOpenPR}
    />
  );
}
