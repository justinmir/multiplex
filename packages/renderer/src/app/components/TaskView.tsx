import { Session, PullRequest, Reference, FileChange } from "../data/mockData";
import { SessionDetail } from "./SessionDetail";

interface Props {
  session: Session;
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
}

export function TaskView({ session, prs, onAddReference, onSendMessage, onStopAgent, onClose, currentModel, availableModels, onSelectModel, worktreeChanges }: Props) {
  return (
    <SessionDetail
      backLabel="Home"
      session={session}
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
    />
  );
}
