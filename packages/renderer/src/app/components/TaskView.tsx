import { Session, PullRequest, Reference, FileChange, SessionMsg } from "../data/mockData";
import { SessionDetail } from "./SessionDetail";

interface Props {
  session: Session;
  /** Ordered steps of the in-flight turn (thinking, tool calls, streaming reply). */
  liveSteps?: SessionMsg[];
  prs: PullRequest[];
  onAddReference: (r: Reference) => void;
  /** Called when user sends a message in this session. Receives the raw message text. */
  onSendMessage?: (message: string) => void;
  /** Called when user clicks Stop while agent is running. */
  onStopAgent?: () => void;
  onClose: () => void;
  // M-A8 — model selection
  currentModel?: string;
  availableModels?: Array<{ id: string; label?: string; provider?: string }>;
  onSelectModel?: (modelId: string) => void;
  // M-C4 — real working-tree diffs
  worktreeChanges?: Array<{ repo: string; files: FileChange[] }>;
  // M-B4 / M-B5 — PR actions
  onReplyToComment?: (repo: string, number: number, commentId: string, body: string) => void;
  onRerunChecks?: (repo: string, number: number) => void;
  onAddressComments?: (comments: string[]) => void;
  onOpenPR?: () => void;
}

export function TaskView({ session, liveSteps, prs, onAddReference, onSendMessage, onStopAgent, onClose, currentModel, availableModels, onSelectModel, worktreeChanges, onReplyToComment, onRerunChecks, onAddressComments, onOpenPR }: Props) {
  return (
    <SessionDetail
      backLabel="Home"
      session={session}
      liveSteps={liveSteps}
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
