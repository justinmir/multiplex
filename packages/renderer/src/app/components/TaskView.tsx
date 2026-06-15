import { Session, PullRequest, Reference } from "../data/mockData";
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
}

export function TaskView({ session, prs, onAddReference, onSendMessage, onStopAgent, onClose }: Props) {
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
    />
  );
}
